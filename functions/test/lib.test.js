const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ALERT_COOLDOWN_MS,
  currentObservation,
  dailyMaximums,
  normalizeCommand,
  normalizeRows,
  observationUrl,
  parseThreshold,
  shouldAlert,
} = require('../lib');

const payload = {
  data: [
    { timestart: '2026-08-13T12:00:00', valor: '0.92' },
    { timestart: '2026-08-13T10:00:00', valor: '0.88' },
    { timestart: '2026-08-13T14:00:00', valor: '0.95' },
    { timestart: null, valor: '99' },
  ],
};

test('normaliza y ordena observaciones de más antigua a más reciente', () => {
  assert.deepEqual(normalizeRows(payload).map((row) => row.value), [0.88, 0.92, 0.95]);
  assert.equal(currentObservation(payload).value, 0.95);
});

test('mantiene la sintaxis especial de la API del INA', () => {
  const url = observationUrl(new Date('2026-08-13T12:00:00Z'), 1);
  assert.match(url, /\/datos&timeStart=2026-08-12&timeEnd=2026-08-13/);
  assert.match(url, /siteCode=52/);
  assert.doesNotMatch(url, /\/datos\?/);
});

test('normaliza comandos con usuario del bot y argumentos', () => {
  assert.deepEqual(normalizeCommand('/MAXIMO@TigreRioEnAlertaSF_bot 2,50'), {
    command: '/maximo', argument: '2,50',
  });
});

test('valida el máximo sin convertir el argumento vacío en cero', () => {
  assert.equal(parseThreshold(''), null);
  assert.equal(parseThreshold('0'), null);
  assert.equal(parseThreshold('6.01'), null);
  assert.equal(parseThreshold('2,50'), 2.5);
  assert.equal(parseThreshold('2.555'), null);
});

test('respeta la ventana anti-duplicado de seis horas', () => {
  const now = Date.now();
  assert.equal(shouldAlert(3.1, 3, 0, now), true);
  assert.equal(shouldAlert(2.9, 3, 0, now), false);
  assert.equal(shouldAlert(3.1, 3, now - ALERT_COOLDOWN_MS + 1, now), false);
  assert.equal(shouldAlert(3.1, 3, now - ALERT_COOLDOWN_MS, now), true);
});

test('elige un máximo por día para el pronóstico', () => {
  const rows = dailyMaximums({ data: [
    { timestart: '2026-08-13T10:00:00', valor: 1.1 },
    { timestart: '2026-08-13T17:00:00', valor: 1.4 },
    { timestart: '2026-08-14T12:00:00', valor: 1.2 },
  ] });
  assert.deepEqual(rows.map((row) => row.value), [1.4, 1.2]);
});
