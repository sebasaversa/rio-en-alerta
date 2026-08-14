import { buildHistoryCsv, historyChartRows, historyCsvFilename } from "./history.mjs";

const API_BASE = "https://alerta.ina.gob.ar/pub/datos";
const PUBLIC_STATUS_URL = "https://us-central1-rio-en-alerta-sanfernando.cloudfunctions.net/publicRiverStatus";
const STATION = { siteCode: 52, seriesId: 52, varId: 2, name: "San Fernando", river: "Río Luján", color: "#075a70" };
const HISTORY_STATIONS = [
  STATION,
  { siteCode: 49, varId: 2, name: "Tigre", river: "Río Luján", color: "#d17c21" },
  { siteCode: 50, varId: 2, name: "Dique Luján", river: "Río Luján", color: "#6c5aa7" },
  { siteCode: 53, varId: 2, name: "San Isidro", river: "Río de la Plata", color: "#2f8a63" },
];
const OBSERVED_STATIONS = HISTORY_STATIONS.slice(1);

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
  trendElapsed: document.querySelector("#trend-elapsed"),
  trendSpeed: document.querySelector("#trend-speed"),
  trendAlertSpeed: document.querySelector("#trend-alert-speed"),
  trendNote: document.querySelector("#trend-note"),
  velocityMethodology: document.querySelector("#velocity-methodology"),
  stationGrid: document.querySelector("#station-grid"),
  forecastGrid: document.querySelector("#forecast-grid"),
  historyRange: document.querySelector("#history-range"), historyDownload: document.querySelector("#history-download"), historyChart: document.querySelector("#history-chart"), historyLegend: document.querySelector("#history-legend"), historyList: document.querySelector("#history-list"), historySummary: document.querySelector("#history-summary"),
};

let thresholds = { alert: 3, evacuation: 3.5 };
let latest = { current: null, forecast: [], history: [] };
let historyDownloadUrl = null;
let historyRequestId = 0;

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

function formatSigned(value, digits = 2) {
  const number = Number(value);
  return `${number > 0 ? "+" : ""}${number.toLocaleString("es-AR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function formatElapsed(hours) {
  const minutes = Math.round(Number(hours) * 60);
  if (minutes < 60) return `${minutes} min`;
  const wholeHours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${wholeHours} h ${remaining} min` : `${wholeHours} h`;
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

async function getPublicStatus() {
  const response = await fetch(PUBLIC_STATUS_URL, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`El indicador respondió ${response.status}`);
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
  elements.trendElapsed.textContent = "Tiempo transcurrido: calculando…";
  elements.trendSpeed.textContent = "Velocidad: calculando…";
  elements.trendAlertSpeed.textContent = "Velocidad de alerta estadística: calculando…";
  elements.trendNote.textContent = "Cargando el indicador estadístico.";
}

function renderVelocityStatus(payload) {
  const statistics = payload?.statistics;
  const current = payload?.current;
  const insufficient = !statistics?.sufficient || !current || current.code === "insufficient";
  if (insufficient) {
    elements.trendLabel.textContent = "Datos insuficientes";
    elements.trendElapsed.textContent = "Tiempo transcurrido: —";
    elements.trendSpeed.textContent = "Velocidad: —";
    elements.trendAlertSpeed.textContent = "Velocidad de alerta estadística: no disponible";
    elements.trendNote.textContent = "Datos insuficientes para calcular la velocidad";
    return;
  }
  const speed = Number(current.speedMetersPerHour);
  elements.trendIndicator.querySelector(".trend-icon").textContent = speed > 0 ? "↗" : speed < 0 ? "↘" : "→";
  elements.trendLabel.textContent = current.label;
  elements.trendDescription.textContent = `Variación desde la lectura anterior: ${formatSigned(current.change)} m.`;
  elements.trendElapsed.textContent = `Tiempo transcurrido: ${formatElapsed(current.hours)}`;
  elements.trendSpeed.textContent = `Velocidad: ${formatSigned(speed)} m/h (${formatSigned(current.speedCentimetersPerHour, 1)} cm/h)`;
  const ascentAlertSpeed = Number(statistics.p90Ascent);
  const descentAlertSpeed = -Math.abs(Number(statistics.p90Descent));
  elements.trendAlertSpeed.textContent = `Velocidad de alerta estadística: subida ≥ ${formatSigned(ascentAlertSpeed)} m/h (${formatSigned(ascentAlertSpeed * 100, 1)} cm/h) · bajada ≤ ${formatSigned(descentAlertSpeed)} m/h (${formatSigned(descentAlertSpeed * 100, 1)} cm/h)`;
  const rapid = current.code === "rapid-rise" || current.code === "rapid-fall";
  elements.trendNote.textContent = rapid
    ? `${current.label}: esta velocidad pertenece al 10 % de las variaciones históricas más rápidas de su tipo en San Fernando.`
    : `${current.label}: la velocidad no alcanza el percentil 90 histórico de su tipo.`;
  const period = statistics.periodStart && statistics.periodEnd
    ? `${formatDate(statistics.periodStart)} a ${formatDate(statistics.periodEnd)}`
    : "periodo no disponible";
  const calculated = payload.calculatedAt ? formatDate(payload.calculatedAt) : "fecha no disponible";
  elements.velocityMethodology.textContent = `Indicador estadístico calculado por Río en Alerta con ${statistics.validIntervalCount} intervalos válidos (${period}). Percentil 90: ascenso ${formatLevel(statistics.p90Ascent)} m/h y descenso ${formatLevel(statistics.p90Descent)} m/h. Último cálculo: ${calculated}. El percentil 90 identifica el 10 % de las variaciones históricas más rápidas. No constituye una alerta oficial. Los niveles oficiales de San Fernando son 3,00 m para alerta y 3,50 m para evacuación.`;
}

async function loadObservedStations() {
  const end = new Date();
  const start = new Date(end); start.setDate(start.getDate() - 7);
  const request = (date) => date.toISOString().slice(0, 10);
  const cards = await Promise.all(OBSERVED_STATIONS.map(async (station) => {
    try {
      const rows = normalizeObservations(await getJson("datos", {
        timeStart: request(start), timeEnd: request(end), siteCode: station.siteCode, varId: station.varId, format: "json",
      }));
      const current = rows.at(-1);
      if (!current) throw new Error("sin mediciones");
      return `<article class="station-card"><h3>${station.name}</h3><p class="station-river">${station.river}</p><strong class="station-level">${formatLevel(current.value)} m</strong><time class="station-time" datetime="${current.date}">${formatDate(current.date)}</time></article>`;
    } catch (error) {
      console.error(`No se pudo cargar ${station.name}`, error);
      return `<article class="station-card"><h3>${station.name}</h3><p class="station-river">${station.river}</p><p class="form-message">Medición no disponible.</p></article>`;
    }
  }));
  elements.stationGrid.innerHTML = cards.join("");
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
    getPublicStatus().then(renderVelocityStatus).catch((error) => {
      console.error(error);
      renderVelocityStatus(null);
    });
    loadHistory();
    loadObservedStations();
  } catch (error) {
    elements.connectionStatus.className = "live-status has-error";
    elements.connectionStatus.lastElementChild.textContent = "No se pudo actualizar";
    elements.observedAt.textContent = "No pudimos consultar el INA. Probá actualizar nuevamente.";
    elements.forecastGrid.innerHTML = `<p class="form-message">El pronóstico no está disponible en este momento.</p>`;
    elements.stationGrid.innerHTML = `<p class="form-message">Las estaciones comparativas no están disponibles en este momento.</p>`;
    console.error(error);
  } finally {
    elements.refreshButton.disabled = false;
    elements.refreshButton.textContent = "↻ Actualizar ahora";
  }
}

async function loadHistory() {
  const requestId = ++historyRequestId;
  const days = Number(elements.historyRange.value);
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  setHistoryDownload([], days);
  latest.history = [];
  elements.historySummary.textContent = "Cargando historial y estaciones comparativas…";
  elements.historyLegend.innerHTML = "";
  elements.historyChart.innerHTML = "";
  elements.historyList.innerHTML = "";
  try {
    const series = await Promise.all(HISTORY_STATIONS.map(async (station) => {
      try {
        const rows = normalizeObservations(await getJson("datos", {
          timeStart: start.toISOString().slice(0, 10),
          timeEnd: end.toISOString().slice(0, 10),
          siteCode: station.siteCode,
          varId: station.varId,
          format: "json",
        }));
        return { ...station, rows, chartRows: historyChartRows(rows, days) };
      } catch (error) {
        console.error(`No se pudo cargar el historial de ${station.name}`, error);
        return { ...station, rows: [], chartRows: [], error };
      }
    }));
    if (requestId !== historyRequestId) return;
    const mainSeries = series.find((item) => item.siteCode === STATION.siteCode);
    if (!mainSeries?.rows.length) throw new Error("El INA no devolvió mediciones históricas de San Fernando.");
    const availableSeries = series.filter((item) => item.chartRows.length);
    const chartRows = availableSeries.flatMap((item) => item.chartRows);
    latest.history = mainSeries.rows;
    setHistoryDownload(mainSeries.rows, days);
    const values = mainSeries.rows.map((row) => row.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const chartValues = chartRows.map((row) => row.value);
    const scaleMin = Math.min(0, ...chartValues);
    const scaleMax = Math.max(thresholds.evacuation, ...chartValues);
    const span = scaleMax - scaleMin || 1;
    const firstTimestamp = Math.min(...chartRows.map((row) => asDate(row.date).getTime()));
    const lastTimestamp = Math.max(...chartRows.map((row) => asDate(row.date).getTime()));
    const timeSpan = lastTimestamp - firstTimestamp || 1;
    const x = (date) => (asDate(date).getTime() - firstTimestamp) / timeSpan * 620 + 60;
    const y = (value) => 165 - (value - scaleMin) / span * 125;
    const stamp = (date) => new Intl.DateTimeFormat("es-AR", days >= 90
      ? { month: "short", year: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }
      : { day: "numeric", month: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(asDate(date));
    const compact = (row) => new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }).format(asDate(row.date)).replace(",", " ·");
    const showPoints = chartRows.length <= 160;
    const seriesMarkup = availableSeries.map((item) => {
      const points = item.chartRows.map((row) => `${x(row.date)},${y(row.value)}`).join(" ");
      const circles = showPoints ? item.chartRows.map((row) => `<circle class="history-point" style="fill:${item.color}" cx="${x(row.date)}" cy="${y(row.value)}" r="3"><title>${item.name} · ${days === 1 ? formatDate(row.date) : stamp(row.date)}: ${formatLevel(row.value)} m${row.samples ? ` · ${row.samples} mediciones` : ""}</title></circle>`).join("") : "";
      return `<polyline class="history-series" style="stroke:${item.color}" points="${points}"><title>${item.name}</title></polyline>${circles}`;
    }).join("");
    elements.historyChart.innerHTML = `<line x1="60" y1="165" x2="690" y2="165"/><line x1="60" y1="40" x2="60" y2="165"/><text x="4" y="45">${formatLevel(scaleMax)} m</text><text x="4" y="165">${formatLevel(scaleMin)} m</text><line class="threshold-line threshold-evacuation" x1="60" y1="${y(thresholds.evacuation)}" x2="690" y2="${y(thresholds.evacuation)}"/><text class="threshold-label" text-anchor="end" x="688" y="${y(thresholds.evacuation) - 4}">Evacuación 3,50 m</text><line class="threshold-line threshold-alert" x1="60" y1="${y(thresholds.alert)}" x2="690" y2="${y(thresholds.alert)}"/><text class="threshold-label" text-anchor="end" x="688" y="${y(thresholds.alert) - 4}">Alerta 3,00 m</text>${seriesMarkup}<text x="60" y="187">${stamp(new Date(firstTimestamp).toISOString())}</text><text text-anchor="end" x="690" y="187">${stamp(new Date(lastTimestamp).toISOString())}</text>`;
    elements.historyLegend.innerHTML = availableSeries.map((item) => `<span class="history-legend-item"><i style="background:${item.color}"></i>${item.name}</span>`).join("");
    const resolution = days === 1 ? "mediciones horarias" : "promedios diarios";
    elements.historySummary.textContent = `San Fernando: ${mainSeries.rows.length} mediciones · mínimo ${formatLevel(min)} m · máximo ${formatLevel(max)} m. Gráfico con ${resolution} de ${availableSeries.length} estaciones.`;
    elements.historyList.innerHTML = mainSeries.rows.slice(-4).map((row) => `<div class="history-item">${compact(row)}<strong>${formatLevel(row.value)} m</strong></div>`).join("");
  } catch (error) {
    if (requestId !== historyRequestId) return;
    elements.historySummary.textContent = "No se pudo cargar el historial.";
    elements.historyLegend.innerHTML = "";
    elements.historyChart.innerHTML = "";
    elements.historyList.innerHTML = "";
    console.error(error);
  }
}

elements.refreshButton.addEventListener("click", refresh);
elements.historyRange.addEventListener("change", loadHistory);
refresh();
