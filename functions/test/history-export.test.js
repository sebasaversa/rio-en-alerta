const test = require('node:test');
const assert = require('node:assert/strict');

test('genera un CSV de historial compatible con separador y decimal locales', async () => {
  const { buildHistoryCsv } = await import('../../src/history.mjs');
  const csv = buildHistoryCsv([
    { date: '2026-08-14T08:00:00', value: 1.25 },
    { date: '2026-08-14T09:00:00', value: 2 },
  ]);

  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /"fecha_hora_ina";"altura_m";"estacion";"rio";"fuente"/);
  assert.match(csv, /"2026-08-14T08:00:00";"1,25";"San Fernando";"Río Luján";"INA"/);
  assert.match(csv, /"2026-08-14T09:00:00";"2,00"/);
});

test('nombra el archivo según el rango seleccionado', async () => {
  const { historyCsvFilename } = await import('../../src/history.mjs');
  const now = new Date('2026-08-14T12:00:00Z');

  assert.equal(historyCsvFilename(1, now), 'rio-lujan-san-fernando-historial-24h-2026-08-14.csv');
  assert.equal(historyCsvFilename(30, now), 'rio-lujan-san-fernando-historial-30d-2026-08-14.csv');
});
