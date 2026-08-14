const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions');
const { initializeApp } = require('firebase-admin/app');
const { FieldValue, Timestamp, getFirestore } = require('firebase-admin/firestore');
const { COMMANDS, MAIN_KEYBOARD, createBotCore } = require('./bot-core');
const { createFirestoreRepository } = require('./firestore-repository');
const { currentObservation, forecastUrl, observationUrl } = require('./lib');
const { createTelegramClient } = require('./telegram-client');
const { calculateCurrentVelocity, calculateVelocityStatistics } = require('./velocity');

initializeApp();
const db = getFirestore();
const telegramToken = defineSecret('TELEGRAM_BOT_TOKEN');
const REGION = 'us-central1';
const RETENTION_MONTHS = 12;

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

function timestampIso(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

const repository = createFirestoreRepository({ db, FieldValue });
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
    const [velocityData, recentPayload] = await Promise.all([
      repository.getVelocityData(),
      getJson(observationUrl()),
    ]);
    const freshCurrent = calculateCurrentVelocity(recentPayload, velocityData?.statistics);
    response.json({
      station: { siteCode: 52, name: 'San Fernando', river: 'Río Luján' },
      officialLevels: { alert: 3, evacuation: 3.5 },
      statistics: velocityData?.statistics ?? null,
      current: freshCurrent,
      calculatedAt: timestampIso(velocityData?.calculatedAt),
      updatedAt: timestampIso(velocityData?.updatedAt),
    });
  },
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
