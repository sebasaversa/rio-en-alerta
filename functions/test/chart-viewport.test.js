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
