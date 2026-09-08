const test = require('node:test');
const assert = require('node:assert/strict');
const { loadVelocityHistory } = require('../ina-history');
const { calculateVelocityStatistics } = require('../velocity');

test('descarga la ventana anual por tramos de 30 días con concurrencia acotada', async () => {
  let active = 0;
  let peak = 0;
  const requests = [];
  const rows = await loadVelocityHistory(async (url, timeoutMs) => {
    active += 1;
    peak = Math.max(peak, active);
    const params = new URLSearchParams(url.split('/datos&')[1]);
    requests.push(params);
    assert.equal(timeoutMs, 30000);
    assert.equal(params.get('siteCode'), '52');
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    const start = Date.parse(params.get('timeStart'));
    const end = Date.parse(params.get('timeEnd'));
    assert.ok(end - start <= 31 * 86400000);
    const data = [];
    for (let at = start; at < end; at += 3600000) {
      data.push({ timestart: new Date(at).toISOString(), valor: at % 7200000 ? 1.2 : 1 });
    }
    return { data };
  }, new Date('2026-09-08T12:00:00Z'));
  assert.equal(requests.length, 13);
  assert.equal(peak, 4);
  assert.equal(requests[0].get('timeEnd'), '2026-09-09');
  assert.equal(requests.at(-1).get('timeStart'), '2025-09-08');
  const stats = calculateVelocityStatistics(rows);
  assert.equal(stats.sufficient, true);
  assert.equal(stats.observationCount, 366 * 24);
  assert.equal(stats.validIntervalCount, 366 * 24 - 1);
  assert.equal(stats.periodStart, '2025-09-08T00:00:00.000Z');
  assert.equal(stats.periodEnd, '2026-09-08T23:00:00.000Z');
});

test('rechaza errores o tramos vacíos para no sustituir percentiles con un historial parcial', async () => {
  for (const fail of [async () => { throw new Error('INA respondió 504'); }, async () => ({ data: [] })]) {
    let count = 0;
    await assert.rejects(loadVelocityHistory(async () => {
      count += 1;
      if (count === 5) return fail();
      return { data: [{ timestart: '2026-01-01T00:00:00Z', valor: 1 }] };
    }), /INA/);
    assert.equal(count, 8);
  }
});
