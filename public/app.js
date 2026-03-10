const CARD_TONES = [
  { a: "#17314f", b: "#0e1f34" },
  { a: "#1f4056", b: "#132735" },
  { a: "#214f50", b: "#123032" },
  { a: "#253f63", b: "#172740" }
];

const SPORT_META = {
  cycling: { label: "Cycling", icon: "🚴" },
  hiking: { label: "Hiking", icon: "🥾" },
  skiing: { label: "Skiing", icon: "⛷️" }
};

const GRADE_TO_SCORE = {
  poor: 25,
  fair: 55,
  good: 78,
  excellent: 95
};

const state = {
  locations: [],
  cards: new Map(),
  focusedLocation: "",
  selectedLocation: "",
  isMobileLayout: false,
  isTransitioningDetail: false
};

const elements = {
  homeBtn: document.getElementById("homeBtn"),
  addLocationBtn: document.getElementById("addLocationBtn"),
  refreshAllBtn: document.getElementById("refreshAllBtn"),
  statusText: document.getElementById("statusText"),
  overviewPage: document.getElementById("overviewPage"),
  detailPage: document.getElementById("detailPage"),
  locationGrid: document.getElementById("locationGrid"),
  selectedLocationName: document.getElementById("selectedLocationName"),
  selectedUpdated: document.getElementById("selectedUpdated"),
  dailyCondition: document.getElementById("dailyCondition"),
  dailyTemp: document.getElementById("dailyTemp"),
  dailyLowHigh: document.getElementById("dailyLowHigh"),
  dailyWind: document.getElementById("dailyWind"),
  benchmarkScore: document.getElementById("benchmarkScore"),
  benchmarkSource: document.getElementById("benchmarkSource"),
  benchmarkDelta: document.getElementById("benchmarkDelta"),
  benchmarkList: document.getElementById("benchmarkList"),
  sportGrid: document.getElementById("sportGrid"),
  historyMeta: document.getElementById("historyMeta"),
  historyChart: document.getElementById("historyChart"),
  historyList: document.getElementById("historyList")
};

bindEvents();
initialize();

function isMobileViewport() {
  return window.matchMedia("(max-width: 760px)").matches;
}

function bindEvents() {
  elements.homeBtn.addEventListener("click", () => {
    showOverviewPage();
  });

  elements.addLocationBtn.addEventListener("click", async () => {
    const location = window.prompt("Add new location", "");
    if (!location) {
      return;
    }

    const normalized = location.trim();
    if (!normalized) {
      return;
    }

    await addLocation(normalized);
  });

  elements.refreshAllBtn.addEventListener("click", async () => {
    await loadOverview();
  });

  elements.locationGrid.addEventListener("click", async (event) => {
    const button = getLocationButton(event);
    if (!button) {
      return;
    }

    const location = button.getAttribute("data-location") || "";
    if (!location) {
      return;
    }

    if (isMobileViewport()) {
      await openDetailPage(location);
      return;
    }

    updateFocusedCard(location);
    setStatus(`Double-click ${location} to open detail view.`);
  });

  elements.locationGrid.addEventListener("dblclick", async (event) => {
    if (isMobileViewport()) {
      return;
    }

    const button = getLocationButton(event);
    if (!button) {
      return;
    }

    const location = button.getAttribute("data-location") || "";
    if (!location) {
      return;
    }

    await openDetailPage(location);
  });

  window.addEventListener("resize", () => {
    const mobileNow = isMobileViewport();
    if (mobileNow !== state.isMobileLayout) {
      state.isMobileLayout = mobileNow;
      renderLocationCards();
      return;
    }

    applyCoverflowTransforms();
  });
}

async function initialize() {
  state.isMobileLayout = isMobileViewport();
  await loadOverview();

  const queryLocation = (new URLSearchParams(window.location.search).get("location") || "").trim();
  if (queryLocation) {
    const matched = state.locations.find((location) => normalizeLocation(location) === normalizeLocation(queryLocation));
    if (matched) {
      await openDetailPage(matched, { animate: false });
    }
  }
}

async function loadOverview() {
  setLoading(true);
  setStatus("Loading predefined locations from public/data...");

  const locationResult = await loadPredefinedLocations();
  if (!locationResult.ok) {
    setLoading(false);
    setStatus(locationResult.error || "Unable to load predefined locations.", "error");
    return;
  }

  state.locations = locationResult.locations;
  state.cards.clear();

  const cardResults = await Promise.all(
    state.locations.map(async (location) => {
      const result = await apiRequest(`/api/weather?location=${encodeURIComponent(location)}`);
      return { location, result };
    })
  );

  for (const { location, result } of cardResults) {
    if (result.ok) {
      state.cards.set(location, result);
    }
  }

  if (!state.focusedLocation && state.locations.length) {
    state.focusedLocation = state.locations[0];
  }

  renderLocationCards();
  setLoading(false);
  setStatus(`Loaded ${state.locations.length} locations.`, "success");
}

async function loadPredefinedLocations() {
  try {
    const response = await fetch("/data/weather_latest_report.json");
    if (!response.ok) {
      return {
        ok: false,
        locations: [],
        error: `Failed to load predefined locations (status ${response.status}).`
      };
    }

    const report = await response.json();
    const zones = Array.isArray(report?.zones) ? report.zones : [];
    const predefinedLocations = zones
      .map((zone) => (typeof zone?.name === "string" ? zone.name.trim() : ""))
      .filter(Boolean);

    const watchlistResult = await apiRequest("/api/weather/watchlist");
    const watchlistData = toObject(watchlistResult.data);
    const watchlistLocations = Array.isArray(watchlistData?.locations)
      ? watchlistData.locations.map((item) => `${item || ""}`.trim()).filter(Boolean)
      : [];

    const locations = [...new Set([...predefinedLocations, ...watchlistLocations])];

    if (!locations.length) {
      return {
        ok: false,
        locations: [],
        error: "No locations found in weather_latest_report.json."
      };
    }

    return {
      ok: true,
      locations: [...new Set(locations)]
    };
  } catch (error) {
    return {
      ok: false,
      locations: [],
      error: error?.message || "Failed to read predefined location file."
    };
  }
}

async function addLocation(location) {
  setLoading(true);
  setStatus(`Adding ${location}...`);

  const result = await apiRequest("/api/weather/watchlist", {
    method: "POST",
    body: JSON.stringify({ location })
  });

  if (!result.ok) {
    setLoading(false);
    setStatus(result.error || `Unable to add ${location}.`, "error");
    return;
  }

  await loadOverview();
  setStatus(`${location} added.`, "success");
}

async function openDetailPage(location, options = {}) {
  if (state.isTransitioningDetail) {
    return;
  }

  state.isTransitioningDetail = true;
  setLoading(true);

  try {
    let payload = state.cards.get(location);
    if (!payload) {
      const result = await apiRequest(`/api/weather?location=${encodeURIComponent(location)}`);
      if (!result.ok) {
        setStatus(result.error || `Unable to load detail for ${location}.`, "error");
        return;
      }

      payload = result;
      state.cards.set(location, result);
    }

    state.selectedLocation = location;
    updateFocusedCard(location);
    if (options.animate !== false) {
      await playDetailTransition(location);
    }
    renderDetail(payload);
    showDetailPage();
    window.history.replaceState(window.history.state, "", `?location=${encodeURIComponent(location)}`);
    setStatus(`Opened detail page for ${location}.`, "success");
  } catch (error) {
    setStatus(error?.message || `Unable to open detail page for ${location}.`, "error");
  } finally {
    setLoading(false);
    state.isTransitioningDetail = false;
  }
}

function showOverviewPage() {
  elements.overviewPage.classList.remove("is-hidden");
  elements.detailPage.classList.add("is-hidden");
  window.history.replaceState(window.history.state, "", window.location.pathname);
  const hint = isMobileViewport()
    ? "Showing predefined locations. Tap a card for details."
    : "Showing predefined locations. Double-click a card for details.";
  setStatus(hint);
}

function showDetailPage() {
  elements.overviewPage.classList.add("is-hidden");
  elements.detailPage.classList.remove("is-hidden");
}

function updateFocusedCard(location) {
  state.focusedLocation = location;
  applyCoverflowTransforms();
}

function renderLocationCards() {
  elements.locationGrid.innerHTML = "";

  if (!state.locations.length) {
    const empty = document.createElement("p");
    empty.className = "status is-error";
    empty.textContent = "No predefined locations available.";
    elements.locationGrid.appendChild(empty);
    return;
  }

  const actionHint = isMobileViewport() ? "Tap for detail view" : "Double-click for detail view";

  for (let index = 0; index < state.locations.length; index += 1) {
    const location = state.locations[index];
    const payload = state.cards.get(location);

    const daily = toObject(payload?.data?.daily);
    const benchmark = toObject(payload?.data?.benchmark);

    const condition = pickValue(daily, ["condition", "summary", "description"]);
    const temp = pickValue(daily, ["temperature", "temp", "temp_c"]);
    const low = pickValue(daily, ["temp_min", "low", "temperature_min"]);
    const high = pickValue(daily, ["temp_max", "high", "temperature_max"]);
    const wind = pickValue(daily, ["wind_kph", "wind", "wind_speed"]);
    const score = pickValue(benchmark, ["score", "confidence", "latest_confidence"]);
    const updatedAt = pickValue(daily, ["updated_at", "forecast_date", "date", "timestamp"]);

    const tempValue = toNumber(temp);
    const tone = CARD_TONES[index % CARD_TONES.length];
    const displayTemp = tempValue === null ? "--" : tempValue.toFixed(0);
    const displayCondition = shortText(condition, 74);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "location-card";
    button.setAttribute("data-location", location);
    button.setAttribute("aria-label", `${location}. ${actionHint}`);
    button.style.background = `linear-gradient(160deg, ${tone.a}, ${tone.b})`;

    if (normalizeLocation(state.focusedLocation) === normalizeLocation(location)) {
      button.classList.add("is-focused");
    }

    button.innerHTML = `
      <div class="location-card-inner">
      <div class="location-head">
        <div class="location-title-wrap">
          <h3 class="location-name">${escapeHtml(location)}</h3>
          <p class="location-label">Live weather</p>
        </div>
        <p class="location-time">${escapeHtml(formatTimeOnly(updatedAt))}</p>
      </div>
      <div class="location-main">
        <span class="weather-icon" aria-hidden="true">${pickWeatherIcon(condition)}</span>
        <p class="location-temp">${escapeHtml(displayTemp)}°C</p>
      </div>
      <p class="location-condition">${escapeHtml(displayCondition)}</p>
      <div class="location-stats-grid">
        <article class="mini-stat">
          <span>Low</span>
          <strong>${escapeHtml(formatTemperature(low))}</strong>
        </article>
        <article class="mini-stat">
          <span>High</span>
          <strong>${escapeHtml(formatTemperature(high))}</strong>
        </article>
        <article class="mini-stat">
          <span>Wind</span>
          <strong>${escapeHtml(formatWind(wind))}</strong>
        </article>
        <article class="mini-stat">
          <span>Score</span>
          <strong>${escapeHtml(formatScore(score))}</strong>
        </article>
      </div>
      <div class="location-foot">
        <span class="pill">${escapeHtml(actionHint)}</span>
      </div>
      </div>
    `;

    elements.locationGrid.appendChild(button);
  }

  applyCoverflowTransforms();
}

function applyCoverflowTransforms() {
  const cards = Array.from(elements.locationGrid.querySelectorAll("button[data-location]"));
  if (!cards.length) {
    return;
  }

  const focusedNormalized = normalizeLocation(state.focusedLocation);
  let focusedIndex = cards.findIndex((card) => normalizeLocation(card.getAttribute("data-location") || "") === focusedNormalized);
  if (focusedIndex < 0) {
    focusedIndex = 0;
    state.focusedLocation = cards[0].getAttribute("data-location") || "";
  }

  if (window.matchMedia("(max-width: 760px)").matches) {
    for (let index = 0; index < cards.length; index += 1) {
      const card = cards[index];
      const isFocused = index === focusedIndex;
      card.classList.toggle("is-focused", isFocused);
      card.style.setProperty("--card-base-transform", "none");
      card.style.setProperty("--card-base-opacity", "1");
      card.style.setProperty("--card-base-filter", "brightness(1)");
      card.style.transform = "";
      card.style.opacity = "";
      card.style.filter = "";
      card.style.zIndex = "";
      card.style.pointerEvents = "";
    }

    requestAnimationFrame(() => {
      centerCardInViewport(cards, focusedIndex);
    });
    return;
  }

  const stageWidth = elements.locationGrid.clientWidth || window.innerWidth || 1200;
  const cardWidth = cards[0].getBoundingClientRect().width || 480;
  const baseSpacing = Math.min(Math.max(cardWidth * 0.38, 120), stageWidth * 0.3);
  const maxVisibleDistance = 4;

  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    const distance = index - focusedIndex;
    const absDistance = Math.abs(distance);
    const direction = Math.sign(distance);

    let translateX = distance * baseSpacing;
    if (absDistance > 1) {
      translateX += direction * Math.min(120, (absDistance - 1) * 38);
    }

    const rotateY = direction === 0 ? 0 : -direction * Math.min(44, 20 + absDistance * 7);
    const translateZ = absDistance === 0 ? 36 : Math.max(-160, 20 - absDistance * 56);
    const scale = absDistance === 0 ? 0.94 : Math.max(0.62, 0.9 - absDistance * 0.1);
    const opacity = absDistance > maxVisibleDistance ? 0 : Math.max(0.2, 1 - absDistance * 0.22);
    const blur = absDistance === 0 ? 0 : Math.min(2.8, absDistance * 0.75);
    const brightness = absDistance === 0 ? 1 : Math.max(0.6, 1 - absDistance * 0.1);
    const baseTransform = `translateX(calc(-50% + ${Math.round(translateX)}px)) translateZ(${Math.round(translateZ)}px) rotateY(${rotateY}deg) scale(${scale.toFixed(3)})`;
    const baseOpacity = opacity.toFixed(2);
    const baseFilter = `blur(${blur.toFixed(2)}px) brightness(${brightness.toFixed(2)})`;

    card.style.setProperty("--card-base-transform", baseTransform);
    card.style.setProperty("--card-base-opacity", baseOpacity);
    card.style.setProperty("--card-base-filter", baseFilter);
    card.style.transform = baseTransform;
    card.style.zIndex = `${600 - absDistance}`;
    card.style.opacity = baseOpacity;
    card.style.filter = baseFilter;
    card.style.pointerEvents = opacity < 0.08 ? "none" : "auto";
    card.classList.toggle("is-focused", absDistance === 0);
  }
}

function centerCardInViewport(cards, focusedIndex) {
  if (!Array.isArray(cards) || focusedIndex < 0 || focusedIndex >= cards.length) {
    return;
  }

  const card = cards[focusedIndex];
  if (!(card instanceof HTMLElement)) {
    return;
  }

  const grid = elements.locationGrid;
  if (!(grid instanceof HTMLElement) || grid.scrollWidth <= grid.clientWidth) {
    return;
  }

  const gridRect = grid.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const centerOffset = (gridRect.width - cardRect.width) / 2;
  const rawLeft = grid.scrollLeft + (cardRect.left - gridRect.left) - centerOffset;
  const maxLeft = Math.max(0, grid.scrollWidth - grid.clientWidth);
  const targetLeft = Math.min(maxLeft, Math.max(0, rawLeft));

  if (Math.abs(grid.scrollLeft - targetLeft) < 1) {
    return;
  }

  grid.scrollTo({ left: targetLeft, behavior: "smooth" });
}

async function playDetailTransition(location) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  const cards = Array.from(elements.locationGrid.querySelectorAll("button[data-location]"));
  const targetCard = cards.find(
    (card) => normalizeLocation(card.getAttribute("data-location") || "") === normalizeLocation(location)
  );

  if (!targetCard) {
    return;
  }

  elements.overviewPage.classList.add("is-transitioning");
  targetCard.classList.add("is-flipping");

  await wait(440);

  targetCard.classList.remove("is-flipping");
  elements.overviewPage.classList.remove("is-transitioning");
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function renderDetail(payload) {
  const daily = toObject(payload?.data?.daily);
  const benchmark = toObject(payload?.data?.benchmark);
  const history = toObject(payload?.data?.history);

  const location = payload?.location || state.selectedLocation || "-";
  const updatedAt = pickValue(daily, ["updated_at", "forecast_date", "date", "timestamp"]);
  const condition = pickValue(daily, ["condition", "summary", "description"]);
  const temp = pickValue(daily, ["temperature", "temp", "temp_c"]);
  const low = pickValue(daily, ["temp_min", "low", "temperature_min"]);
  const high = pickValue(daily, ["temp_max", "high", "temperature_max"]);
  const wind = pickValue(daily, ["wind_kph", "wind", "wind_speed"]);

  elements.selectedLocationName.textContent = location;
  elements.selectedUpdated.textContent = `Updated ${formatDateTime(updatedAt)}`;

  elements.dailyCondition.textContent = formatValue(condition);
  elements.dailyTemp.textContent = formatTemperature(temp);
  elements.dailyLowHigh.textContent = `${formatTemperature(low)} / ${formatTemperature(high)}`;
  elements.dailyWind.textContent = formatWind(wind);

  const score = pickValue(benchmark, ["score", "confidence", "latest_confidence"]);
  const source = pickValue(benchmark, ["source", "provider", "model"]);
  const delta = pickValue(benchmark, ["delta", "difference", "variance"]);

  elements.benchmarkScore.textContent = formatScore(score);
  elements.benchmarkSource.textContent = formatValue(source);
  elements.benchmarkDelta.textContent = `Delta ${formatDelta(delta)}`;

  renderSportRecommendations(daily?.suitability);
  renderBenchmarkSources(benchmark);

  const historyRows = extractHistoryRows(history).slice(0, 14);
  renderHistoryChart(historyRows);
  renderHistoryList(historyRows);

  elements.historyMeta.textContent = `${historyRows.length} records`;
}

function renderSportRecommendations(suitability) {
  elements.sportGrid.innerHTML = "";

  const source = toObject(suitability) || {};
  const keys = Object.keys(SPORT_META);

  for (const key of keys) {
    const meta = SPORT_META[key];
    const grade = `${source[key] || "Fair"}`;
    const normalized = grade.trim().toLowerCase();
    const score = GRADE_TO_SCORE[normalized] ?? 55;
    const color = score >= 75 ? "var(--success)" : score >= 45 ? "var(--warn)" : "var(--danger)";

    const card = document.createElement("article");
    card.className = "sport-card";

    card.innerHTML = `
      <div class="sport-top">
        <p class="sport-title">${meta.icon} ${meta.label}</p>
        <p class="sport-grade" style="color:${color}">${escapeHtml(grade)}</p>
      </div>
      <div class="sport-track">
        <div class="sport-fill" style="width:${score}%;background:linear-gradient(90deg, ${color}, #3e6fd4)"></div>
      </div>
      <p class="sport-score">Recommendation Score: ${score}/100</p>
    `;

    elements.sportGrid.appendChild(card);
  }
}

function renderBenchmarkSources(payload) {
  elements.benchmarkList.innerHTML = "";

  const sources = Array.isArray(payload?.sources) ? payload.sources : [];
  if (!sources.length) {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = "No benchmark source rows available.";
    elements.benchmarkList.appendChild(note);
    return;
  }

  const sorted = [...sources]
    .sort((left, right) => {
      const leftScore = toNumber(left.latest_confidence);
      const rightScore = toNumber(right.latest_confidence);
      return (rightScore ?? -Infinity) - (leftScore ?? -Infinity);
    })
    .slice(0, 7);

  for (const row of sorted) {
    const sourceLabel = row.source_label || row.source || "Unknown";
    const confidence = formatScore(row.latest_confidence);
    const weight = toNumber(row.ensemble_weight_pct);

    const item = document.createElement("article");
    item.className = "benchmark-row";

    const name = document.createElement("strong");
    name.textContent = sourceLabel;

    const confidenceText = document.createElement("span");
    confidenceText.textContent = `${confidence}%`;

    const weightText = document.createElement("span");
    weightText.textContent = Number.isFinite(weight) ? `${weight.toFixed(1)} wt` : "-";

    item.appendChild(name);
    item.appendChild(confidenceText);
    item.appendChild(weightText);

    elements.benchmarkList.appendChild(item);
  }
}

function renderHistoryChart(rows) {
  elements.historyChart.innerHTML = "";

  if (!rows.length) {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = "No historical rows available.";
    elements.historyChart.appendChild(note);
    return;
  }

  const chartRows = [...rows].reverse().slice(0, 12);
  const values = chartRows.map((row) => toNumber(row.temperature)).filter((value) => Number.isFinite(value));
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const range = max - min || 1;

  for (const row of chartRows) {
    const value = toNumber(row.temperature);
    const ratio = Number.isFinite(value) ? (value - min) / range : 0.1;
    const height = Math.max(10, Math.round(ratio * 100));

    const col = document.createElement("div");
    col.className = "chart-col";

    const valueNode = document.createElement("span");
    valueNode.className = "chart-value";
    valueNode.textContent = formatTemperature(value);

    const wrap = document.createElement("div");
    wrap.className = "chart-wrap";

    const bar = document.createElement("div");
    bar.className = "chart-bar";
    if (row.kind === "forecast") {
      bar.classList.add("is-forecast");
    }
    bar.style.height = `${height}px`;

    wrap.appendChild(bar);

    const label = document.createElement("span");
    label.className = "chart-label";
    label.textContent = shortDateLabel(row.date);

    col.appendChild(valueNode);
    col.appendChild(wrap);
    col.appendChild(label);

    elements.historyChart.appendChild(col);
  }
}

function renderHistoryList(rows) {
  elements.historyList.innerHTML = "";

  if (!rows.length) {
    const item = document.createElement("li");
    item.className = "history-item";
    item.textContent = "No history rows for this location.";
    elements.historyList.appendChild(item);
    return;
  }

  for (const row of rows) {
    const item = document.createElement("li");
    item.className = "history-item";

    const date = document.createElement("strong");
    date.textContent = `${formatDateLabel(row.date)}${row.kind === "forecast" ? " (F)" : ""}`;

    const temp = document.createElement("span");
    temp.textContent = formatTemperature(row.temperature);

    const note = document.createElement("span");
    note.textContent = shortText(row.condition, 56);

    item.appendChild(date);
    item.appendChild(temp);
    item.appendChild(note);
    elements.historyList.appendChild(item);
  }
}

function getLocationButton(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  return target.closest("button[data-location]");
}

function setLoading(isLoading) {
  elements.addLocationBtn.disabled = isLoading;
  elements.refreshAllBtn.disabled = isLoading;
}

function setStatus(message, type = "info") {
  if (!elements.statusText) {
    return;
  }

  elements.statusText.textContent = message;
  elements.statusText.classList.remove("is-error", "is-success");

  if (type === "error") {
    elements.statusText.classList.remove("status-hidden");
    elements.statusText.classList.add("is-error");
    return;
  }

  if (type === "success") {
    elements.statusText.classList.add("status-hidden");
    return;
  }

  elements.statusText.classList.add("status-hidden");
}

async function apiRequest(url, options = {}) {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });

    const text = await response.text();
    const data = parseJsonSafely(text);

    if (!response.ok) {
      const error =
        data?.error ||
        data?.message ||
        (typeof data === "string" ? data : null) ||
        `Request failed with status ${response.status}.`;

      return { ok: false, status: response.status, error, data };
    }

    return {
      ok: true,
      status: response.status,
      ...(toObject(data) || { data })
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error?.message || "Network error",
      data: null
    };
  }
}

function parseJsonSafely(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractHistoryRows(payload) {
  const source = toObject(payload);
  const candidates = [
    payload,
    source?.history,
    source?.records,
    source?.days,
    source?.data,
    source?.items,
    source?.result,
    source?.results,
    source?.data?.history,
    source?.data?.records
  ];

  let rows = [];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      rows = candidate;
      break;
    }
  }

  if (!rows.length && source) {
    const values = Object.values(source);
    const firstArray = values.find((value) => Array.isArray(value));
    if (firstArray) {
      rows = firstArray;
    }
  }

  return rows
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return {
          date: null,
          temperature: null,
          condition: entry,
          kind: "actual"
        };
      }

      return {
        date:
          entry.date || entry.day || entry.datetime || entry.timestamp || entry.time || entry.label || null,
        temperature:
          entry.temperature ||
          entry.temp ||
          entry.temp_c ||
          entry.avg_temp ||
          entry.max_temp ||
          entry.min_temp ||
          null,
        condition:
          entry.condition || entry.summary || entry.weather || entry.description || entry.note || null,
        kind: entry.kind || "actual"
      };
    })
    .filter((item) => item.date || item.temperature || item.condition)
    .sort((left, right) => `${right.date || ""}`.localeCompare(`${left.date || ""}`));
}

function pickValue(source, paths) {
  if (!source || typeof source !== "object") {
    return null;
  }

  for (const path of paths) {
    const value = getByPath(source, path);
    if (value !== undefined && value !== null && `${value}`.trim() !== "") {
      return value;
    }
  }

  return null;
}

function getByPath(source, pathExpression) {
  const segments = pathExpression.split(".");
  let current = source;

  for (const segment of segments) {
    if (!current || typeof current !== "object") {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function pickWeatherIcon(condition) {
  const text = `${condition || ""}`.toLowerCase();
  if (text.includes("thunder")) return "⛈️";
  if (text.includes("rain") || text.includes("shower")) return "🌧️";
  if (text.includes("snow") || text.includes("frost") || text.includes("ice")) return "❄️";
  if (text.includes("wind")) return "🌬️";
  if (text.includes("cloud") || text.includes("overcast")) return "☁️";
  if (text.includes("clear") || text.includes("sun")) return "☀️";
  return "🌤️";
}

function shortText(value, limit = 80) {
  const text = formatValue(value);
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function formatValue(value) {
  if (value === undefined || value === null || `${value}`.trim() === "") {
    return "N/A";
  }

  return `${value}`;
}

function formatTemperature(value) {
  const numeric = toNumber(value);
  if (numeric === null) {
    return formatValue(value);
  }

  return `${numeric.toFixed(1)}°C`;
}

function formatWind(value) {
  const numeric = toNumber(value);
  if (numeric === null) {
    return formatValue(value);
  }

  return `${numeric.toFixed(1)} km/h`;
}

function formatScore(value) {
  const numeric = toNumber(value);
  if (numeric === null) {
    return formatValue(value);
  }

  return numeric.toFixed(1);
}

function formatDelta(value) {
  const numeric = toNumber(value);
  if (numeric === null) {
    return formatValue(value);
  }

  const prefix = numeric > 0 ? "+" : "";
  return `${prefix}${numeric.toFixed(1)}`;
}

function formatDateLabel(value) {
  if (!value) {
    return "Unknown day";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return `${value}`;
  }

  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    weekday: "short"
  });
}

function shortDateLabel(value) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return `${value}`.slice(5);
  }

  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}

function formatDateTime(value) {
  if (!value) {
    return "N/A";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return `${value}`;
  }

  return parsed.toLocaleString();
}

function formatTimeOnly(value) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return `${value}`;
  }

  return parsed.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit"
  });
}

function normalizeLocation(value) {
  return `${value || ""}`.trim().replace(/\s+/g, " ").toLowerCase();
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const cleaned = value.replace(/[^\d.-]/g, "").trim();
    if (!cleaned) {
      return null;
    }

    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function toObject(value) {
  return value && typeof value === "object" ? value : null;
}

function escapeHtml(value) {
  return `${value || ""}`
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
