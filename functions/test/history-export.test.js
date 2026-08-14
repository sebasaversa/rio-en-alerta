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
  assert.equal(historyCsvFilename(90, now), 'rio-lujan-san-fernando-historial-3m-2026-08-14.csv');
  assert.equal(historyCsvFilename(180, now), 'rio-lujan-san-fernando-historial-6m-2026-08-14.csv');
  assert.equal(historyCsvFilename(365, now), 'rio-lujan-san-fernando-historial-12m-2026-08-14.csv');
});

test('calcula promedios diarios en Argentina y descarta filas inválidas', async () => {
  const { dailyAverage } = await import('../../src/history.mjs');
  const rows = dailyAverage([
    { date: '2026-08-14T05:00:00Z', value: 1 },
    { date: '2026-08-14T08:00:00Z', value: 2 },
    { date: '2026-08-15T04:00:00Z', value: 3 },
    { date: 'fecha-invalida', value: 99 },
  ]);

  assert.deepEqual(rows, [
    { date: '2026-08-14T15:00:00Z', value: 1.5, samples: 2 },
    { date: '2026-08-15T15:00:00Z', value: 3, samples: 1 },
  ]);
});

test('mantiene mediciones horarias y usa promedios para rangos de varios días', async () => {
  const { historyChartRows } = await import('../../src/history.mjs');
  const source = [
    { date: '2026-08-14T09:00:00Z', value: 2 },
    { date: '2026-08-14T08:00:00Z', value: 1 },
  ];

  assert.deepEqual(historyChartRows(source, 1).map((row) => row.value), [1, 2]);
  assert.deepEqual(historyChartRows(source, 30), [
    { date: '2026-08-14T15:00:00Z', value: 1.5, samples: 2 },
  ]);
});
