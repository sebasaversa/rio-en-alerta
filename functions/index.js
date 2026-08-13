const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions');
const { initializeApp } = require('firebase-admin/app');
const { FieldValue, Timestamp, getFirestore } = require('firebase-admin/firestore');
const {
  DEFAULT_THRESHOLD,
  STATION,
  currentObservation,
  dailyMaximums,
  forecastUrl,
  normalizeCommand,
  normalizeRows,
  observationUrl,
  parseDate,
  parseThreshold,
  shouldAlert,
} = require('./lib');

initializeApp();
const db = getFirestore();
const telegramToken = defineSecret('TELEGRAM_BOT_TOKEN');
const REGION = 'us-central1';
const WEB_URL = 'https://sebasaversa.github.io/rio-en-alerta/';
const RETENTION_MONTHS = 12;

const COMMANDS = [
  { command: 'estado', description: 'Consultar la altura actual' },
  { command: 'maximo', description: 'Ver o cambiar tu altura máxima' },
  { command: 'pronostico', description: 'Ver los próximos días' },
  { command: 'historial', description: 'Ver las últimas mediciones' },
  { command: 'pausar', description: 'Pausar alertas automáticas' },
  { command: 'activar', description: 'Activar alertas automáticas' },
  { command: 'ayuda', description: 'Mostrar esta ayuda' },
];

const HELP_TEXT = [
  '🌊 *Río en Alerta*',
  '',
  `Te aviso cuando el nivel del ${STATION.river} en ${STATION.name} alcance tu altura seleccionada.`,
  '',
  '• /estado — consultar la altura actual',
  '• /maximo — ver tu altura máxima',
  '• /maximo 2.50 — cambiar tu altura máxima',
  '• /pronostico — ver los próximos días',
  '• /historial — ver las últimas mediciones',
  '• /pausar — pausar las alertas',
  '• /activar — volver a activarlas',
  '• /ayuda — volver a ver este mensaje',
  '',
  'Las mediciones se revisan cada hora.',
  `📊 Panel web: ${WEB_URL}`,
].join('\n');

const MAIN_KEYBOARD = {
  inline_keyboard: [
    [
      { text: '🌊 Altura actual', callback_data: 'cmd:estado' },
      { text: '📏 Mi máximo', callback_data: 'cmd:maximo' },
    ],
    [
      { text: '🔭 Pronóstico', callback_data: 'cmd:pronostico' },
      { text: '📈 Historial', callback_data: 'cmd:historial' },
    ],
    [{ text: 'ℹ️ Ayuda', callback_data: 'cmd:ayuda' }],
  ],
};

function formatLevel(value) {
  return Number(value).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value, options = {}) {
  const date = value instanceof Date ? value : parseDate(value);
  if (!date) return 'fecha no disponible';
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: options.dateStyle ?? 'short',
    timeStyle: options.timeStyle ?? 'short',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(date);
}

async function telegram(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${telegramToken.value()}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) {
    const error = new Error(`Telegram ${method} falló: ${response.status} ${result?.description ?? ''}`.trim());
    error.status = response.status;
    throw error;
  }
  return result.result;
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

async function touchChat(chat, command, isStart = false) {
  const ref = db.collection('telegramChats').doc(String(chat.id));
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const previous = snapshot.data() ?? {};
    const update = {
      chatId: chat.id,
      firstName: chat.first_name ?? null,
      lastName: chat.last_name ?? null,
      username: chat.username ?? null,
      threshold: Number.isFinite(previous.threshold) ? previous.threshold : DEFAULT_THRESHOLD,
      active: isStart ? true : Boolean(previous.active),
      firstSeenAt: previous.firstSeenAt ?? FieldValue.serverTimestamp(),
      lastActiveAt: FieldValue.serverTimestamp(),
      lastCommand: command || 'unknown',
    };
    if (isStart && !previous.joinedAt) {
      update.joinedAt = FieldValue.serverTimestamp();
    }
    if (!snapshot.exists) update.lastSent = 0;
    transaction.set(ref, update, { merge: true });
  });
  return ref;
}

async function configureCommands() {
  try {
    await telegram('setMyCommands', { commands: COMMANDS });
  } catch (error) {
    logger.warn('No se pudo actualizar el menú de comandos', { error: error.message });
  }
}

async function commandEstado(chatId) {
  const current = await getCurrentObservation();
  await sendMessage(chatId, [
    `🌊 *${STATION.river} — ${STATION.name}*`,
    `Altura actual: *${formatLevel(current.value)} m*`,
    `Medición: ${formatDate(current.date)} ART`,
  ].join('\n'));
}

async function commandMaximo(chatId, ref, argument) {
  const snapshot = await ref.get();
  const data = snapshot.data();
  if (!argument) {
    if (!data?.joinedAt) {
      await sendMessage(chatId, 'Primero enviá /start para activar tus alertas.');
      return;
    }
    await sendMessage(chatId, `📏 Tu altura máxima configurada es *${formatLevel(data.threshold)} m*.`);
    return;
  }
  const value = parseThreshold(argument);
  if (value === null) {
    await sendMessage(chatId, 'Ingresá un valor mayor a 0 y hasta 6 m, con hasta dos decimales.\nEjemplo: /maximo 2.50');
    return;
  }
  const update = { threshold: value, active: true };
  if (!data?.joinedAt) update.joinedAt = FieldValue.serverTimestamp();
  await ref.set(update, { merge: true });
  await sendMessage(chatId, `✅ Tu altura máxima quedó configurada en *${formatLevel(value)} m*.\nLas alertas están activas.`);
}

async function commandPronostico(chatId) {
  const days = dailyMaximums(await getJson(forecastUrl()));
  if (!days.length) {
    await sendMessage(chatId, 'El pronóstico del INA no está disponible en este momento.');
    return;
  }
  const rows = days.map((row) => {
    const day = new Intl.DateTimeFormat('es-AR', {
      weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/Argentina/Buenos_Aires',
    }).format(parseDate(row.date));
    return `• ${day}: *${formatLevel(row.value)} m*`;
  });
  await sendMessage(chatId, [`🔭 *Pronóstico — ${STATION.name}*`, ...rows, '', '_Máximos diarios estimados por el INA._'].join('\n'));
}

async function commandHistorial(chatId) {
  const rows = normalizeRows(await getJson(observationUrl(new Date(), 1))).slice(-6);
  if (!rows.length) {
    await sendMessage(chatId, 'El historial del INA no está disponible en este momento.');
    return;
  }
  await sendMessage(chatId, [
    `📈 *Últimas mediciones — ${STATION.name}*`,
    ...rows.map((row) => `• ${formatDate(row.date)}: *${formatLevel(row.value)} m*`),
  ].join('\n'));
}

async function processCommand(chatId, chat, text) {
  const { command, argument } = normalizeCommand(text);
  const isStart = command === '/start';
  const ref = await touchChat(chat, command, isStart);
  if (isStart) {
    await configureCommands();
    await sendMessage(chatId, HELP_TEXT);
    return;
  }
  switch (command) {
    case '/ayuda':
    case '/help':
      await sendMessage(chatId, HELP_TEXT);
      break;
    case '/estado':
    case '/nivel':
      await commandEstado(chatId);
      break;
    case '/maximo':
      await commandMaximo(chatId, ref, argument);
      break;
    case '/pronostico':
      await commandPronostico(chatId);
      break;
    case '/historial':
      await commandHistorial(chatId);
      break;
    case '/pausar':
      await ref.set({ active: false }, { merge: true });
      await sendMessage(chatId, '⏸️ Tus alertas automáticas quedaron pausadas. Podés reactivarlas con /activar.');
      break;
    case '/activar':
      {
        const snapshot = await ref.get();
        const activation = { active: true };
        if (!snapshot.data()?.joinedAt) activation.joinedAt = FieldValue.serverTimestamp();
        await ref.set(activation, { merge: true });
      }
      await sendMessage(chatId, '▶️ Tus alertas automáticas están activas.');
      break;
    default:
      await sendMessage(chatId, `No reconocí ese comando.\n\n${HELP_TEXT}`);
  }
}

exports.telegramWebhook = onRequest(
  { region: REGION, secrets: [telegramToken], timeoutSeconds: 30 },
  async (request, response) => {
    const update = request.body ?? {};
    const callback = update.callback_query;
    const message = callback?.message ?? update.message;
    const chatId = message?.chat?.id;
    const chat = callback?.from ?? message?.from;
    let text = message?.text?.trim();
    if (callback?.data?.startsWith('cmd:')) text = `/${callback.data.slice(4)}`;
    if (!chatId || !chat || !text) {
      response.sendStatus(200);
      return;
    }
    if (callback?.id) {
      await telegram('answerCallbackQuery', { callback_query_id: callback.id }).catch((error) => {
        logger.warn('No se pudo confirmar el botón', { error: error.message });
      });
    }
    try {
      await processCommand(chatId, chat, text);
      logger.info('Comando Telegram procesado', {
        chatId: String(chatId),
        command: normalizeCommand(text).command,
        updateId: update.update_id,
      });
    } catch (error) {
      logger.error('Falló un comando Telegram', {
        chatId: String(chatId),
        command: normalizeCommand(text).command,
        error: error.message,
      });
      await sendMessage(chatId, 'No pude completar la consulta en este momento. Probá nuevamente en unos minutos.').catch(() => {});
    }
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
    const startedAt = Date.now();
    let chatsProcessed = 0;
    let alertsSent = 0;
    let errors = 0;
    try {
      const current = await getCurrentObservation();
      const chats = await db.collection('telegramChats').where('active', '==', true).get();
      for (const document of chats.docs) {
        chatsProcessed += 1;
        const chat = document.data();
        if (!shouldAlert(current.value, Number(chat.threshold), chat.lastSent)) continue;
        try {
          await sendMessage(chat.chatId, [
            '⚠️ *Río en Alerta*',
            `${STATION.river} — ${STATION.name}: *${formatLevel(current.value)} m*`,
            `Tu altura seleccionada: *${formatLevel(chat.threshold)} m*`,
            `Medición consultada: ${formatDate(current.date)} ART`,
          ].join('\n'));
          const sentAt = Date.now();
          await document.ref.update({
            lastSent: sentAt,
            lastAlertAt: FieldValue.serverTimestamp(),
            lastAlertLevel: current.value,
          });
          await db.collection('alertEvents').add({
            chatId: chat.chatId,
            level: current.value,
            threshold: chat.threshold,
            observedAt: current.date,
            sentAt: FieldValue.serverTimestamp(),
          });
          alertsSent += 1;
        } catch (error) {
          errors += 1;
          logger.error('Falló una alerta Telegram', { chatId: document.id, error: error.message });
        }
      }
      await db.collection('systemStatus').doc('checkRiver').set({
        ok: true,
        level: current.value,
        observedAt: current.date,
        chatsProcessed,
        alertsSent,
        errors,
        durationMs: Date.now() - startedAt,
        checkedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      logger.info('Revisión horaria completada', { chatsProcessed, alertsSent, errors });
    } catch (error) {
      await db.collection('systemStatus').doc('checkRiver').set({
        ok: false,
        error: error.message,
        durationMs: Date.now() - startedAt,
        checkedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      logger.error('Falló la revisión horaria', { error: error.message });
      throw error;
    }
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
