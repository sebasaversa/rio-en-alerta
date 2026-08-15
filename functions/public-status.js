const { compactPublicRows, filterCompactRows } = require('./public-cache');

function timestampIso(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function buildCachedSeries(data, days = null) {
  if (!data?.rows?.length) return null;
  return {
    rows: days ? filterCompactRows(data.rows, days) : compactPublicRows(data.rows),
    updatedAt: timestampIso(data.updatedAt),
  };
}

function buildPublicStatusPayload(velocityData, { forecast = null, histories = [], days = 7 } = {}) {
  const current = velocityData?.current;
  if (!current?.observedAt || !Number.isFinite(Number(current.currentLevel))) return null;
  return {
    station: { siteCode: 52, name: 'San Fernando', river: 'Río Luján' },
    officialLevels: { alert: 3, evacuation: 3.5 },
    statistics: velocityData?.statistics ?? null,
    current,
    calculatedAt: timestampIso(velocityData?.calculatedAt),
    updatedAt: timestampIso(velocityData?.updatedAt),
    source: 'hourly-cache',
    forecast: buildCachedSeries(forecast),
    histories: histories.map((history) => ({
      siteCode: Number(history.siteCode),
      ...buildCachedSeries(history, days),
    })).filter((history) => history.rows?.length),
  };
}

module.exports = { buildCachedSeries, buildPublicStatusPayload, timestampIso };
