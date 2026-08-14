const { normalizeRows, parseDate } = require('./lib');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const DEFAULT_VELOCITY_OPTIONS = Object.freeze({
  minLevel: -5,
  maxLevel: 10,
  maxIntervalHours: 6,
  minCoverageDays: 90,
  minIntervals: 100,
  percentile: 0.9,
});

function percentile(values, probability) {
  if (!Array.isArray(values) || !values.length) return null;
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new RangeError('El percentil debe estar entre 0 y 1');
  }
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const fraction = position - lowerIndex;
  return sorted[lowerIndex] + (sorted[upperIndex] - sorted[lowerIndex]) * fraction;
}

function normalizeVelocityObservations(payload, overrides = {}) {
  const options = { ...DEFAULT_VELOCITY_OPTIONS, ...overrides };
  const byTimestamp = new Map();
  for (const row of normalizeRows(payload)) {
    const date = parseDate(row.date);
    if (!date || row.value < options.minLevel || row.value > options.maxLevel) continue;
    byTimestamp.set(date.getTime(), {
      date: row.date,
      timestampMs: date.getTime(),
      value: row.value,
    });
  }
  return [...byTimestamp.values()].sort((left, right) => left.timestampMs - right.timestampMs);
}

function calculateVelocityIntervals(payload, overrides = {}) {
  const options = { ...DEFAULT_VELOCITY_OPTIONS, ...overrides };
  const observations = normalizeVelocityObservations(payload, options);
  const intervals = [];
  for (let index = 1; index < observations.length; index += 1) {
    const previous = observations[index - 1];
    const current = observations[index];
    const hours = (current.timestampMs - previous.timestampMs) / HOUR_MS;
    if (hours <= 0 || hours > options.maxIntervalHours) continue;
    const change = current.value - previous.value;
    intervals.push({
      fromDate: previous.date,
      toDate: current.date,
      hours,
      change,
      speed: change / hours,
    });
  }
  return { intervals, observations, options };
}

function calculateVelocityStatistics(payload, overrides = {}) {
  const { intervals, observations, options } = calculateVelocityIntervals(payload, overrides);
  const coverageDays = observations.length > 1
    ? (observations.at(-1).timestampMs - observations[0].timestampMs) / DAY_MS
    : 0;
  const ascents = intervals.filter((row) => row.speed > 0).map((row) => row.speed);
  const descents = intervals.filter((row) => row.speed < 0).map((row) => Math.abs(row.speed));
  const reasons = [];
  if (coverageDays < options.minCoverageDays) reasons.push('coverage');
  if (intervals.length < options.minIntervals) reasons.push('intervals');
  if (!ascents.length) reasons.push('ascents');
  if (!descents.length) reasons.push('descents');
  const sufficient = reasons.length === 0;
  return {
    sufficient,
    reasons,
    percentile: options.percentile,
    p90Ascent: sufficient ? percentile(ascents, options.percentile) : null,
    p90Descent: sufficient ? percentile(descents, options.percentile) : null,
    coverageDays,
    observationCount: observations.length,
    validIntervalCount: intervals.length,
    ascentCount: ascents.length,
    descentCount: descents.length,
    periodStart: observations[0]?.date ?? null,
    periodEnd: observations.at(-1)?.date ?? null,
    maxIntervalHours: options.maxIntervalHours,
    minLevel: options.minLevel,
    maxLevel: options.maxLevel,
  };
}

function metersPerHourToCentimeters(value) {
  return value * 100;
}

function classifySpeed(speed, statistics) {
  if (!statistics?.sufficient) {
    return { code: 'insufficient', label: 'Datos insuficientes para calcular la velocidad' };
  }
  if (speed >= statistics.p90Ascent) return { code: 'rapid-rise', label: 'Subida rápida' };
  if (speed < 0 && Math.abs(speed) >= statistics.p90Descent) return { code: 'rapid-fall', label: 'Bajada rápida' };
  if (speed > 0) return { code: 'normal-rise', label: 'Ascenso normal' };
  if (speed < 0) return { code: 'normal-fall', label: 'Descenso normal' };
  return { code: 'unchanged', label: 'Sin cambios' };
}

function calculateCurrentVelocity(payload, statistics, options = {}) {
  const normalized = normalizeVelocityObservations(payload, {
    minLevel: statistics?.minLevel,
    maxLevel: statistics?.maxLevel,
  });
  if (!statistics?.sufficient || normalized.length < 2) {
    return {
      code: 'insufficient',
      label: 'Datos insuficientes para calcular la velocidad',
      isNewObservation: false,
    };
  }
  const current = normalized.at(-1);
  const previous = normalized.at(-2);
  const lastProcessed = parseDate(options.lastProcessedObservationAt);
  if (lastProcessed?.getTime() === current.timestampMs) {
    return {
      code: 'no-new-observation',
      label: 'Sin nueva medición',
      isNewObservation: false,
      observedAt: current.date,
      previousObservedAt: previous.date,
    };
  }
  const hours = (current.timestampMs - previous.timestampMs) / HOUR_MS;
  if (hours <= 0 || hours > statistics.maxIntervalHours) {
    return {
      code: 'insufficient',
      label: 'Datos insuficientes para calcular la velocidad',
      isNewObservation: true,
      observedAt: current.date,
      previousObservedAt: previous.date,
      hours,
    };
  }
  const change = current.value - previous.value;
  const speed = change / hours;
  return {
    ...classifySpeed(speed, statistics),
    isNewObservation: true,
    observedAt: current.date,
    previousObservedAt: previous.date,
    currentLevel: current.value,
    previousLevel: previous.value,
    hours,
    change,
    speedMetersPerHour: speed,
    speedCentimetersPerHour: metersPerHourToCentimeters(speed),
  };
}

module.exports = {
  DEFAULT_VELOCITY_OPTIONS,
  calculateCurrentVelocity,
  calculateVelocityIntervals,
  calculateVelocityStatistics,
  classifySpeed,
  metersPerHourToCentimeters,
  normalizeVelocityObservations,
  percentile,
};
