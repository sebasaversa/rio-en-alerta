function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function levelCell(value) {
  return Number(value).toFixed(2).replace('.', ',');
}

export function buildHistoryCsv(rows, options = {}) {
  const {
    stationName = 'San Fernando',
    river = 'Río Luján',
    source = 'INA',
  } = options;
  const header = ['fecha_hora_ina', 'altura_m', 'estacion', 'rio', 'fuente'];
  const lines = rows.map((row) => [
    row.date,
    levelCell(row.value),
    stationName,
    river,
    source,
  ]);
  return `\uFEFF${[header, ...lines].map((line) => line.map(csvCell).join(';')).join('\r\n')}\r\n`;
}

export function historyCsvFilename(days, now = new Date()) {
  const range = Number(days) === 1 ? '24h' : `${Number(days)}d`;
  return `rio-lujan-san-fernando-historial-${range}-${now.toISOString().slice(0, 10)}.csv`;
}
