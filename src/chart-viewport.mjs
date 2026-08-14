export const MIN_VIEWPORT_SPAN = 0.05;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function timestampMs(value) {
  if (typeof value === 'number') return value;
  if (!value) return Number.NaN;
  const normalized = typeof value === 'string' && !/[zZ]|[+-]\d\d:?\d\d$/.test(value)
    ? `${value}Z`
    : value;
  return new Date(normalized).getTime();
}

function niceStep(value) {
  if (!Number.isFinite(value) || value <= 0) return 0.2;
  const exponent = Math.floor(Math.log10(value));
  const magnitude = 10 ** exponent;
  const fraction = value / magnitude;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return niceFraction * magnitude;
}

export function niceScale(values, targetIntervals = 5) {
  const valid = values.map(Number).filter(Number.isFinite);
  if (!valid.length) return { min: 0, max: 1, step: 0.2, ticks: [0, 0.2, 0.4, 0.6, 0.8, 1] };

  let dataMin = Math.min(...valid);
  let dataMax = Math.max(...valid);
  if (dataMin === dataMax) {
    const margin = Math.max(Math.abs(dataMin) * 0.1, 0.1);
    dataMin -= margin;
    dataMax += margin;
  }
  const padding = Math.max((dataMax - dataMin) * 0.12, 0.03);
  const paddedMin = dataMin >= 0 ? Math.max(0, dataMin - padding) : dataMin - padding;
  const paddedMax = dataMax + padding;
  const step = niceStep((paddedMax - paddedMin) / Math.max(2, Number(targetIntervals) || 5));
  const min = Number((Math.floor(paddedMin / step) * step).toFixed(10));
  const max = Number((Math.ceil(paddedMax / step) * step).toFixed(10));
  const ticks = [];
  for (let value = min; value <= max + step / 2; value += step) {
    ticks.push(Number(value.toFixed(10)));
  }
  return { min, max, step, ticks };
}

export function nearestRow(rows, targetTimestamp) {
  const target = Number(targetTimestamp);
  if (!Array.isArray(rows) || !rows.length || !Number.isFinite(target)) return null;
  let nearest = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    const timestamp = timestampMs(row?.date);
    if (!Number.isFinite(timestamp)) continue;
    const candidateDistance = Math.abs(timestamp - target);
    if (candidateDistance < distance) {
      nearest = row;
      distance = candidateDistance;
    }
  }
  return nearest;
}

export function normalizeViewport(viewport, minimumSpan = MIN_VIEWPORT_SPAN) {
  const safeMinimum = clamp(Number(minimumSpan) || MIN_VIEWPORT_SPAN, 0.001, 1);
  const rawStart = Number(viewport?.start);
  const rawEnd = Number(viewport?.end);
  if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || rawEnd <= rawStart) {
    return { start: 0, end: 1 };
  }

  const span = clamp(rawEnd - rawStart, safeMinimum, 1);
  const start = clamp(rawStart, 0, 1 - span);
  return { start, end: start + span };
}

export function zoomViewport(viewport, factor, anchor = 0.5, minimumSpan = MIN_VIEWPORT_SPAN) {
  const current = normalizeViewport(viewport, minimumSpan);
  const safeFactor = Number(factor);
  if (!Number.isFinite(safeFactor) || safeFactor <= 0) return current;

  const currentSpan = current.end - current.start;
  const nextSpan = clamp(currentSpan / safeFactor, minimumSpan, 1);
  if (nextSpan === 1) return { start: 0, end: 1 };

  const safeAnchor = clamp(Number(anchor) || 0, 0, 1);
  const anchoredValue = current.start + currentSpan * safeAnchor;
  const start = clamp(anchoredValue - nextSpan * safeAnchor, 0, 1 - nextSpan);
  return { start, end: start + nextSpan };
}

export function panViewport(viewport, delta, minimumSpan = MIN_VIEWPORT_SPAN) {
  const current = normalizeViewport(viewport, minimumSpan);
  const safeDelta = Number(delta);
  if (!Number.isFinite(safeDelta)) return current;
  const span = current.end - current.start;
  const start = clamp(current.start + safeDelta, 0, 1 - span);
  return { start, end: start + span };
}

export function viewportTimestamps(firstTimestamp, lastTimestamp, viewport) {
  const first = Number(firstTimestamp);
  const last = Number(lastTimestamp);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) {
    return { start: first, end: last };
  }
  const current = normalizeViewport(viewport);
  const span = last - first;
  return {
    start: first + span * current.start,
    end: first + span * current.end,
  };
}

export function isFullViewport(viewport) {
  const current = normalizeViewport(viewport);
  return current.start <= 0.000001 && current.end >= 0.999999;
}
