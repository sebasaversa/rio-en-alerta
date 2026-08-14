const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_ALERT_PREFERENCES,
  alertStateFromChat,
  evaluateAlertTransition,
  normalizeAlertPreferences,
} = require('../alert-machine');

const ALL_ALERTS = {
  height: true,
  rapidRise: true,
  rapidFall: true,
  recovery: true,
};

function evaluate(overrides = {}) {
  return evaluateAlertTransition({
    current: { value: 2.5, date: '2026-08-14T12:00:00Z' },
    threshold: 3,
    preferences: ALL_ALERTS,
    previousState: {},
    velocity: { code: 'normal-rise', speedMetersPerHour: 0.1, speedCentimetersPerHour: 10 },
    statistics: { p90Ascent: 0.33, p90Descent: 0.16 },
    ...overrides,
  });
}

test('mantiene sólo altura activa por defecto para no cambiar suscripciones existentes', () => {
  assert.deepEqual(DEFAULT_ALERT_PREFERENCES, {
    height: true,
    rapidRise: false,
    rapidFall: false,
    recovery: false,
  });
  assert.deepEqual(normalizeAlertPreferences({ rapidRise: true }), {
    height: true,
    rapidRise: true,
    rapidFall: false,
    recovery: false,
  });
});

test('migra la última alerta por altura sin duplicarla en el primer ciclo nuevo', () => {
  assert.equal(alertStateFromChat({ threshold: 3, lastAlertLevel: 3.1 }).heightCondition, 'above');
  assert.equal(alertStateFromChat({ threshold: 3, lastAlertLevel: 2.9 }).heightCondition, 'unknown');
});

test('avisa una sola vez al entrar por encima de la altura personal', () => {
  const first = evaluate({ current: { value: 3.05, date: '2026-08-14T12:00:00Z' } });
  assert.deepEqual(first.events.map((event) => event.type), ['height']);
  assert.equal(first.state.heightCondition, 'above');

  const continued = evaluate({
    current: { value: 3.2, date: '2026-08-14T13:00:00Z' },
    previousState: first.state,
  });
  assert.deepEqual(continued.events, []);
  assert.equal(continued.state.heightCondition, 'above');
});

test('aplica histéresis de 10 cm antes de avisar recuperación y rearmar altura', () => {
  const above = { heightCondition: 'above', velocityCondition: 'normal', lastObservationAt: '2026-08-14T12:00:00Z' };
  const notRecovered = evaluate({
    current: { value: 2.91, date: '2026-08-14T13:00:00Z' },
    previousState: above,
  });
  assert.deepEqual(notRecovered.events, []);
  assert.equal(notRecovered.state.heightCondition, 'above');

  const recovered = evaluate({
    current: { value: 2.9, date: '2026-08-14T14:00:00Z' },
    previousState: notRecovered.state,
  });
  assert.deepEqual(recovered.events.map((event) => event.type), ['recovery']);
  assert.equal(recovered.events[0].recoveryLevel, 2.9);
  assert.equal(recovered.state.heightCondition, 'below');

  const reentered = evaluate({
    current: { value: 3, date: '2026-08-14T15:00:00Z' },
    previousState: recovered.state,
  });
  assert.deepEqual(reentered.events.map((event) => event.type), ['height']);
});

test('avisa crecida rápida por p90 independientemente de la altura', () => {
  const result = evaluate({
    current: { value: 1.2, date: '2026-08-14T12:00:00Z' },
    velocity: { code: 'rapid-rise', speedMetersPerHour: 0.33, speedCentimetersPerHour: 33 },
  });
  assert.deepEqual(result.events.map((event) => event.type), ['rapidRise']);
  assert.equal(result.events[0].p90MetersPerHour, 0.33);
});

test('avisa bajante rápida con el p90 de descensos', () => {
  const result = evaluate({
    velocity: { code: 'rapid-fall', speedMetersPerHour: -0.2, speedCentimetersPerHour: -20 },
  });
  assert.deepEqual(result.events.map((event) => event.type), ['rapidFall']);
  assert.equal(result.events[0].p90MetersPerHour, -0.16);
});

test('no repite una condición rápida y la rearma después de una medición normal', () => {
  const rapid = evaluate({
    velocity: { code: 'rapid-rise', speedMetersPerHour: 0.4, speedCentimetersPerHour: 40 },
  });
  const repeated = evaluate({
    current: { value: 2.6, date: '2026-08-14T13:00:00Z' },
    previousState: rapid.state,
    velocity: { code: 'rapid-rise', speedMetersPerHour: 0.35, speedCentimetersPerHour: 35 },
  });
  assert.deepEqual(repeated.events, []);

  const normal = evaluate({
    current: { value: 2.65, date: '2026-08-14T14:00:00Z' },
    previousState: repeated.state,
    velocity: { code: 'normal-rise', speedMetersPerHour: 0.05, speedCentimetersPerHour: 5 },
  });
  assert.equal(normal.state.velocityCondition, 'normal');

  const rapidAgain = evaluate({
    current: { value: 2.7, date: '2026-08-14T15:00:00Z' },
    previousState: normal.state,
    velocity: { code: 'rapid-rise', speedMetersPerHour: 0.5, speedCentimetersPerHour: 50 },
  });
  assert.deepEqual(rapidAgain.events.map((event) => event.type), ['rapidRise']);
});

test('procesa cada timestamp una sola vez aunque se repita la consulta', () => {
  const previousState = {
    heightCondition: 'below',
    velocityCondition: 'normal',
    lastObservationAt: '2026-08-14T12:00:00Z',
  };
  const result = evaluate({ previousState });
  assert.equal(result.processed, false);
  assert.deepEqual(result.events, []);
  assert.deepEqual(result.state, previousState);
});
