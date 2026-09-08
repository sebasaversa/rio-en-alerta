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

for (const [direction, sign, p90, p95, type] of [
  ['rise', 1, 0.33, 0.4, 'rapidRise'],
  ['fall', -1, 0.16, 0.2, 'rapidFall'],
]) {
  test(`histéresis ${direction}: p95 activa, igualdad con p90 no rearma y bajar de p90 sí`, () => {
    let previousState = {};
    const speeds = [p90, (p90 + p95) / 2, p95, (p90 + p95) / 2, p95, p90, p95, p90 - 0.01, p95];
    const emitted = [];
    speeds.forEach((magnitude, index) => {
      const speed = sign * magnitude;
      const result = evaluate({
        current: { value: 1, date: new Date(Date.UTC(2026, 7, 14, index)).toISOString() },
        previousState,
        velocity: {
          code: `${magnitude >= p95 ? 'rapid' : 'normal'}-${direction}`,
          speedMetersPerHour: speed, speedCentimetersPerHour: speed * 100,
        },
      });
      if (result.events.length) emitted.push([index, result.events[0].type]);
      if (index >= 2 && index <= 6) assert.equal(result.state.velocityCondition, `rapid-${direction}`);
      previousState = result.state;
    });
    assert.deepEqual(emitted, [[2, type], [8, type]]);
  });
}

test('un cambio de dirección permite avisar el episodio opuesto y rearma el anterior', () => {
  const rise = evaluate({ velocity: { code: 'rapid-rise', speedMetersPerHour: 0.4 } });
  const fall = evaluate({
    current: { value: 1, date: '2026-08-14T13:00:00Z' }, previousState: rise.state,
    velocity: { code: 'rapid-fall', speedMetersPerHour: -0.2 },
  });
  assert.deepEqual(fall.events.map((event) => event.type), ['rapidFall']);
  const riseAgain = evaluate({
    current: { value: 1.4, date: '2026-08-14T14:00:00Z' }, previousState: fall.state,
    velocity: { code: 'rapid-rise', speedMetersPerHour: 0.4 },
  });
  assert.deepEqual(riseAgain.events.map((event) => event.type), ['rapidRise']);
});

test('datos incompletos no rearman un episodio ni impiden el aviso por altura', () => {
  const previousState = { velocityCondition: 'rapid-rise', heightCondition: 'below' };
  for (const velocity of [{ code: 'insufficient' }, { code: 'no-new-observation' },
    { code: 'normal-rise' }]) {
    const result = evaluate({ previousState, velocity, current: { value: 3.1, date: '2026-08-14T12:00:00Z' } });
    assert.equal(result.state.velocityCondition, 'rapid-rise');
    assert.deepEqual(result.events.map((event) => event.type), ['height']);
  }
  const legacy = evaluate({
    previousState,
    statistics: { sufficient: true, p90Ascent: 0.33, p90Descent: 0.16 },
    velocity: { code: 'rapid-fall', speedMetersPerHour: -0.5 },
  });
  assert.equal(legacy.state.velocityCondition, 'rapid-rise');
  assert.deepEqual(legacy.events, []);
});

function evaluate(overrides = {}) {
  return evaluateAlertTransition({
    current: { value: 2.5, date: '2026-08-14T12:00:00Z' },
    threshold: 3,
    preferences: ALL_ALERTS,
    previousState: {},
    velocity: { code: 'normal-rise', speedMetersPerHour: 0.1, speedCentimetersPerHour: 10 },
    statistics: { sufficient: true, p90Ascent: 0.33, p90Descent: 0.16, p95Ascent: 0.4, p95Descent: 0.2 },
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

test('avisa crecida rápida por p95 independientemente de la altura', () => {
  const result = evaluate({
    current: { value: 1.2, date: '2026-08-14T12:00:00Z' },
    velocity: { code: 'rapid-rise', speedMetersPerHour: 0.4, speedCentimetersPerHour: 40 },
  });
  assert.deepEqual(result.events.map((event) => event.type), ['rapidRise']);
  assert.equal(result.events[0].p95MetersPerHour, 0.4);
});

test('avisa bajante rápida con el p95 de descensos', () => {
  const result = evaluate({
    velocity: { code: 'rapid-fall', speedMetersPerHour: -0.2, speedCentimetersPerHour: -20 },
  });
  assert.deepEqual(result.events.map((event) => event.type), ['rapidFall']);
  assert.equal(result.events[0].p95MetersPerHour, -0.2);
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
