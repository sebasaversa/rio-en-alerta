const test = require('node:test');
const assert = require('node:assert/strict');
const {
  compactPublicRows,
  filterCompactRows,
  mergeCompactRows,
  parsePublicHistoryDays,
} = require('../public-cache');

test('compacta, ordena y conserva únicamente fecha y altura', () => {
  assert.deepEqual(compactPublicRows({ data: [
    { timestart: '2026-08-15T02:00:00', valor: '1.10' },
    { timestart: '2026-08-15T01:00:00', valor: '1.00' },
  ] }), [
    { d: '2026-08-15T01:00:00', v: 1 },
    { d: '2026-08-15T02:00:00', v: 1.1 },
  ]);
});

test('fusiona historiales, reemplaza duplicados y descarta datos vencidos', () => {
  const now = new Date('2026-08-15T03:00:00Z');
  const rows = mergeCompactRows([
    { d: '2025-08-13T03:00:00Z', v: 9 },
    { d: '2026-08-15T01:00:00Z', v: 1 },
  ], [
    { d: '2026-08-15T01:00:00Z', v: 1.1 },
    { d: '2026-08-15T02:00:00Z', v: 1.2 },
  ], now);
  assert.deepEqual(rows, [
    { d: '2026-08-15T01:00:00Z', v: 1.1 },
    { d: '2026-08-15T02:00:00Z', v: 1.2 },
  ]);
});

test('filtra el historial cacheado según el rango solicitado', () => {
  const now = new Date('2026-08-15T03:00:00Z');
  const rows = filterCompactRows([
    { d: '2026-08-07T03:00:00Z', v: 0.8 },
    { d: '2026-08-10T03:00:00Z', v: 0.9 },
    { d: '2026-08-15T02:00:00Z', v: 1 },
  ], 7, now);
  assert.deepEqual(rows.map((row) => row.v), [0.9, 1]);
  assert.equal(parsePublicHistoryDays(90), 90);
  assert.equal(parsePublicHistoryDays('365'), 365);
  assert.equal(parsePublicHistoryDays('999'), 7);
});
