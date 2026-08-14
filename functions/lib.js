const STATION = Object.freeze({
  siteCode: 52,
  varId: 2,
  name: 'San Fernando',
  river: 'Río Luján',
});

const FORECAST = Object.freeze({ seriesId: 26202, calId: 432 });
const API_BASE = 'https://alerta.ina.gob.ar/pub/datos';
const MAX_THRESHOLD = 6;
const DEFAULT_THRESHOLD = 2.5;

function dateParam(date) {
  return date.toISOString().slice(0, 10);
}

function buildInaUrl(resource, params) {
  return `${API_BASE}/${resource}&${new URLSearchParams(params)}`;
}

function observationUrl(now = new Date(), days = 3) {
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return buildInaUrl('datos', {
    timeStart: dateParam(start),
    timeEnd: dateParam(now),
    siteCode: STATION.siteCode,
    varId: STATION.varId,
    format: 'json',
  });
}

function forecastUrl(now = new Date(), days = 5) {
  const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  return buildInaUrl('datosProno', {
    timeStart: dateParam(now),
    timeEnd: dateParam(end),
    seriesId: FORECAST.seriesId,
    calId: FORECAST.calId,
    siteCode: STATION.siteCode,
    varId: STATION.varId,
    all: 'false',
    format: 'json',
  });
}

function parseDate(value) {
  if (!value) return null;
  const normalized = typeof value === 'string' && !/[zZ]|[+-]\d\d:?\d\d$/.test(value)
    ? `${value}Z`
    : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeRows(payload) {
  const source = Array.isArray(payload)
    ? payload
    : payload?.data ?? payload?.values ?? [];
  if (!Array.isArray(source)) return [];
  return source
    .flatMap((row) => row?.pronosticos ?? row?.values ?? [row])
    .map((row) => ({
      date: row?.timestart ?? row?.fecha ?? row?.time ?? row?.date ?? row?.[0],
      value: Number(row?.valor ?? row?.value ?? row?.valor_num ?? row?.[1]),
    }))
    .filter((row) => parseDate(row.date) && Number.isFinite(row.value))
    .sort((left, right) => parseDate(left.date) - parseDate(right.date));
}

function currentObservation(payload) {
  return normalizeRows(payload).at(-1) ?? null;
}

function dailyMaximums(payload, limit = 5) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  });
  const grouped = new Map();
  for (const row of normalizeRows(payload)) {
    const key = formatter.format(parseDate(row.date));
    const current = grouped.get(key);
    if (!current || row.value > current.value) grouped.set(key, row);
  }
  return [...grouped.values()].slice(0, limit);
}

function dailyRanges(payload, limit = 30, { latest = false } = {}) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  });
  const grouped = new Map();
  for (const row of normalizeRows(payload)) {
    const key = formatter.format(parseDate(row.date));
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, { date: row.date, min: row.value, max: row.value });
      continue;
    }
    current.min = Math.min(current.min, row.value);
    current.max = Math.max(current.max, row.value);
  }
  const ranges = [...grouped.values()];
  return latest ? ranges.slice(-limit) : ranges.slice(0, limit);
}

function historyRangeDays(argument = '') {
  const normalized = String(argument).trim().toLowerCase();
  if (!normalized || normalized === '24h' || normalized === '1d') return 1;
  if (normalized === '7d') return 7;
  if (normalized === '30d') return 30;
  return null;
}

function normalizeCommand(text = '') {
  const [rawCommand = '', ...parts] = text.trim().split(/\s+/);
  const command = rawCommand.toLowerCase().replace(/@[^\s]+$/, '');
  return { command, argument: parts.join(' ').trim() };
}

function parseThreshold(argument) {
  const normalized = argument.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const value = Number(normalized);
  return value > 0 && value <= MAX_THRESHOLD ? value : null;
}

module.exports = {
  API_BASE,
  DEFAULT_THRESHOLD,
  FORECAST,
  MAX_THRESHOLD,
  STATION,
  currentObservation,
  dailyMaximums,
  dailyRanges,
  forecastUrl,
  historyRangeDays,
  normalizeCommand,
  normalizeRows,
  observationUrl,
  parseDate,
  parseThreshold,
};
