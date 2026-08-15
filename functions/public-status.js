function timestampIso(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function buildPublicStatusPayload(velocityData) {
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
  };
}

module.exports = { buildPublicStatusPayload, timestampIso };
