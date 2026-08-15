function observationTimestamp(value) {
  if (typeof value !== "string") return Number.NaN;
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`;
  return Date.parse(normalized);
}

export function observationsFromPublicStatus(payload) {
  const current = payload?.current;
  if (!current) return [];
  const rows = [
    { date: current.previousObservedAt, value: Number(current.previousLevel) },
    { date: current.observedAt, value: Number(current.currentLevel) },
  ].filter((row) => row.date && Number.isFinite(row.value) && Number.isFinite(observationTimestamp(row.date)));
  return rows
    .filter((row, index, all) => all.findIndex((candidate) => candidate.date === row.date) === index)
    .sort((a, b) => observationTimestamp(a.date) - observationTimestamp(b.date));
}

export function formatObservationAge(value, nowMs = Date.now()) {
  const timestamp = observationTimestamp(value);
  if (!Number.isFinite(timestamp)) return "tiempo desconocido";
  const minutes = Math.max(0, Math.floor((nowMs - timestamp) / 60000));
  if (minutes < 1) return "menos de un minuto";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hora" : "horas"}`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "día" : "días"}`;
}
