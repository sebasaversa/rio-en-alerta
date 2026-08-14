const {
  STATION,
  dailyMaximums,
  normalizeCommand,
  normalizeRows,
  parseDate,
  parseThreshold,
  shouldAlert,
} = require('./lib');

const WEB_URL = 'https://sebasaversa.github.io/rio-en-alerta/';

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

function createBotCore(options) {
  const {
    repository,
    sendMessage,
    answerCallbackQuery = async () => {},
    configureCommands = async () => {},
    getCurrentObservation,
    getForecast,
    getHistory,
    logger = console,
    now = Date.now,
  } = options;

  async function commandEstado(chatId) {
    const current = await getCurrentObservation();
    await sendMessage(chatId, [
      `🌊 *${STATION.river} — ${STATION.name}*`,
      `Altura actual: *${formatLevel(current.value)} m*`,
      `Medición: ${formatDate(current.date)} ART`,
    ].join('\n'), MAIN_KEYBOARD);
  }

  async function commandMaximo(chatId, argument) {
    const data = await repository.getChat(chatId);
    if (!argument) {
      if (!data?.joinedAt) {
        await sendMessage(chatId, 'Primero enviá /start para activar tus alertas.', MAIN_KEYBOARD);
        return;
      }
      await sendMessage(chatId, `📏 Tu altura máxima configurada es *${formatLevel(data.threshold)} m*.`, MAIN_KEYBOARD);
      return;
    }
    const value = parseThreshold(argument);
    if (value === null) {
      await sendMessage(chatId, 'Ingresá un valor mayor a 0 y hasta 6 m, con hasta dos decimales.\nEjemplo: /maximo 2.50', MAIN_KEYBOARD);
      return;
    }
    await repository.setThreshold(chatId, value);
    await sendMessage(chatId, `✅ Tu altura máxima quedó configurada en *${formatLevel(value)} m*.\nLas alertas están activas.`, MAIN_KEYBOARD);
  }

  async function commandPronostico(chatId) {
    const days = dailyMaximums(await getForecast());
    if (!days.length) {
      await sendMessage(chatId, 'El pronóstico del INA no está disponible en este momento.', MAIN_KEYBOARD);
      return;
    }
    const rows = days.map((row) => {
      const day = new Intl.DateTimeFormat('es-AR', {
        weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/Argentina/Buenos_Aires',
      }).format(parseDate(row.date));
      return `• ${day}: *${formatLevel(row.value)} m*`;
    });
    await sendMessage(chatId, [`🔭 *Pronóstico — ${STATION.name}*`, ...rows, '', '_Máximos diarios estimados por el INA._'].join('\n'), MAIN_KEYBOARD);
  }

  async function commandHistorial(chatId) {
    const rows = normalizeRows(await getHistory()).slice(-6);
    if (!rows.length) {
      await sendMessage(chatId, 'El historial del INA no está disponible en este momento.', MAIN_KEYBOARD);
      return;
    }
    await sendMessage(chatId, [
      `📈 *Últimas mediciones — ${STATION.name}*`,
      ...rows.map((row) => `• ${formatDate(row.date)}: *${formatLevel(row.value)} m*`),
    ].join('\n'), MAIN_KEYBOARD);
  }

  async function processCommand(chatId, chat, text) {
    const { command, argument } = normalizeCommand(text);
    const isStart = command === '/start';
    await repository.touchChat(chat, command, { isStart });
    if (isStart) {
      await configureCommands(COMMANDS);
      await sendMessage(chatId, HELP_TEXT, MAIN_KEYBOARD);
      return;
    }
    switch (command) {
      case '/ayuda':
      case '/help':
        await sendMessage(chatId, HELP_TEXT, MAIN_KEYBOARD);
        break;
      case '/estado':
      case '/nivel':
        await commandEstado(chatId);
        break;
      case '/maximo':
        await commandMaximo(chatId, argument);
        break;
      case '/pronostico':
        await commandPronostico(chatId);
        break;
      case '/historial':
        await commandHistorial(chatId);
        break;
      case '/pausar':
        await repository.setActive(chatId, false);
        await sendMessage(chatId, '⏸️ Tus alertas automáticas quedaron pausadas. Podés reactivarlas con /activar.', MAIN_KEYBOARD);
        break;
      case '/activar':
        await repository.setActive(chatId, true);
        await sendMessage(chatId, '▶️ Tus alertas automáticas están activas.', MAIN_KEYBOARD);
        break;
      default:
        await sendMessage(chatId, `No reconocí ese comando.\n\n${HELP_TEXT}`, MAIN_KEYBOARD);
    }
  }

  async function processUpdate(update) {
    const callback = update?.callback_query;
    const message = callback?.message ?? update?.message;
    const chatId = message?.chat?.id;
    const chat = callback?.from ?? message?.from;
    let text = message?.text?.trim();
    if (callback?.data?.startsWith('cmd:')) text = `/${callback.data.slice(4)}`;
    if (!chatId || !chat || !text) return { processed: false };
    if (callback?.id) {
      await answerCallbackQuery(callback.id).catch((error) => {
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
      return { processed: true, ok: true };
    } catch (error) {
      logger.error('Falló un comando Telegram', {
        chatId: String(chatId),
        command: normalizeCommand(text).command,
        error: error.message,
      });
      await sendMessage(chatId, 'No pude completar la consulta en este momento. Probá nuevamente en unos minutos.', MAIN_KEYBOARD).catch(() => {});
      return { processed: true, ok: false, error };
    }
  }

  async function checkRiver() {
    const startedAt = now();
    let chatsProcessed = 0;
    let alertsSent = 0;
    let errors = 0;
    try {
      const current = await getCurrentObservation();
      const chats = await repository.listActiveChats();
      for (const chat of chats) {
        chatsProcessed += 1;
        if (!shouldAlert(current.value, Number(chat.threshold), chat.lastSent, now())) continue;
        try {
          await sendMessage(chat.chatId, [
            '⚠️ *Río en Alerta*',
            `${STATION.river} — ${STATION.name}: *${formatLevel(current.value)} m*`,
            `Tu altura seleccionada: *${formatLevel(chat.threshold)} m*`,
            `Medición consultada: ${formatDate(current.date)} ART`,
          ].join('\n'), MAIN_KEYBOARD);
          const sentAt = now();
          await repository.recordAlertSent(chat, current, sentAt);
          alertsSent += 1;
        } catch (error) {
          errors += 1;
          logger.error('Falló una alerta Telegram', { chatId: String(chat.id), error: error.message });
        }
      }
      const status = {
        ok: true,
        level: current.value,
        observedAt: current.date,
        chatsProcessed,
        alertsSent,
        errors,
        durationMs: now() - startedAt,
      };
      await repository.setSystemStatus(status);
      logger.info('Revisión horaria completada', { chatsProcessed, alertsSent, errors });
      return status;
    } catch (error) {
      await repository.setSystemStatus({
        ok: false,
        error: error.message,
        durationMs: now() - startedAt,
      });
      logger.error('Falló la revisión horaria', { error: error.message });
      throw error;
    }
  }

  return { checkRiver, processCommand, processUpdate };
}

module.exports = {
  COMMANDS,
  HELP_TEXT,
  MAIN_KEYBOARD,
  createBotCore,
  formatDate,
  formatLevel,
};
