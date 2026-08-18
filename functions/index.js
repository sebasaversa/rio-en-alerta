const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions');
const { initializeApp } = require('firebase-admin/app');
const { FieldValue, Timestamp, getFirestore } = require('firebase-admin/firestore');
const { COMMANDS, MAIN_KEYBOARD, createBotCore } = require('./bot-core');
const { createFirestoreRepository } = require('./firestore-repository');
const { STATION, currentObservation, forecastIssuedAt, forecastUrl, observationUrl, stationObservationUrl } = require('./lib');
const { compactPublicRows, parsePublicHistoryDays } = require('./public-cache');
const { buildPublicStatusPayload } = require('./public-status');
const { createTelegramClient } = require('./telegram-client');
const { calculateCurrentVelocity, calculateVelocityStatistics } = require('./velocity');

initializeApp();
const db = getFirestore();
const telegramToken = defineSecret('TELEGRAM_BOT_TOKEN');
const REGION = 'us-central1';
const RETENTION_MONTHS = 12;
const PUBLIC_STATIONS = Object.freeze([
  STATION,
  { siteCode: 49, varId: 2, name: 'Tigre', river: 'Río Luján' },
  { siteCode: 50, varId: 2, name: 'Dique Luján', river: 'Río Luján' },
  { siteCode: 53, varId: 2, name: 'San Isidro', river: 'Río de la Plata' },
]);

const telegramClient = createTelegramClient({
  token: () => telegramToken.value(),
  logger,
});

async function telegram(method, body) {
  return telegramClient.request(method, body);
}

async function sendMessage(chatId, text, replyMarkup = MAIN_KEYBOARD) {
  return telegram('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

async function getJson(url, timeoutMs = 15000) {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`INA respondió ${response.status}`);
  return response.json();
}

async function getCurrentObservation() {
  const observation = currentObservation(await getJson(observationUrl()));
  if (!observation) throw new Error('INA no devolvió una medición válida');
  return observation;
}

function argentinaDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(date);
}

const repository = createFirestoreRepository({ db, FieldValue });

async function refreshPublicDataCache(historyDays) {
  const now = new Date();
  const timeoutMs = historyDays >= 365 ? 120000 : 30000;
  const tasks = [
    getJson(forecastUrl(now), 30000).then(async (payload) => {
      const rows = compactPublicRows(payload);
      if (!rows.length) throw new Error('INA no devolvió un pronóstico válido para cachear');
      await repository.setPublicForecast(rows, forecastIssuedAt(payload));
      return { kind: 'forecast', rowCount: rows.length };
    }),
    ...PUBLIC_STATIONS.map((station) => getJson(stationObservationUrl(station, now, historyDays), timeoutMs).then(async (payload) => {
      const rows = compactPublicRows(payload);
      if (!rows.length) throw new Error(`INA no devolvió historial válido para ${station.name}`);
      const rowCount = await repository.mergePublicHistory(station.siteCode, rows, now);
      return { kind: 'history', siteCode: station.siteCode, rowCount };
    })),
  ];
  const results = await Promise.allSettled(tasks);
  const completed = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
  const failed = results.filter((result) => result.status === 'rejected').map((result) => result.reason?.message ?? String(result.reason));
  logger.info('Caché público procesado', { historyDays, completed, failed });
  if (!completed.length) throw new Error(`No se pudo actualizar ninguna fuente del caché público: ${failed.join('; ')}`);
  return { historyDays, completed, failed };
}

const bot = createBotCore({
  repository,
  sendMessage,
  answerCallbackQuery: (callbackId) => telegram('answerCallbackQuery', { callback_query_id: callbackId }),
  configureCommands: () => telegram('setMyCommands', { commands: COMMANDS }).catch((error) => {
    logger.warn('No se pudo actualizar el menú de comandos', { error: error.message });
  }),
  getCurrentObservation,
  getForecast: () => getJson(forecastUrl()),
  getHistory: (days) => getJson(observationUrl(new Date(), days)),
  logger,
});

exports.telegramWebhook = onRequest(
  { region: REGION, secrets: [telegramToken], timeoutSeconds: 60 },
  async (request, response) => {
    await bot.processUpdate(request.body ?? {});
    response.sendStatus(200);
  },
);

exports.checkRiver = onSchedule(
  {
    region: REGION,
    schedule: 'every 60 minutes',
    timeZone: 'America/Argentina/Buenos_Aires',
    secrets: [telegramToken],
    timeoutSeconds: 120,
  },
  async () => {
    const payload = await getJson(observationUrl());
    const current = currentObservation(payload);
    if (!current) throw new Error('INA no devolvió una medición válida');
    try {
      await repository.mergePublicHistory(STATION.siteCode, compactPublicRows(payload));
    } catch (error) {
      logger.warn('No se pudo guardar el historial público de San Fernando', { error: error.message });
    }
    const isNewObservation = await repository.claimObservation(current.date);
    let detection = null;
    let statistics = null;
    try {
      const velocityData = await repository.getVelocityData();
      statistics = velocityData?.statistics ?? null;
      detection = calculateCurrentVelocity(payload, statistics, {
        lastProcessedObservationAt: isNewObservation ? null : velocityData?.current?.observedAt,
      });
      if (detection.isNewObservation) {
        const saved = await repository.saveVelocityDetectionIfNew(detection);
        if (!saved) detection = { ...detection, isNewObservation: false };
        if (saved) {
          logger.info('Indicador de velocidad actualizado', {
            classification: detection.code,
            observedAt: detection.observedAt,
            speedMetersPerHour: detection.speedMetersPerHour,
          });
        }
      }
    } catch (error) {
      logger.error('No se pudo actualizar el indicador de velocidad', { error: error.message });
    }
    return bot.checkRiver(current, { isNewObservation, detection, statistics });
  },
);

exports.calculateVelocityStats = onSchedule(
  {
    region: REGION,
    schedule: '30 2 * * *',
    timeZone: 'America/Argentina/Buenos_Aires',
    timeoutSeconds: 180,
    memory: '512MiB',
  },
  async () => {
    const payload = await getJson(observationUrl(new Date(), 365), 120000);
    const statistics = calculateVelocityStatistics(payload);
    await repository.setVelocityStatistics(statistics);
    const previous = await repository.getVelocityData();
    const detection = calculateCurrentVelocity(payload, statistics, {
      lastProcessedObservationAt: previous?.current?.observedAt,
    });
    if (detection.isNewObservation) await repository.saveVelocityDetectionIfNew(detection);
    logger.info('Percentiles diarios de velocidad calculados', {
      sufficient: statistics.sufficient,
      coverageDays: statistics.coverageDays,
      validIntervalCount: statistics.validIntervalCount,
      p90Ascent: statistics.p90Ascent,
      p90Descent: statistics.p90Descent,
    });
    return statistics;
  },
);

exports.sendDailySummary = onSchedule(
  {
    region: REGION,
    schedule: '0 8 * * *',
    timeZone: 'America/Argentina/Buenos_Aires',
    secrets: [telegramToken],
    timeoutSeconds: 120,
  },
  async () => {
    const [current, velocityData] = await Promise.all([
      getCurrentObservation(),
      repository.getVelocityData(),
    ]);
    return bot.sendDailySummaries({
      current,
      velocityData,
      dateKey: argentinaDateKey(),
    });
  },
);

exports.publicRiverStatus = onRequest(
  { region: REGION, timeoutSeconds: 30 },
  async (request, response) => {
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Cache-Control', 'public, max-age=300');
    if (request.method === 'OPTIONS') {
      response.set('Access-Control-Allow-Methods', 'GET');
      response.sendStatus(204);
      return;
    }
    if (request.method !== 'GET') {
      response.sendStatus(405);
      return;
    }
    const days = parsePublicHistoryDays(request.query.days);
    const [velocityData, forecast, histories] = await Promise.all([
      repository.getVelocityData(),
      repository.getPublicForecast(),
      repository.getPublicHistories(PUBLIC_STATIONS.map((station) => station.siteCode)),
    ]);
    const payload = buildPublicStatusPayload(velocityData, { forecast, histories, days });
    if (!payload) {
      response.status(503).json({ error: 'Todavía no hay una medición guardada disponible.' });
      return;
    }
    response.json(payload);
  },
);

exports.refreshPublicDisplayCache = onSchedule(
  {
    region: REGION,
    schedule: 'every 60 minutes',
    timeZone: 'America/Argentina/Buenos_Aires',
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  () => refreshPublicDataCache(7),
);

exports.refreshPublicHistoryCache = onSchedule(
  {
    region: REGION,
    schedule: '20 3 * * *',
    timeZone: 'America/Argentina/Buenos_Aires',
    timeoutSeconds: 300,
    memory: '512MiB',
  },
  () => refreshPublicDataCache(365),
);

exports.cleanupInactiveChats = onSchedule(
  {
    region: REGION,
    schedule: 'every day 04:15',
    timeZone: 'America/Argentina/Buenos_Aires',
    timeoutSeconds: 120,
  },
  async () => {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);
    const inactive = await db.collection('telegramChats')
      .where('lastActiveAt', '<', Timestamp.fromDate(cutoff))
      .get();
    const oldEvents = await db.collection('alertEvents')
      .where('sentAt', '<', Timestamp.fromDate(cutoff))
      .get();
    const writer = db.bulkWriter();
    inactive.docs.forEach((document) => writer.delete(document.ref));
    oldEvents.docs.forEach((document) => writer.delete(document.ref));
    await writer.close();
    logger.info('Retención de datos completada', {
      chatsDeleted: inactive.size,
      eventsDeleted: oldEvents.size,
      cutoff: cutoff.toISOString(),
    });
  },
);
