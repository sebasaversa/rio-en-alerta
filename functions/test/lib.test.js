const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ALERT_COOLDOWN_MS,
  currentObservation,
  dailyMaximums,
  dailyRanges,
  historyRangeDays,
  normalizeCommand,
  normalizeRows,
  observationUrl,
  parseThreshold,
  shouldAlert,
} = require('../lib');
const observedFixture = require('./fixtures/ina-observed.json');
const forecastFixture = require('./fixtures/ina-forecast.json');

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

test('mantiene el contrato real de datos observados del INA', () => {
  assert.equal(observedFixture.responseHeader.sitecode, 52);
  assert.equal(observedFixture.responseHeader.seriesmetadata.unit_abrev, 'm');
  const rows = normalizeRows(observedFixture);
  assert.equal(rows.length, 6);
  assert.equal(rows[0].value, 1.81);
  assert.equal(currentObservation(observedFixture).value, 2.28);
});

test('resume mínimas y máximas diarias del fixture real de pronóstico', () => {
  assert.equal(forecastFixture.responseHeader.calid, 432);
  assert.equal(forecastFixture.responseHeader.model_name, 'marea_rdp_regre');
  assert.deepEqual(dailyRanges(forecastFixture), [
    { date: '2026-08-14T08:00:00', min: 0.437286, max: 2.06651 },
    { date: '2026-08-15T03:00:00', min: 0.362271, max: 0.958514 },
  ]);
});

test('solo acepta los rangos documentados para historial', () => {
  assert.equal(historyRangeDays(''), 1);
  assert.equal(historyRangeDays('24h'), 1);
  assert.equal(historyRangeDays('1D'), 1);
  assert.equal(historyRangeDays('7d'), 7);
  assert.equal(historyRangeDays('30d'), 30);
  assert.equal(historyRangeDays('2d'), null);
});
