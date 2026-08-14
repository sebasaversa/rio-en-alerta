function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function levelCell(value) {
  return Number(value).toFixed(2).replace('.', ',');
}

function timestampMs(value) {
  if (!value) return Number.NaN;
  const normalized = typeof value === 'string' && !/[zZ]|[+-]\d\d:?\d\d$/.test(value)
    ? `${value}Z`
    : value;
  return new Date(normalized).getTime();
}

export function dailyAverage(rows, timeZone = 'America/Argentina/Buenos_Aires') {
  const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone });
  const grouped = new Map();
  for (const row of rows) {
    const milliseconds = timestampMs(row?.date);
    const value = Number(row?.value);
    if (!Number.isFinite(milliseconds) || !Number.isFinite(value)) continue;
    const key = dayFormatter.format(new Date(milliseconds));
    const current = grouped.get(key) ?? { sum: 0, samples: 0 };
    current.sum += value;
    current.samples += 1;
    grouped.set(key, current);
  }
  return [...grouped.entries()].map(([day, data]) => ({
    date: `${day}T15:00:00Z`,
    value: data.sum / data.samples,
    samples: data.samples,
  }));
}

export function historyChartRows(rows, days) {
  const valid = rows
    .filter((row) => Number.isFinite(timestampMs(row?.date)) && Number.isFinite(Number(row?.value)))
    .map((row) => ({ ...row, value: Number(row.value) }))
    .sort((left, right) => timestampMs(left.date) - timestampMs(right.date));
  return Number(days) === 1 ? valid : dailyAverage(valid);
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
  const rangeNames = { 1: '24h', 90: '3m', 180: '6m', 365: '12m' };
  const range = rangeNames[Number(days)] ?? `${Number(days)}d`;
  return `rio-lujan-san-fernando-historial-${range}-${now.toISOString().slice(0, 10)}.csv`;
}
