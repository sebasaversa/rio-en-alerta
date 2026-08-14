import { buildHistoryCsv, historyCsvFilename } from "./history.mjs";

const API_BASE = "https://alerta.ina.gob.ar/pub/datos";
const STATION = { siteCode: 52, seriesId: 52, varId: 2, name: "San Fernando" };

const elements = {
  connectionStatus: document.querySelector("#connection-status"),
  refreshButton: document.querySelector("#refresh-button"),
  currentLevel: document.querySelector("#current-level"),
  observedAt: document.querySelector("#observed-at"),
  levelState: document.querySelector("#level-state"),
  meterFill: document.querySelector("#meter-fill"),
  trendIndicator: document.querySelector("#trend-indicator"),
  trendLabel: document.querySelector("#trend-label"),
  trendDescription: document.querySelector("#trend-description"),
  forecastGrid: document.querySelector("#forecast-grid"),
  historyRange: document.querySelector("#history-range"), historyDownload: document.querySelector("#history-download"), historyChart: document.querySelector("#history-chart"), historyList: document.querySelector("#history-list"), historySummary: document.querySelector("#history-summary"),
};

let thresholds = { alert: 3, evacuation: 3.5 };
let latest = { current: null, forecast: [], history: [] };
let historyDownloadUrl = null;

function setHistoryDownload(rows, days) {
  if (historyDownloadUrl) URL.revokeObjectURL(historyDownloadUrl);
  historyDownloadUrl = null;
  elements.historyDownload.removeAttribute("href");
  elements.historyDownload.removeAttribute("download");
  elements.historyDownload.setAttribute("aria-disabled", "true");
  if (!rows.length) return;
  const csv = buildHistoryCsv(rows, { stationName: STATION.name, river: "Río Luján" });
  historyDownloadUrl = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  elements.historyDownload.href = historyDownloadUrl;
  elements.historyDownload.download = historyCsvFilename(days);
  elements.historyDownload.setAttribute("aria-disabled", "false");
}

function apiUrl(resource, params) {
  // Esta API histórica usa & inmediatamente después del recurso, no ?.
  return `${API_BASE}/${resource}&${new URLSearchParams(params)}`;
}

function asDate(value) {
  return new Date(value.endsWith("Z") ? value : `${value}Z`);
}

function formatLevel(value) {
  return Number(value).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(value) {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(asDate(value));
}

function dayLabel(date, index) {
  if (index === 0) return "Hoy";
  if (index === 1) return "Mañana";
  return new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "numeric", month: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(date).replace(".", "");
}

function stateFor(level) {
  if (level >= thresholds.evacuation) return { label: "Evacuación", className: "is-danger" };
  if (level >= thresholds.alert) return { label: "Alerta", className: "is-warning" };
  return { label: "Normal", className: "" };
}

function normalizeObservations(payload) {
  const data = payload?.data ?? payload?.values ?? payload ?? [];
  return (Array.isArray(data) ? data : [])
    .map((item) => ({
      date: item.timestart ?? item.fecha ?? item.time ?? item.date ?? item[0],
      value: Number(item.valor ?? item.value ?? item.valor_num ?? item[1]),
    }))
    .filter((item) => item.date && Number.isFinite(item.value))
    .sort((a, b) => asDate(a.date) - asDate(b.date));
}

function normalizeForecast(payload) {
  const candidates = payload?.data ?? payload?.values ?? payload?.pronosticos ?? payload ?? [];
  const rows = Array.isArray(candidates) ? candidates.flatMap((item) => item?.pronosticos ?? item?.values ?? [item]) : [];
  return rows
    .map((item) => ({ date: item.timestart ?? item.fecha ?? item.time ?? item.date ?? item[0], value: Number(item.valor ?? item.value ?? item[1]) }))
    .filter((item) => item.date && Number.isFinite(item.value))
    .sort((a, b) => asDate(a.date) - asDate(b.date));
}

async function getJson(resource, params) {
  const response = await fetch(apiUrl(resource, params), { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`INA respondió ${response.status}`);
  return response.json();
}

function renderCurrent(observations) {
  const current = observations.at(-1);
  const previous = observations.at(-2);
  if (!current) throw new Error("La API no devolvió lecturas para esta estación.");
  latest.current = current;
  const state = stateFor(current.value);
  const delta = previous ? current.value - previous.value : 0;
  const direction = delta > 0.025 ? "↗" : delta < -0.025 ? "↘" : "→";
  const text = delta > 0.025 ? "En ascenso" : delta < -0.025 ? "En descenso" : "Sin cambios relevantes";

  elements.currentLevel.textContent = formatLevel(current.value);
  elements.observedAt.textContent = `Última lectura: ${formatDate(current.date)}`;
  elements.levelState.textContent = state.label;
  elements.levelState.className = `pill ${state.className}`;
  elements.meterFill.style.width = `${Math.min(100, Math.max(4, current.value / thresholds.evacuation * 100))}%`;
  elements.trendIndicator.querySelector(".trend-icon").textContent = direction;
  elements.trendLabel.textContent = text;
  elements.trendDescription.textContent = previous ? `Variación de ${formatLevel(Math.abs(delta))} m respecto de la lectura anterior.` : "Todavía no hay una lectura previa para comparar.";
}

function dailyForecast(forecast, current) {
  const grouped = new Map();
  forecast.forEach((item) => {
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(asDate(item.date));
    const day = grouped.get(key) ?? [];
    day.push(item);
    grouped.set(key, day);
  });
  const days = [...grouped.values()].slice(0, 5).map((items) => items.reduce((highest, item) => item.value > highest.value ? item : highest));
  if (!days.length && current) days.push(current);
  return days;
}

function renderForecast(forecast) {
  const days = dailyForecast(forecast, latest.current);
  latest.forecast = days;
  elements.forecastGrid.innerHTML = days.map((item, index) => {
    const state = stateFor(item.value);
    return `<article class="forecast-day"><time datetime="${item.date}">${dayLabel(asDate(item.date), index)}</time><strong>${formatLevel(item.value)} m</strong><small>máximo estimado</small><span class="forecast-state ${state.className}">${state.label}</span></article>`;
  }).join("");
}

async function refresh() {
  elements.refreshButton.disabled = true;
  elements.refreshButton.textContent = "Actualizando…";
  elements.connectionStatus.className = "live-status";
  elements.connectionStatus.lastElementChild.textContent = "Consultando INA";
  const now = new Date();
  const start = new Date(now); start.setDate(start.getDate() - 3);
  const end = new Date(now); end.setDate(end.getDate() + 5);
  const request = (date) => date.toISOString().slice(0, 10);
  try {
    const [observedPayload, forecastPayload] = await Promise.all([
      getJson("datos", { timeStart: request(start), timeEnd: request(now), siteCode: STATION.siteCode, varId: STATION.varId, format: "json" }),
      getJson("datosProno", { timeStart: request(now), timeEnd: request(end), seriesId: 26202, calId: 432, siteCode: STATION.siteCode, varId: STATION.varId, all: "false", format: "json" }),
    ]);
    renderCurrent(normalizeObservations(observedPayload));
    renderForecast(normalizeForecast(forecastPayload));
    elements.connectionStatus.className = "live-status is-live";
    elements.connectionStatus.lastElementChild.textContent = "Datos actualizados";
    loadHistory();
  } catch (error) {
    elements.connectionStatus.className = "live-status has-error";
    elements.connectionStatus.lastElementChild.textContent = "No se pudo actualizar";
    elements.observedAt.textContent = "No pudimos consultar el INA. Probá actualizar nuevamente.";
    elements.forecastGrid.innerHTML = `<p class="form-message">El pronóstico no está disponible en este momento.</p>`;
    console.error(error);
  } finally {
    elements.refreshButton.disabled = false;
    elements.refreshButton.textContent = "↻ Actualizar ahora";
  }
}

async function loadHistory() {
  const days = Number(elements.historyRange.value);
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  setHistoryDownload([], days);
  latest.history = [];
  try {
    const rows = normalizeObservations(await getJson("datos", {
      timeStart: start.toISOString().slice(0, 10), timeEnd: end.toISOString().slice(0, 10), siteCode: 52, varId: 2, format: "json",
    }));
    if (!rows.length) throw new Error("El INA no devolvió mediciones históricas.");
    latest.history = rows;
    setHistoryDownload(rows, days);
    const shown = days === 1 ? rows : rows.filter((_, i) => i === 0 || i === rows.length - 1 || i % Math.max(1, Math.floor(rows.length / 12)) === 0);
    const values = rows.map((row) => row.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const x = (index) => index / (shown.length - 1 || 1) * 620 + 60;
    const y = (value) => 165 - (value - min) / span * 125;
    const points = shown.map((row, index) => `${x(index)},${y(row.value)}`).join(" ");
    const stamp = (index) => new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(asDate(shown[index].date));
    const compact = (row) => new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }).format(asDate(row.date)).replace(",", " ·");
    elements.historyChart.innerHTML = `<line x1="60" y1="165" x2="690" y2="165"/><line x1="60" y1="40" x2="60" y2="165"/><text x="4" y="45">${formatLevel(max)} m</text><text x="4" y="165">${formatLevel(min)} m</text><polyline points="${points}"/>${shown.map((row, index) => `<circle cx="${x(index)}" cy="${y(row.value)}" r="4"><title>${formatDate(row.date)}: ${formatLevel(row.value)} m</title></circle>`).join("")}<text x="60" y="187">${stamp(0)}</text><text text-anchor="end" x="690" y="187">${stamp(shown.length - 1)}</text>`;
    elements.historySummary.textContent = `${rows.length} mediciones en el rango · mínimo ${formatLevel(min)} m · máximo ${formatLevel(max)} m`;
    elements.historyList.innerHTML = shown.slice(-4).map((row) => `<div class="history-item">${compact(row)}<strong>${formatLevel(row.value)} m</strong></div>`).join("");
  } catch (error) {
    elements.historySummary.textContent = "No se pudo cargar el historial.";
    elements.historyChart.innerHTML = "";
    elements.historyList.innerHTML = "";
    console.error(error);
  }
}

elements.refreshButton.addEventListener("click", refresh);
elements.historyRange.addEventListener("change", loadHistory);
refresh();
