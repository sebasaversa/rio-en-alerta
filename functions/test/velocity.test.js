const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateCurrentVelocity,
  calculateVelocityIntervals,
  calculateVelocityStatistics,
  classifySpeed,
  metersPerHourToCentimeters,
  normalizeVelocityObservations,
  percentile,
} = require('../velocity');

function payload(rows) {
  return { data: rows.map(([timestart, valor]) => ({ timestart, valor })) };
}

test('calcula velocidades con intervalos irregulares en metros por hora', () => {
  const { intervals } = calculateVelocityIntervals(payload([
    ['2026-01-01T00:00:00', 1],
    ['2026-01-01T02:00:00', 1.2],
    ['2026-01-01T05:00:00', 1.05],
  ]));
  assert.equal(intervals.length, 2);
  assert.ok(Math.abs(intervals[0].speed - 0.1) < 1e-12);
  assert.ok(Math.abs(intervals[1].speed + 0.05) < 1e-12);
});

test('calcula percentil 90 mediante interpolación lineal', () => {
  assert.equal(percentile([4, 1, 3, 2], 0.9), 3.7);
});

test('separa ascensos y descensos para sus percentiles independientes', () => {
  const rows = [];
  const start = Date.parse('2026-01-01T00:00:00Z');
  for (let index = 0; index <= 24 * 100; index += 1) {
    rows.push([new Date(start + index * 60 * 60 * 1000).toISOString(), index % 2 ? 1.2 : 1]);
  }
  const stats = calculateVelocityStatistics(payload(rows));
  assert.equal(stats.sufficient, true);
  assert.ok(Math.abs(stats.p90Ascent - 0.2) < 1e-12);
  assert.ok(Math.abs(stats.p90Descent - 0.2) < 1e-12);
  assert.equal(stats.ascentCount, 1200);
  assert.equal(stats.descentCount, 1200);
});

test('elimina timestamps duplicados y ordena datos desordenados', () => {
  const rows = normalizeVelocityObservations(payload([
    ['2026-01-01T02:00:00', 1.2],
    ['2026-01-01T00:00:00', 1],
    ['2026-01-01T02:00:00', 1.3],
    ['2026-01-01T01:00:00', 1.1],
  ]));
  assert.deepEqual(rows.map((row) => row.value), [1, 1.1, 1.3]);
});

test('ignora niveles inválidos e intervalos excesivamente largos', () => {
  const { observations, intervals } = calculateVelocityIntervals(payload([
    ['fecha-invalida', 1],
    ['2026-01-01T00:00:00', 1],
    ['2026-01-01T01:00:00', 100],
    ['2026-01-01T02:00:00', 1.2],
    ['2026-01-01T12:00:00', 1.3],
  ]));
  assert.deepEqual(observations.map((row) => row.value), [1, 1.2, 1.3]);
  assert.equal(intervals.length, 1);
  assert.ok(Math.abs(intervals[0].speed - 0.1) < 1e-12);
});

test('rechaza un historial sin cobertura o intervalos suficientes', () => {
  const stats = calculateVelocityStatistics(payload([
    ['2026-01-01T00:00:00', 1],
    ['2026-01-01T01:00:00', 1.1],
    ['2026-01-01T02:00:00', 1],
  ]));
  assert.equal(stats.sufficient, false);
  assert.equal(stats.p90Ascent, null);
  assert.equal(stats.p90Descent, null);
  assert.deepEqual(stats.reasons, ['coverage', 'intervals']);
});

test('clasifica como rápida una velocidad exactamente igual al percentil', () => {
  const statistics = { sufficient: true, p90Ascent: 0.1, p90Descent: 0.08 };
  assert.equal(classifySpeed(0.1, statistics).code, 'rapid-rise');
  assert.equal(classifySpeed(-0.08, statistics).code, 'rapid-fall');
});

test('no genera una nueva detección para la misma medición del INA', () => {
  const statistics = {
    sufficient: true, p90Ascent: 0.1, p90Descent: 0.1, maxIntervalHours: 6, minLevel: -5, maxLevel: 10,
  };
  const rows = payload([
    ['2026-01-01T00:00:00', 1],
    ['2026-01-01T01:00:00', 1.2],
  ]);
  const result = calculateCurrentVelocity(rows, statistics, {
    lastProcessedObservationAt: '2026-01-01T01:00:00',
  });
  assert.equal(result.code, 'no-new-observation');
  assert.equal(result.isNewObservation, false);
});

test('convierte metros por hora a centímetros por hora', () => {
  assert.equal(metersPerHourToCentimeters(0.18), 18);
  assert.ok(Math.abs(metersPerHourToCentimeters(-0.07) + 7) < 1e-12);
});
