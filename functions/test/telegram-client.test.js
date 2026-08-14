const test = require('node:test');
const assert = require('node:assert/strict');
const { TelegramApiError, createTelegramClient } = require('../telegram-client');

function response(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

function clientFor(sequence, overrides = {}) {
  const calls = [];
  const sleeps = [];
  const warnings = [];
  const client = createTelegramClient({
    token: () => 'test-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const next = sequence.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    sleep: async (milliseconds) => sleeps.push(milliseconds),
    logger: { warn: (message, context) => warnings.push({ message, context }) },
    jitterRatio: 0,
    ...overrides,
  });
  return { calls, client, sleeps, warnings };
}

test('respeta retry_after de Telegram ante un 429 y luego completa la llamada', async () => {
  const fixture = clientFor([
    response(429, { ok: false, description: 'Too Many Requests', parameters: { retry_after: 2 } }),
    response(200, { ok: true, result: { message_id: 10 } }),
  ]);

  const result = await fixture.client.request('sendMessage', { chat_id: 1, text: 'hola' });

  assert.deepEqual(result, { message_id: 10 });
  assert.equal(fixture.calls.length, 2);
  assert.deepEqual(fixture.sleeps, [2000]);
  assert.equal(fixture.warnings[0].context.status, 429);
});

test('usa backoff exponencial para errores 5xx transitorios', async () => {
  const fixture = clientFor([
    response(503, { ok: false, description: 'Unavailable' }),
    response(502, { ok: false, description: 'Bad Gateway' }),
    response(200, { ok: true, result: true }),
  ], { baseDelayMs: 400 });

  assert.equal(await fixture.client.request('setMyCommands', { commands: [] }), true);
  assert.deepEqual(fixture.sleeps, [400, 800]);
});

test('reintenta fallos de red y no expone el token en el error', async () => {
  const fixture = clientFor([
    new TypeError('fetch failed'),
    response(200, { ok: true, result: true }),
  ]);

  assert.equal(await fixture.client.request('sendMessage', { chat_id: 1 }), true);
  assert.equal(fixture.calls.length, 2);
  assert.doesNotMatch(fixture.warnings[0].message, /test-token/);
});

test('reintenta una respuesta exitosa con JSON inválido', async () => {
  const invalidJson = response(200, null);
  const fixture = clientFor([
    invalidJson,
    response(200, { ok: true, result: true }),
  ]);

  assert.equal(await fixture.client.request('sendMessage', {}), true);
  assert.equal(fixture.calls.length, 2);
  assert.deepEqual(fixture.sleeps, [500]);
});

test('no reintenta errores permanentes 4xx', async () => {
  const fixture = clientFor([
    response(400, { ok: false, description: 'Bad Request' }),
    response(200, { ok: true, result: true }),
  ]);

  await assert.rejects(
    fixture.client.request('sendMessage', { chat_id: 1 }),
    (error) => error instanceof TelegramApiError && error.status === 400 && error.retryable === false,
  );
  assert.equal(fixture.calls.length, 1);
  assert.deepEqual(fixture.sleeps, []);
});

test('no espera dentro de la función cuando retry_after supera el presupuesto', async () => {
  const fixture = clientFor([
    response(429, { ok: false, parameters: { retry_after: 60 } }),
  ], { maxRetryAfterMs: 30000 });

  await assert.rejects(fixture.client.request('sendMessage', {}), /Telegram sendMessage falló: 429/);
  assert.deepEqual(fixture.sleeps, []);
  assert.match(fixture.warnings[0].message, /presupuesto/);
});
