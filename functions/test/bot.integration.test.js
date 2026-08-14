const test = require('node:test');
const assert = require('node:assert/strict');
const { createBotCore } = require('../bot-core');
const { alertStateFromChat, normalizeAlertPreferences, normalizeAlertState } = require('../alert-machine');
const forecastFixture = require('./fixtures/ina-forecast.json');

class InMemoryRepository {
  constructor(initialChats = []) {
    this.chats = new Map(initialChats.map((chat) => [String(chat.id ?? chat.chatId), { ...chat }]));
    this.alertEvents = [];
    this.statuses = [];
    this.thresholdWrites = 0;
    this.activityWrites = 0;
  }

  async touchChat(chat, command, { isStart = false } = {}) {
    const id = String(chat.id);
    const previous = this.chats.get(id) ?? {};
    this.chats.set(id, {
      ...previous,
      id,
      chatId: chat.id,
      firstName: chat.first_name ?? null,
      lastName: chat.last_name ?? null,
      username: chat.username ?? null,
      threshold: Number.isFinite(previous.threshold) ? previous.threshold : 2.5,
      alertPreferences: normalizeAlertPreferences(previous.alertPreferences),
      alertState: alertStateFromChat(previous),
      dailySummary: Boolean(previous.dailySummary),
      active: isStart ? true : Boolean(previous.active),
      firstSeenAt: previous.firstSeenAt ?? new Date(),
      joinedAt: isStart ? (previous.joinedAt ?? new Date()) : previous.joinedAt,
      lastActiveAt: new Date(),
      lastCommand: command,
      lastSent: previous.lastSent ?? 0,
    });
    this.activityWrites += 1;
  }

  async getChat(chatId) {
    return this.chats.get(String(chatId)) ?? null;
  }

  async setThreshold(chatId, threshold) {
    const id = String(chatId);
    const previous = this.chats.get(id) ?? { id, chatId };
    this.chats.set(id, {
      ...previous,
      threshold,
      active: true,
      joinedAt: previous.joinedAt ?? new Date(),
      alertState: { ...normalizeAlertState(previous.alertState), heightCondition: 'unknown' },
    });
    this.thresholdWrites += 1;
  }

  async setActive(chatId, active) {
    const id = String(chatId);
    const previous = this.chats.get(id) ?? { id, chatId };
    this.chats.set(id, { ...previous, active, joinedAt: active ? (previous.joinedAt ?? new Date()) : previous.joinedAt });
  }

  async listActiveChats() {
    return [...this.chats.values()].filter((chat) => chat.active);
  }

  async listDailySummaryChats() {
    return [...this.chats.values()].filter((chat) => chat.dailySummary);
  }

  async setDailySummary(chatId, enabled) {
    const id = String(chatId);
    const previous = this.chats.get(id) ?? { id, chatId };
    this.chats.set(id, { ...previous, dailySummary: enabled });
  }

  async setAlertPreference(chatId, key, enabled) {
    const id = String(chatId);
    const previous = this.chats.get(id) ?? { id, chatId };
    const alertPreferences = normalizeAlertPreferences(previous.alertPreferences);
    alertPreferences[key] = Boolean(enabled);
    this.chats.set(id, { ...previous, alertPreferences });
    return alertPreferences;
  }

  async claimDailySummary(chatId, dateKey) {
    const id = String(chatId);
    const chat = this.chats.get(id);
    if (!chat?.dailySummary || chat.lastSummaryDate === dateKey) return false;
    this.chats.set(id, { ...chat, lastSummaryDate: dateKey });
    return true;
  }

  async saveAlertState(chatId, state) {
    const id = String(chatId);
    this.chats.set(id, { ...this.chats.get(id), alertState: normalizeAlertState(state) });
  }

  async recordAlertsSent(chat, current, state, events, sentAt) {
    const id = String(chat.id ?? chat.chatId);
    this.chats.set(id, {
      ...this.chats.get(id),
      alertState: normalizeAlertState(state),
      lastSent: sentAt,
      lastAlertLevel: current.value,
      lastAlertTypes: events.map((event) => event.type),
    });
    events.forEach((event) => this.alertEvents.push({
      chatId: chat.chatId,
      type: event.type,
      level: current.value,
      threshold: chat.threshold,
    }));
  }

  async setSystemStatus(status) {
    this.statuses.push({ ...status });
  }
}

function createFixture(overrides = {}) {
  const repository = overrides.repository ?? new InMemoryRepository();
  const messages = [];
  const callbacks = [];
  const logs = { info: [], warn: [], error: [] };
  const bot = createBotCore({
    repository,
    sendMessage: overrides.sendMessage ?? (async (chatId, text) => messages.push({ chatId, text })),
    answerCallbackQuery: async (id) => callbacks.push(id),
    configureCommands: async () => {},
    getCurrentObservation: overrides.getCurrentObservation ?? (async () => ({
      value: 0.95,
      date: '2026-08-14T14:00:00Z',
    })),
    getForecast: overrides.getForecast ?? (async () => ({ data: [] })),
    getHistory: overrides.getHistory ?? (async () => ({ data: [] })),
    logger: {
      info: (message, context) => logs.info.push({ message, context }),
      warn: (message, context) => logs.warn.push({ message, context }),
      error: (message, context) => logs.error.push({ message, context }),
    },
    now: overrides.now ?? (() => Date.parse('2026-08-14T15:00:00Z')),
  });
  return { bot, callbacks, logs, messages, repository };
}

function update(chatId, text, updateId = 1) {
  return {
    update_id: updateId,
    message: {
      chat: { id: chatId },
      from: { id: chatId, first_name: 'Prueba', username: `user${chatId}` },
      text,
    },
  };
}

test('integra webhook, comandos y persistencia sin modificar el máximo al consultarlo', async () => {
  const fixture = createFixture();

  assert.deepEqual(await fixture.bot.processUpdate(update(10, '/start')), { processed: true, ok: true });
  assert.equal(fixture.repository.chats.get('10').active, true);
  assert.equal(fixture.repository.chats.get('10').threshold, 2.5);
  assert.ok(fixture.repository.chats.get('10').joinedAt);

  await fixture.bot.processUpdate(update(10, '/maximo 3,00', 2));
  assert.equal(fixture.repository.chats.get('10').threshold, 3);
  assert.equal(fixture.repository.thresholdWrites, 1);

  await fixture.bot.processUpdate(update(10, '/maximo', 3));
  assert.equal(fixture.repository.chats.get('10').threshold, 3);
  assert.equal(fixture.repository.thresholdWrites, 1);
  assert.match(fixture.messages.at(-1).text, /3,00 m/);

  await fixture.bot.processUpdate(update(10, '/estado', 4));
  assert.match(fixture.messages.at(-1).text, /Río Luján — San Fernando/);
  assert.match(fixture.messages.at(-1).text, /0,95 m/);
  assert.equal(fixture.repository.activityWrites, 4);
});

test('procesa botones inline y registra actividad', async () => {
  const fixture = createFixture();
  const result = await fixture.bot.processUpdate({
    update_id: 5,
    callback_query: {
      id: 'callback-1',
      data: 'cmd:estado',
      from: { id: 20, first_name: 'Botón' },
      message: { chat: { id: 20 } },
    },
  });

  assert.deepEqual(result, { processed: true, ok: true });
  assert.deepEqual(fixture.callbacks, ['callback-1']);
  assert.equal(fixture.repository.chats.get('20').lastCommand, '/estado');
  assert.match(fixture.messages[0].text, /Altura actual/);
});

test('configura avisos individuales mediante comando y botones', async () => {
  const fixture = createFixture();
  await fixture.bot.processUpdate(update(25, '/start'));
  await fixture.bot.processUpdate(update(25, '/avisos', 2));
  assert.match(fixture.messages.at(-1).text, /Altura máxima/);
  assert.equal(fixture.repository.chats.get('25').alertPreferences.rapidRise, false);

  const result = await fixture.bot.processUpdate({
    update_id: 3,
    callback_query: {
      id: 'callback-avisos',
      data: 'notice:rapidRise',
      from: { id: 25, first_name: 'Botón' },
      message: { chat: { id: 25 } },
    },
  });
  assert.deepEqual(result, { processed: true, ok: true });
  assert.equal(fixture.repository.chats.get('25').alertPreferences.rapidRise, true);
  assert.match(fixture.messages.at(-1).text, /✅ Crecida rápida/);
  assert.equal(fixture.repository.chats.get('25').lastCommand, '/avisos');
});

test('muestra rango diario en pronóstico y respeta el rango solicitado de historial', async () => {
  const requestedDays = [];
  const fixture = createFixture({
    getForecast: async () => forecastFixture,
    getHistory: async (days) => {
      requestedDays.push(days);
      return { data: [
        { timestart: '2026-08-13T03:00:00', valor: 1 },
        { timestart: '2026-08-13T12:00:00', valor: 2 },
        { timestart: '2026-08-14T03:00:00', valor: 0.5 },
        { timestart: '2026-08-14T12:00:00', valor: 1.5 },
      ] };
    },
  });

  await fixture.bot.processUpdate(update(30, '/pronostico'));
  assert.match(fixture.messages.at(-1).text, /mín\. \*0,44 m\* · máx\. \*2,07 m\*/);

  await fixture.bot.processUpdate(update(30, '/historial 7d', 2));
  assert.deepEqual(requestedDays, [7]);
  assert.match(fixture.messages.at(-1).text, /Historial de 7 días/);
  assert.match(fixture.messages.at(-1).text, /mín\. \*1,00 m\* · máx\. \*2,00 m\*/);

  await fixture.bot.processUpdate(update(30, '/historial 2d', 3));
  assert.deepEqual(requestedDays, [7]);
  assert.match(fixture.messages.at(-1).text, /\/historial 24h/);
});

test('configura y envía una sola vez el resumen diario de las 08:00', async () => {
  const fixture = createFixture();
  await fixture.bot.processUpdate(update(40, '/start'));
  assert.match(fixture.messages.at(-1).text, /\/resumen activar/);

  await fixture.bot.processUpdate(update(40, '/resumen', 2));
  assert.match(fixture.messages.at(-1).text, /pausado/);
  await fixture.bot.processUpdate(update(40, '/resumen activar', 3));
  assert.equal(fixture.repository.chats.get('40').dailySummary, true);

  const summary = {
    current: { value: 1.2, date: '2026-08-14T11:00:00Z' },
    dateKey: '2026-08-14',
    velocityData: {
      statistics: { sufficient: true },
      current: {
        label: 'Subida rápida',
        speedMetersPerHour: 0.18,
        speedCentimetersPerHour: 18,
      },
    },
  };
  assert.deepEqual(await fixture.bot.sendDailySummaries(summary), {
    chats: 1, sent: 1, skipped: 0, errors: 0,
  });
  assert.match(fixture.messages.at(-1).text, /Subida rápida/);
  assert.match(fixture.messages.at(-1).text, /08:00/);
  assert.deepEqual(await fixture.bot.sendDailySummaries(summary), {
    chats: 1, sent: 0, skipped: 1, errors: 0,
  });

  await fixture.bot.sendDailySummaries({
    ...summary,
    dateKey: '2026-08-15',
    velocityData: { statistics: { sufficient: false } },
  });
  assert.match(fixture.messages.at(-1).text, /datos insuficientes/);

  await fixture.bot.processUpdate(update(40, '/resumen pausar', 4));
  assert.equal(fixture.repository.chats.get('40').dailySummary, false);
});

test('checkRiver evalúa máximos independientes y continúa si falla un chat', async () => {
  const repository = new InMemoryRepository([
    { id: '1', chatId: 1, threshold: 1, active: true, lastSent: 0 },
    { id: '2', chatId: 2, threshold: 2, active: true, lastSent: 0 },
    { id: '3', chatId: 3, threshold: 4, active: true, lastSent: 0 },
    { id: '4', chatId: 4, threshold: 1, active: false, lastSent: 0 },
  ]);
  const delivered = [];
  const fixture = createFixture({
    repository,
    getCurrentObservation: async () => ({ value: 2.5, date: '2026-08-14T14:00:00Z' }),
    sendMessage: async (chatId, text) => {
      if (chatId === 1) throw new Error('Telegram temporal');
      delivered.push({ chatId, text });
    },
  });

  const status = await fixture.bot.checkRiver();

  assert.deepEqual(status, {
    ok: true,
    level: 2.5,
    observedAt: '2026-08-14T14:00:00Z',
    chatsProcessed: 3,
    alertsSent: 1,
    errors: 1,
    durationMs: 0,
  });
  assert.deepEqual(delivered.map((message) => message.chatId), [2]);
  assert.deepEqual(repository.alertEvents, [{ chatId: 2, type: 'height', level: 2.5, threshold: 2 }]);
  assert.equal(repository.chats.get('1').lastSent, 0);
  assert.equal(repository.chats.get('2').lastSent, Date.parse('2026-08-14T15:00:00Z'));
});

test('envía avisos estadísticos una vez por estado y recuperación con histéresis', async () => {
  const repository = new InMemoryRepository([{
    id: '9',
    chatId: 9,
    threshold: 3,
    active: true,
    alertPreferences: { height: true, rapidRise: true, rapidFall: true, recovery: true },
  }]);
  const fixture = createFixture({ repository });
  const statistics = { p90Ascent: 0.33, p90Descent: 0.16 };

  await fixture.bot.checkRiver(
    { value: 2.5, date: '2026-08-14T12:00:00Z' },
    {
      isNewObservation: true,
      statistics,
      detection: { code: 'rapid-rise', speedMetersPerHour: 0.4, speedCentimetersPerHour: 40 },
    },
  );
  assert.match(fixture.messages.at(-1).text, /Crecida rápida/);
  assert.equal(fixture.messages.at(-1).text.includes('Alcanzó tu altura'), false);

  await fixture.bot.checkRiver(
    { value: 3.1, date: '2026-08-14T13:00:00Z' },
    {
      isNewObservation: true,
      statistics,
      detection: { code: 'rapid-rise', speedMetersPerHour: 0.5, speedCentimetersPerHour: 50 },
    },
  );
  assert.match(fixture.messages.at(-1).text, /Alcanzó tu altura/);
  assert.equal(fixture.messages.at(-1).text.match(/Crecida rápida/g), null);

  const beforeHysteresis = fixture.messages.length;
  await fixture.bot.checkRiver(
    { value: 2.91, date: '2026-08-14T14:00:00Z' },
    { isNewObservation: true, statistics, detection: { code: 'normal-fall' } },
  );
  assert.equal(fixture.messages.length, beforeHysteresis);

  await fixture.bot.checkRiver(
    { value: 2.9, date: '2026-08-14T15:00:00Z' },
    { isNewObservation: true, statistics, detection: { code: 'normal-fall' } },
  );
  assert.match(fixture.messages.at(-1).text, /Recuperación/);
  assert.deepEqual(repository.alertEvents.map((event) => event.type), ['rapidRise', 'height', 'recovery']);
});

test('no procesa chats cuando el INA todavía devuelve la misma medición', async () => {
  const repository = new InMemoryRepository([{
    id: '11', chatId: 11, threshold: 1, active: true,
  }]);
  const fixture = createFixture({ repository });
  const status = await fixture.bot.checkRiver(
    { value: 3.2, date: '2026-08-14T12:00:00Z' },
    { isNewObservation: false, detection: { code: 'rapid-rise' } },
  );
  assert.equal(status.chatsProcessed, 0);
  assert.equal(status.alertsSent, 0);
  assert.deepEqual(repository.alertEvents, []);
  assert.equal(repository.chats.get('11').alertState, undefined);
});

test('registra el estado fallido y propaga un error del INA sin generar alertas', async () => {
  const repository = new InMemoryRepository([
    { id: '1', chatId: 1, threshold: 1, active: true, lastSent: 0 },
  ]);
  const fixture = createFixture({
    repository,
    getCurrentObservation: async () => { throw new Error('INA no disponible'); },
  });

  await assert.rejects(fixture.bot.checkRiver(), /INA no disponible/);
  assert.deepEqual(repository.alertEvents, []);
  assert.deepEqual(repository.statuses.at(-1), {
    ok: false,
    error: 'INA no disponible',
    durationMs: 0,
  });
});
