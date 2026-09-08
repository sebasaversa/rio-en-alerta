const { normalizeRows, observationUrl } = require('./lib');

const DAY_MS = 24 * 60 * 60 * 1000;
const CHUNK_DAYS = 30;
const CONCURRENCY = 4;
const TIMEOUT_MS = 30000;

// The INA gateway times out on a single annual request. Keep the same annual
// window, but fetch bounded chunks and fail the calculation if any chunk fails.
async function loadVelocityHistory(getJson, now = new Date()) {
  const urls = [];
  for (let offset = 0; offset < 365; offset += CHUNK_DAYS) {
    const end = new Date(now.getTime() - offset * DAY_MS);
    urls.push(observationUrl(end, Math.min(CHUNK_DAYS, 365 - offset)));
  }
  const rows = [];
  for (let index = 0; index < urls.length; index += CONCURRENCY) {
    const batch = await Promise.all(urls.slice(index, index + CONCURRENCY).map(async (url) => {
      const payload = await getJson(url, TIMEOUT_MS);
      const observations = normalizeRows(payload);
      if (!observations.length) throw new Error('INA no devolvió observaciones para un tramo del historial anual');
      return observations;
    }));
    rows.push(...batch.flat());
  }
  // Adjacent requests overlap by a day because INA timeEnd is exclusive.
  // Statistics and current velocity both deduplicate these timestamps.
  return rows;
}

module.exports = { loadVelocityHistory };
