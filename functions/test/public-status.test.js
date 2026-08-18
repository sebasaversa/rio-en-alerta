const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPublicStatusPayload } = require('../public-status');

test('construye el estado público desde la última medición guardada', () => {
  const payload = buildPublicStatusPayload({
    statistics: { sufficient: true, p90Ascent: 0.3, p90Descent: 0.2 },
    current: {
      observedAt: '2026-08-14T22:45:00Z',
      previousObservedAt: '2026-08-14T21:45:00Z',
      currentLevel: 0.93,
      previousLevel: 1.05,
    },
    updatedAt: new Date('2026-08-14T23:00:00Z'),
  }, {
    days: 7,
    forecast: {
      rows: [{ d: '2026-08-16T12:00:00Z', v: 1.2 }],
      updatedAt: new Date('2026-08-15T03:00:00Z'),
      issuedAt: '2026-08-15T09:00:00',
    },
    histories: [{ siteCode: 52, rows: [{ d: '2026-08-14T22:45:00Z', v: 0.93 }], updatedAt: new Date('2026-08-15T03:00:00Z') }],
  });
  assert.equal(payload.current.currentLevel, 0.93);
  assert.equal(payload.source, 'hourly-cache');
  assert.equal(payload.updatedAt, '2026-08-14T23:00:00.000Z');
  assert.equal(payload.forecast.rows[0].v, 1.2);
  assert.equal(payload.forecast.issuedAt, '2026-08-15T09:00:00');
  assert.equal(payload.histories[0].siteCode, 52);
  assert.equal(payload.histories[0].updatedAt, '2026-08-15T03:00:00.000Z');
});

test('no publica un cache sin fecha o altura válida', () => {
  assert.equal(buildPublicStatusPayload({ current: { currentLevel: 0.93 } }), null);
  assert.equal(buildPublicStatusPayload({ current: { observedAt: '2026-08-14', currentLevel: 'no válido' } }), null);
});

test('normaliza las dos mediciones cacheadas para la web', async () => {
  const { observationsFromPublicStatus } = await import('../../src/public-status.mjs');
  const rows = observationsFromPublicStatus({ current: {
    observedAt: '2026-08-14T22:45:00Z',
    currentLevel: 0.93,
    previousObservedAt: '2026-08-14T21:45:00Z',
    previousLevel: 1.05,
  } });
  assert.deepEqual(rows, [
    { date: '2026-08-14T21:45:00Z', value: 1.05 },
    { date: '2026-08-14T22:45:00Z', value: 0.93 },
  ]);
});

test('normaliza series compactas cacheadas sin confundir Array.values con datos', async () => {
  const { normalizeCachedSeriesRows } = await import('../../src/public-status.mjs');
  assert.deepEqual(normalizeCachedSeriesRows([
    { d: '2026-08-15T02:00:00Z', v: 1.1 },
    { d: '2026-08-15T01:00:00Z', v: 1 },
  ]), [
    { date: '2026-08-15T01:00:00Z', value: 1 },
    { date: '2026-08-15T02:00:00Z', value: 1.1 },
  ]);
});

test('expresa claramente cuánto tiempo pasó desde la última medición', async () => {
  const { formatObservationAge } = await import('../../src/public-status.mjs');
  const now = Date.parse('2026-08-15T03:45:00Z');
  assert.equal(formatObservationAge('2026-08-15T03:44:30Z', now), 'menos de un minuto');
  assert.equal(formatObservationAge('2026-08-15T03:00:00', now), '45 minutos');
  assert.equal(formatObservationAge('2026-08-15T03:00:00Z', now), '45 minutos');
  assert.equal(formatObservationAge('2026-08-15T01:00:00Z', now), '2 horas');
  assert.equal(formatObservationAge('2026-08-13T01:00:00Z', now), '2 días');
});
