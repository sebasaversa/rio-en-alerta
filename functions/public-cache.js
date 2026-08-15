const { normalizeRows, parseDate } = require('./lib');

const PUBLIC_HISTORY_DAYS = Object.freeze([1, 7, 30, 90, 180, 365]);
const HISTORY_RETENTION_DAYS = 366;

function compactPublicRows(payload) {
  return normalizeRows(payload).map((row) => ({ d: row.date, v: row.value }));
}

function mergeCompactRows(previousRows, incomingRows, now = new Date()) {
  const cutoff = now.getTime() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const unique = new Map();
  for (const row of normalizeRows([...(previousRows ?? []), ...(incomingRows ?? [])])) {
    if (parseDate(row.date).getTime() >= cutoff) unique.set(row.date, { d: row.date, v: row.value });
  }
  return [...unique.values()].sort((left, right) => parseDate(left.d) - parseDate(right.d));
}

function parsePublicHistoryDays(value) {
  const days = Number(value);
  return PUBLIC_HISTORY_DAYS.includes(days) ? days : 7;
}

function filterCompactRows(rows, days, now = new Date()) {
  const cutoff = now.getTime() - parsePublicHistoryDays(days) * 24 * 60 * 60 * 1000;
  return compactPublicRows(rows).filter((row) => parseDate(row.d).getTime() >= cutoff);
}

module.exports = {
  HISTORY_RETENTION_DAYS,
  PUBLIC_HISTORY_DAYS,
  compactPublicRows,
  filterCompactRows,
  mergeCompactRows,
  parsePublicHistoryDays,
};
