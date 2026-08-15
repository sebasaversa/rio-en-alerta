import { buildHistoryCsv, historyChartRows, historyCsvFilename } from "./history.mjs";
import { MIN_VIEWPORT_SPAN, isFullViewport, nearestRow, niceScale, normalizeViewport, panViewport, viewportTimestamps, zoomViewport } from "./chart-viewport.mjs";

const API_BASE = "https://alerta.ina.gob.ar/pub/datos";
const PUBLIC_STATUS_URL = "https://us-central1-rio-en-alerta-sanfernando.cloudfunctions.net/publicRiverStatus";
const STATION = { siteCode: 52, seriesId: 52, varId: 2, name: "San Fernando", river: "Río Luján", color: "var(--station-san-fernando)" };
const HISTORY_STATIONS = [
  STATION,
  { siteCode: 49, varId: 2, name: "Tigre", river: "Río Luján", color: "var(--station-tigre)" },
  { siteCode: 50, varId: 2, name: "Dique Luján", river: "Río Luján", color: "var(--station-dique)" },
  { siteCode: 53, varId: 2, name: "San Isidro", river: "Río de la Plata", color: "var(--station-san-isidro)" },
];
const OBSERVED_STATIONS = HISTORY_STATIONS.slice(1);

const elements = {
  themeSelect: document.querySelector("#theme-select"),
  themeColor: document.querySelector("#theme-color"),
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
  historyZoomIn: document.querySelector("#history-zoom-in"), historyZoomOut: document.querySelector("#history-zoom-out"), historyZoomReset: document.querySelector("#history-zoom-reset"), historyZoomStatus: document.querySelector("#history-zoom-status"),
  historyScaleDetail: document.querySelector("#history-scale-detail"), historyScaleFull: document.querySelector("#history-scale-full"), historyScaleNote: document.querySelector("#history-scale-note"), historyTooltip: document.querySelector("#history-chart-tooltip"), historyListTitle: document.querySelector("#history-list-title"),
};

let thresholds = { alert: 3, evacuation: 3.5 };
let latest = { current: null, forecast: [], history: [] };
let historyDownloadUrl = null;
let historyRequestId = 0;
let historyChartModel = null;
let historyViewport = { start: 0, end: 1 };
let historyScaleMode = "full";
const historyPointers = new Map();
let historyGesture = null;

function setTheme(value, persist = true) {
  const theme = value === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  elements.themeSelect.value = theme;
  elements.themeColor.content = theme === "light" ? "#f6f1e7" : "#071b22";
  if (!persist) return;
  try {
    localStorage.setItem("rio-en-alerta-theme", theme);
  } catch { /* El selector sigue funcionando aunque el navegador bloquee el almacenamiento. */ }
}

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

const HISTORY_PLOT = { left: 60, right: 690, top: 40, bottom: 165, svgWidth: 700 };

function historyStamp(timestamp, days) {
  const options = days === 1
    ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }
    : days >= 90
      ? { month: "short", year: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }
      : { day: "numeric", month: "short", timeZone: "America/Argentina/Buenos_Aires" };
  return new Intl.DateTimeFormat("es-AR", options).format(new Date(timestamp)).replace(",", " ·");
}

function updateHistoryZoomControls() {
  const full = !historyChartModel || isFullViewport(historyViewport);
  const span = historyViewport.end - historyViewport.start;
  elements.historyZoomIn.disabled = !historyChartModel || span <= MIN_VIEWPORT_SPAN + 0.000001;
  elements.historyZoomOut.disabled = full;
  elements.historyZoomReset.disabled = full;
  if (!historyChartModel || full) {
    elements.historyZoomStatus.textContent = "Vista completa";
    return;
  }
  const visible = viewportTimestamps(historyChartModel.firstTimestamp, historyChartModel.lastTimestamp, historyViewport);
  elements.historyZoomStatus.textContent = `Mostrando ${historyStamp(visible.start, historyChartModel.days)} – ${historyStamp(visible.end, historyChartModel.days)}`;
}

function completeHistoryScale(minimum, maximum) {
  const min = Number(minimum);
  const max = Number(maximum);
  const step = max - min <= 4 ? 0.5 : 1;
  const ticks = [];
  for (let value = Math.ceil(min / step) * step; value <= max + step / 2; value += step) {
    ticks.push(Number(value.toFixed(10)));
  }
  return { min, max, step, ticks };
}

function historyCompact(row, days) {
  const options = days === 1
    ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }
    : { day: "numeric", month: "short", year: "numeric", timeZone: "America/Argentina/Buenos_Aires" };
  return new Intl.DateTimeFormat("es-AR", options).format(asDate(row.date)).replace(",", " ·");
}

function clearHistoryTooltip() {
  elements.historyTooltip.hidden = true;
  elements.historyTooltip.innerHTML = "";
  elements.historyChart.querySelector("#history-crosshair")?.replaceChildren();
}

function renderVisibleHistoryList(visible) {
  const { mainSeries, days } = historyChartModel;
  const rows = mainSeries.chartRows.filter((row) => {
    const timestamp = asDate(row.date).getTime();
    return timestamp >= visible.start && timestamp <= visible.end;
  }).slice(-4);
  elements.historyListTitle.textContent = "San Fernando · valores más recientes del período visible";
  elements.historyList.innerHTML = rows.length
    ? rows.map((row) => `<div class="history-item">${historyCompact(row, days)}<strong>${formatLevel(row.value)} m</strong>${row.samples ? `<small>Promedio de ${row.samples} mediciones</small>` : ""}</div>`).join("")
    : `<p class="form-message">No hay mediciones de San Fernando dentro de este período.</p>`;
}

function renderHistoryChart() {
  if (!historyChartModel) {
    updateHistoryZoomControls();
    return;
  }

  const { availableSeries, scaleMin, scaleMax, days, firstTimestamp, lastTimestamp } = historyChartModel;
  const visible = viewportTimestamps(firstTimestamp, lastTimestamp, historyViewport);
  const visibleTimeSpan = visible.end - visible.start || 1;
  const plotWidth = HISTORY_PLOT.right - HISTORY_PLOT.left;
  const plotHeight = HISTORY_PLOT.bottom - HISTORY_PLOT.top;
  const visibleRows = availableSeries.flatMap((item) => item.chartRows.filter((row) => {
    const timestamp = asDate(row.date).getTime();
    return timestamp >= visible.start && timestamp <= visible.end;
  }));
  const scale = historyScaleMode === "detail"
    ? niceScale(visibleRows.map((row) => row.value))
    : completeHistoryScale(scaleMin, scaleMax);
  const valueSpan = scale.max - scale.min || 1;
  const x = (date) => (asDate(date).getTime() - visible.start) / visibleTimeSpan * plotWidth + HISTORY_PLOT.left;
  const y = (value) => HISTORY_PLOT.bottom - (value - scale.min) / valueSpan * plotHeight;
  const showPoints = visibleRows.length <= 160;
  const gridMarkup = scale.ticks.map((value) => `<line class="history-grid-line" x1="${HISTORY_PLOT.left}" y1="${y(value)}" x2="${HISTORY_PLOT.right}" y2="${y(value)}"/><text class="history-axis-label" text-anchor="end" x="54" y="${y(value) + 4}">${formatLevel(value)} m</text>`).join("");
  const thresholdMarkup = [
    { value: thresholds.evacuation, className: "threshold-evacuation", label: "Evacuación 3,50 m" },
    { value: thresholds.alert, className: "threshold-alert", label: "Alerta 3,00 m" },
  ].filter((threshold) => threshold.value >= scale.min && threshold.value <= scale.max).map((threshold) => `<line class="threshold-line ${threshold.className}" x1="${HISTORY_PLOT.left}" y1="${y(threshold.value)}" x2="${HISTORY_PLOT.right}" y2="${y(threshold.value)}"/><text class="threshold-label" text-anchor="end" x="688" y="${y(threshold.value) - 4}">${threshold.label}</text>`).join("");
  const seriesMarkup = availableSeries.map((item) => {
    const points = item.chartRows.map((row) => `${x(row.date)},${y(row.value)}`).join(" ");
    const circles = showPoints ? item.chartRows.filter((row) => {
      const timestamp = asDate(row.date).getTime();
      return timestamp >= visible.start && timestamp <= visible.end;
    }).map((row) => `<circle class="history-point" style="fill:${item.color}" cx="${x(row.date)}" cy="${y(row.value)}" r="3"><title>${item.name} · ${days === 1 ? formatDate(row.date) : historyStamp(asDate(row.date).getTime(), days)}: ${formatLevel(row.value)} m${row.samples ? ` · ${row.samples} mediciones` : ""}</title></circle>`).join("") : "";
    return `<polyline class="history-series" style="stroke:${item.color}" points="${points}"><title>${item.name}</title></polyline>${circles}`;
  }).join("");

  elements.historyChart.innerHTML = `<defs><clipPath id="history-plot-clip"><rect x="${HISTORY_PLOT.left}" y="${HISTORY_PLOT.top - 5}" width="${plotWidth}" height="${plotHeight + 10}"/></clipPath></defs>${gridMarkup}<line x1="${HISTORY_PLOT.left}" y1="${HISTORY_PLOT.top}" x2="${HISTORY_PLOT.left}" y2="${HISTORY_PLOT.bottom}"/>${thresholdMarkup}<g clip-path="url(#history-plot-clip)">${seriesMarkup}<g id="history-crosshair"></g></g><text x="${HISTORY_PLOT.left}" y="187">${historyStamp(visible.start, days)}</text><text text-anchor="end" x="${HISTORY_PLOT.right}" y="187">${historyStamp(visible.end, days)}</text>`;
  elements.historyChart.setAttribute("aria-label", `Comparación histórica de alturas observadas. Período visible: ${historyStamp(visible.start, days)} a ${historyStamp(visible.end, days)}.`);
  historyChartModel.renderState = { visible, scale, x, y };
  elements.historyScaleDetail.classList.toggle("is-active", historyScaleMode === "detail");
  elements.historyScaleFull.classList.toggle("is-active", historyScaleMode === "full");
  elements.historyScaleDetail.setAttribute("aria-pressed", String(historyScaleMode === "detail"));
  elements.historyScaleFull.setAttribute("aria-pressed", String(historyScaleMode === "full"));
  const hiddenThresholds = [thresholds.alert, thresholds.evacuation].filter((value) => value > scale.max || value < scale.min);
  elements.historyScaleNote.textContent = historyScaleMode === "detail" && hiddenThresholds.length
    ? `Variaciones: amplía las diferencias entre ${formatLevel(scale.min)} y ${formatLevel(scale.max)} m. Elegí “Niveles oficiales” para ver alerta y evacuación.`
    : historyScaleMode === "detail"
      ? `Variaciones: escala ajustada entre ${formatLevel(scale.min)} y ${formatLevel(scale.max)} m.`
      : `Niveles oficiales: escala completa entre ${formatLevel(scale.min)} y ${formatLevel(scale.max)} m.`;
  renderVisibleHistoryList(visible);
  clearHistoryTooltip();
  updateHistoryZoomControls();
}

function showHistoryTooltip(clientX) {
  if (!historyChartModel?.renderState) return;
  const { availableSeries, days, renderState } = historyChartModel;
  const { visible, scale, x, y } = renderState;
  const targetTimestamp = visible.start + historyChartAnchor(clientX) * (visible.end - visible.start);
  const visibleRows = availableSeries.flatMap((item) => item.chartRows.filter((row) => {
    const timestamp = asDate(row.date).getTime();
    return timestamp >= visible.start && timestamp <= visible.end;
  }));
  const selected = nearestRow(visibleRows, targetTimestamp);
  if (!selected) return clearHistoryTooltip();
  const selectedTimestamp = asDate(selected.date).getTime();
  const values = availableSeries.map((item) => {
    const row = nearestRow(item.chartRows, selectedTimestamp);
    const timestamp = row ? asDate(row.date).getTime() : Number.NaN;
    return { item, row: timestamp >= visible.start && timestamp <= visible.end ? row : null, timestamp };
  });
  const crosshairX = x(selected.date);
  const points = values.filter(({ row }) => row && row.value >= scale.min && row.value <= scale.max).map(({ item, row }) => `<circle class="history-crosshair-point" style="fill:${item.color}" cx="${x(row.date)}" cy="${y(row.value)}" r="5"/>`).join("");
  const crosshair = elements.historyChart.querySelector("#history-crosshair");
  if (crosshair) crosshair.innerHTML = `<line class="history-crosshair-line" x1="${crosshairX}" y1="${HISTORY_PLOT.top}" x2="${crosshairX}" y2="${HISTORY_PLOT.bottom}"/>${points}`;
  const dateLabel = days === 1 ? formatDate(selected.date) : historyCompact(selected, days);
  elements.historyTooltip.innerHTML = `<strong>${dateLabel}</strong>${values.map(({ item, row }) => `<div class="history-tooltip-row"><i style="background:${item.color}"></i><span>${item.name}</span><b>${row ? `${formatLevel(row.value)} m` : "—"}</b></div>`).join("")}`;
  const frameBounds = elements.historyTooltip.parentElement.getBoundingClientRect();
  const halfWidth = Math.min(110, frameBounds.width / 2);
  const relativeX = Math.min(frameBounds.width - halfWidth, Math.max(halfWidth, clientX - frameBounds.left));
  elements.historyTooltip.style.left = `${relativeX}px`;
  elements.historyTooltip.hidden = false;
}

function setHistoryViewport(nextViewport) {
  clearHistoryTooltip();
  historyViewport = normalizeViewport(nextViewport);
  renderHistoryChart();
}

function historyChartAnchor(clientX) {
  const bounds = elements.historyChart.getBoundingClientRect();
  if (!bounds.width) return 0.5;
  const svgX = (clientX - bounds.left) / bounds.width * HISTORY_PLOT.svgWidth;
  return Math.min(1, Math.max(0, (svgX - HISTORY_PLOT.left) / (HISTORY_PLOT.right - HISTORY_PLOT.left)));
}

function historyPlotPixelWidth() {
  return elements.historyChart.getBoundingClientRect().width * (HISTORY_PLOT.right - HISTORY_PLOT.left) / HISTORY_PLOT.svgWidth || 1;
}

function beginHistoryPointer(event) {
  if (!historyChartModel || (event.pointerType === "mouse" && event.button !== 0)) return;
  showHistoryTooltip(event.clientX);
  elements.historyChart.setPointerCapture?.(event.pointerId);
  historyPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  elements.historyChart.classList.add("is-dragging");
  if (historyPointers.size === 1) {
    historyGesture = { kind: "pan", startX: event.clientX, startY: event.clientY, moved: false, viewport: { ...historyViewport } };
  } else if (historyPointers.size === 2) {
    clearHistoryTooltip();
    const points = [...historyPointers.values()];
    historyGesture = {
      kind: "pinch",
      distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) || 1,
      anchor: historyChartAnchor((points[0].x + points[1].x) / 2),
      viewport: { ...historyViewport },
    };
  }
}

function moveHistoryPointer(event) {
  if (!historyChartModel) return;
  if (!historyPointers.has(event.pointerId)) {
    showHistoryTooltip(event.clientX);
    return;
  }
  historyPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (historyPointers.size >= 2) {
    const points = [...historyPointers.values()].slice(0, 2);
    if (historyGesture?.kind !== "pinch") {
      historyGesture = {
        kind: "pinch",
        distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) || 1,
        anchor: historyChartAnchor((points[0].x + points[1].x) / 2),
        viewport: { ...historyViewport },
      };
      return;
    }
    const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) || 1;
    setHistoryViewport(zoomViewport(historyGesture.viewport, distance / historyGesture.distance, historyGesture.anchor));
    return;
  }
  if (historyGesture?.kind === "pan") {
    historyGesture.moved = historyGesture.moved || Math.hypot(event.clientX - historyGesture.startX, event.clientY - historyGesture.startY) > 4;
    const span = historyGesture.viewport.end - historyGesture.viewport.start;
    const delta = -(event.clientX - historyGesture.startX) / historyPlotPixelWidth() * span;
    setHistoryViewport(panViewport(historyGesture.viewport, delta));
  }
}

function endHistoryPointer(event) {
  const finishedGesture = historyGesture;
  historyPointers.delete(event.pointerId);
  if (historyPointers.size === 1) {
    const remaining = [...historyPointers.values()][0];
    historyGesture = { kind: "pan", startX: remaining.x, startY: remaining.y, moved: false, viewport: { ...historyViewport } };
  } else if (!historyPointers.size) {
    historyGesture = null;
    elements.historyChart.classList.remove("is-dragging");
    if (finishedGesture?.kind === "pan") showHistoryTooltip(event.clientX);
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
  historyChartModel = null;
  historyViewport = { start: 0, end: 1 };
  elements.historySummary.textContent = "Cargando historial y estaciones comparativas…";
  elements.historyLegend.innerHTML = "";
  elements.historyChart.innerHTML = "";
  clearHistoryTooltip();
  elements.historyScaleNote.textContent = "";
  elements.historyList.innerHTML = "";
  updateHistoryZoomControls();
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
    const firstTimestamp = Math.min(...chartRows.map((row) => asDate(row.date).getTime()));
    const lastTimestamp = Math.max(...chartRows.map((row) => asDate(row.date).getTime()));
    historyChartModel = { availableSeries, mainSeries, scaleMin, scaleMax, days, firstTimestamp, lastTimestamp };
    historyViewport = { start: 0, end: 1 };
    renderHistoryChart();
    elements.historyLegend.innerHTML = availableSeries.map((item) => `<span class="history-legend-item"><i style="background:${item.color}"></i>${item.name}</span>`).join("");
    const resolution = days === 1 ? "mediciones horarias" : "promedios diarios";
    elements.historySummary.textContent = `San Fernando: ${mainSeries.rows.length} mediciones · mínimo ${formatLevel(min)} m · máximo ${formatLevel(max)} m. Gráfico con ${resolution} de ${availableSeries.length} estaciones.`;
  } catch (error) {
    if (requestId !== historyRequestId) return;
    elements.historySummary.textContent = "No se pudo cargar el historial.";
    historyChartModel = null;
    historyViewport = { start: 0, end: 1 };
    elements.historyLegend.innerHTML = "";
    elements.historyChart.innerHTML = "";
    clearHistoryTooltip();
    elements.historyScaleNote.textContent = "";
    elements.historyList.innerHTML = "";
    updateHistoryZoomControls();
    console.error(error);
  }
}

elements.themeSelect.addEventListener("change", (event) => setTheme(event.target.value));
elements.refreshButton.addEventListener("click", refresh);
elements.historyRange.addEventListener("change", loadHistory);
elements.historyZoomIn.addEventListener("click", () => setHistoryViewport(zoomViewport(historyViewport, 1.6, 0.5)));
elements.historyZoomOut.addEventListener("click", () => setHistoryViewport(zoomViewport(historyViewport, 1 / 1.6, 0.5)));
elements.historyZoomReset.addEventListener("click", () => setHistoryViewport({ start: 0, end: 1 }));
elements.historyScaleDetail.addEventListener("click", () => {
  historyScaleMode = "detail";
  renderHistoryChart();
});
elements.historyScaleFull.addEventListener("click", () => {
  historyScaleMode = "full";
  renderHistoryChart();
});
elements.historyChart.addEventListener("wheel", (event) => {
  if (!historyChartModel) return;
  event.preventDefault();
  const factor = Math.min(2, Math.max(0.5, Math.exp(-event.deltaY * 0.002)));
  setHistoryViewport(zoomViewport(historyViewport, factor, historyChartAnchor(event.clientX)));
}, { passive: false });
elements.historyChart.addEventListener("pointerdown", beginHistoryPointer);
elements.historyChart.addEventListener("pointermove", moveHistoryPointer);
elements.historyChart.addEventListener("pointerup", endHistoryPointer);
elements.historyChart.addEventListener("pointercancel", endHistoryPointer);
elements.historyChart.addEventListener("pointerleave", (event) => {
  if (event.pointerType === "mouse" && !historyPointers.size) clearHistoryTooltip();
});
elements.historyChart.addEventListener("keydown", (event) => {
  if (!historyChartModel) return;
  const span = historyViewport.end - historyViewport.start;
  if (event.key === "+" || event.key === "=") setHistoryViewport(zoomViewport(historyViewport, 1.6, 0.5));
  else if (event.key === "-") setHistoryViewport(zoomViewport(historyViewport, 1 / 1.6, 0.5));
  else if (event.key === "0" || event.key === "Escape") setHistoryViewport({ start: 0, end: 1 });
  else if (event.key === "ArrowLeft") setHistoryViewport(panViewport(historyViewport, -span * 0.1));
  else if (event.key === "ArrowRight") setHistoryViewport(panViewport(historyViewport, span * 0.1));
  else return;
  event.preventDefault();
});
setTheme(document.documentElement.dataset.theme, false);
refresh();
