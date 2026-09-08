const { classifySpeed } = require('./velocity');

const HYSTERESIS_METERS = 0.1;

const DEFAULT_ALERT_PREFERENCES = Object.freeze({
  height: true,
  rapidRise: false,
  rapidFall: false,
  recovery: false,
});

const PREFERENCE_KEYS = Object.freeze(Object.keys(DEFAULT_ALERT_PREFERENCES));
const RAPID_CODES = new Set(['rapid-rise', 'rapid-fall']);
const NORMAL_CODES = new Set(['normal-rise', 'normal-fall', 'unchanged']);

function normalizeAlertPreferences(value = {}) {
  return Object.fromEntries(PREFERENCE_KEYS.map((key) => [
    key,
    typeof value?.[key] === 'boolean' ? value[key] : DEFAULT_ALERT_PREFERENCES[key],
  ]));
}

function normalizeAlertState(value = {}) {
  const heightCondition = ['above', 'below', 'unknown'].includes(value?.heightCondition)
    ? value.heightCondition
    : 'unknown';
  const velocityCondition = RAPID_CODES.has(value?.velocityCondition)
    || value?.velocityCondition === 'normal'
    ? value.velocityCondition
    : 'normal';
  return {
    heightCondition,
    velocityCondition,
    lastObservationAt: value?.lastObservationAt ?? null,
  };
}

function alertStateFromChat(chat = {}) {
  const state = normalizeAlertState(chat.alertState);
  if (chat.alertState) return state;
  const previousAlertLevel = Number(chat.lastAlertLevel);
  const threshold = Number(chat.threshold);
  if (Number.isFinite(previousAlertLevel) && Number.isFinite(threshold) && previousAlertLevel >= threshold) {
    state.heightCondition = 'above';
  }
  return state;
}

function sameObservation(left, right) {
  if (!left || !right) return false;
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime === rightTime;
}

function roundedLevel(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function evaluateAlertTransition({
  current,
  threshold,
  preferences,
  previousState,
  velocity,
  statistics,
  isNewObservation = true,
  hysteresisMeters = HYSTERESIS_METERS,
}) {
  const state = normalizeAlertState(previousState);
  const normalizedPreferences = normalizeAlertPreferences(preferences);
  const level = Number(current?.value);
  const selectedHeight = Number(threshold);
  if (!isNewObservation || sameObservation(state.lastObservationAt, current?.date)) {
    return { processed: false, events: [], state };
  }
  if (!current?.date || !Number.isFinite(level) || !Number.isFinite(selectedHeight)) {
    throw new TypeError('La medición y la altura seleccionada deben ser válidas');
  }

  const events = [];
  let heightCondition = state.heightCondition;
  if (level >= selectedHeight) {
    if (heightCondition !== 'above' && normalizedPreferences.height) {
      events.push({ type: 'height', threshold: selectedHeight });
    }
    heightCondition = 'above';
  } else if (heightCondition === 'above') {
    const recoveryLevel = roundedLevel(selectedHeight - hysteresisMeters);
    if (level <= recoveryLevel) {
      if (normalizedPreferences.recovery) {
        events.push({ type: 'recovery', threshold: selectedHeight, recoveryLevel });
      }
      heightCondition = 'below';
    }
  } else {
    heightCondition = 'below';
  }

  let velocityCondition = state.velocityCondition;
  const speed = velocity?.speedMetersPerHour;
  // Revalidate against the current thresholds; cached classifications may use p90.
  const velocityCode = NORMAL_CODES.has(velocity?.code) || RAPID_CODES.has(velocity?.code)
    ? classifySpeed(speed, statistics).code
    : velocity?.code;
  if (NORMAL_CODES.has(velocityCode)) {
    // At exactly p90 the episode stays latched. A reversal also rearms it.
    if ((velocityCondition === 'rapid-rise' && speed < statistics.p90Ascent)
      || (velocityCondition === 'rapid-fall' && speed > -statistics.p90Descent)) {
      velocityCondition = 'normal';
    }
  } else if (RAPID_CODES.has(velocityCode)) {
    const preferenceKey = velocityCode === 'rapid-rise' ? 'rapidRise' : 'rapidFall';
    if (velocityCondition !== velocityCode && normalizedPreferences[preferenceKey]) {
      events.push({
        type: preferenceKey,
        speedMetersPerHour: Number(velocity.speedMetersPerHour),
        speedCentimetersPerHour: Number(velocity.speedCentimetersPerHour),
        p95MetersPerHour: velocityCode === 'rapid-rise'
          ? statistics.p95Ascent
          : -statistics.p95Descent,
      });
    }
    velocityCondition = velocityCode;
  }

  return {
    processed: true,
    events,
    state: {
      heightCondition,
      velocityCondition,
      lastObservationAt: current.date,
    },
  };
}

module.exports = {
  DEFAULT_ALERT_PREFERENCES,
  HYSTERESIS_METERS,
  PREFERENCE_KEYS,
  alertStateFromChat,
  evaluateAlertTransition,
  normalizeAlertPreferences,
  normalizeAlertState,
};
