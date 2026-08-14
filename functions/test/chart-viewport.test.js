const test = require('node:test');
const assert = require('node:assert/strict');

test('acerca la vista alrededor del punto indicado', async () => {
  const { zoomViewport } = await import('../../src/chart-viewport.mjs');
  assert.deepEqual(zoomViewport({ start: 0, end: 1 }, 2, 0.25), {
    start: 0.125,
    end: 0.625,
  });
});

test('limita el zoom máximo y no sale del período disponible', async () => {
  const { zoomViewport } = await import('../../src/chart-viewport.mjs');
  assert.deepEqual(zoomViewport({ start: 0, end: 1 }, 100, 1), {
    start: 0.95,
    end: 1,
  });
});

test('desplaza una vista ampliada y respeta ambos extremos', async () => {
  const { panViewport } = await import('../../src/chart-viewport.mjs');
  assert.deepEqual(panViewport({ start: 0.25, end: 0.75 }, 0.2), {
    start: 0.45,
    end: 0.95,
  });
  assert.deepEqual(panViewport({ start: 0.25, end: 0.75 }, -1), {
    start: 0,
    end: 0.5,
  });
});

test('convierte la ventana proporcional a timestamps reales', async () => {
  const { viewportTimestamps } = await import('../../src/chart-viewport.mjs');
  assert.deepEqual(viewportTimestamps(1_000, 5_000, { start: 0.25, end: 0.75 }), {
    start: 2_000,
    end: 4_000,
  });
});

test('detecta la vista completa aun después de normalizarla', async () => {
  const { isFullViewport } = await import('../../src/chart-viewport.mjs');
  assert.equal(isFullViewport({ start: -1, end: 2 }), true);
  assert.equal(isFullViewport({ start: 0.1, end: 0.9 }), false);
});

test('crea una escala legible con cinco o seis marcas y margen visual', async () => {
  const { niceScale } = await import('../../src/chart-viewport.mjs');
  assert.deepEqual(niceScale([0.72, 1.48]), {
    min: 0.6,
    max: 1.6,
    step: 0.2,
    ticks: [0.6, 0.8, 1, 1.2, 1.4, 1.6],
  });
});

test('la escala de detalle no agrega valores negativos si todas las alturas son positivas', async () => {
  const { niceScale } = await import('../../src/chart-viewport.mjs');
  const scale = niceScale([0.01, 0.08]);
  assert.equal(scale.min, 0);
  assert.ok(scale.ticks.length >= 5);
});

test('encuentra la medición temporalmente más cercana', async () => {
  const { nearestRow } = await import('../../src/chart-viewport.mjs');
  const rows = [
    { date: '2026-08-10T10:00:00', value: 1.1 },
    { date: '2026-08-10T12:00:00', value: 1.3 },
  ];
  assert.equal(nearestRow(rows, Date.parse('2026-08-10T11:40:00Z')).value, 1.3);
  assert.equal(nearestRow([], Date.now()), null);
});
