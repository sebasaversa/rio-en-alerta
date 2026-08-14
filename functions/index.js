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

async function getJson(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`INA respondió ${response.status}`);
  return response.json();
}

async function getCurrentObservation() {
  const observation = currentObservation(await getJson(observationUrl()));
  if (!observation) throw new Error('INA no devolvió una medición válida');
  return observation;
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
  () => bot.checkRiver(),
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
