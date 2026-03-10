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

const APP_BASE_URL = new URL("./", window.location.href);
const LOCAL_WATCHLIST_STORAGE_KEY = "yuen_yuen_weather_watchlist";
const STATIC_SYNC_UNAVAILABLE = "GitHub Pages mode: AIBot watchlist sync is unavailable.";

let staticBundleCache = null;

const state = {
  locations: [],
  cards: new Map(),
  focusedLocation: "",
  selectedLocation: "",
  isMobileLayout: false,
  isCompactPortraitLayout: false,
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
  return window.matchMedia("(pointer: coarse)").matches && window.matchMedia("(max-width: 1024px)").matches;
}

function isCompactPortraitLayout() {
  return (
    isMobileViewport() &&
    window.matchMedia("(max-width: 760px)").matches &&
    window.matchMedia("(orientation: portrait)").matches
  );
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

    if (isCompactPortraitLayout()) {
      await openDetailPage(location);
      return;
    }

    if (isMobileViewport()) {
      const alreadyFocused = normalizeLocation(state.focusedLocation) === normalizeLocation(location);
      if (alreadyFocused) {
        await openDetailPage(location);
        return;
      }

      updateFocusedCard(location);
      setStatus(`Tap ${location} again to open detail view.`);
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
    const compactPortraitNow = isCompactPortraitLayout();
    if (mobileNow !== state.isMobileLayout || compactPortraitNow !== state.isCompactPortraitLayout) {
      state.isMobileLayout = mobileNow;
      state.isCompactPortraitLayout = compactPortraitNow;
      renderLocationCards();
      return;
    }

    applyCoverflowTransforms();
  });
}

async function initialize() {
  state.isMobileLayout = isMobileViewport();
  state.isCompactPortraitLayout = isCompactPortraitLayout();
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
    const response = await fetch(resolveRequestUrl("data/weather_latest_report.json"));
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
  const hint = isCompactPortraitLayout()
    ? "Showing predefined locations. Tap a card for details."
    : isMobileViewport()
      ? "Showing predefined locations. Tap a focused card again for details."
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

  const actionHint = isCompactPortraitLayout()
    ? "Tap for detail view"
    : isMobileViewport()
      ? "Tap again for detail view"
      : "Double-click for detail view";

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

  if (isCompactPortraitLayout()) {
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
  const requestUrl = resolveRequestUrl(url);

  try {
    const response = await fetch(requestUrl, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });

    const text = await response.text();
    const data = parseJsonSafely(text);

    if (!response.ok) {
      const fallback = await maybeStaticApiFallback(url, options, response.status);
      if (fallback) {
        return fallback;
      }

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
    const fallback = await maybeStaticApiFallback(url, options, 0);
    if (fallback) {
      return fallback;
    }

    return {
      ok: false,
      status: 0,
      error: error?.message || "Network error",
      data: null
    };
  }
}

function resolveRequestUrl(url) {
  const raw = `${url || ""}`.trim();
  if (!raw) {
    return APP_BASE_URL.toString();
  }

  if (/^[a-z]+:\/\//i.test(raw)) {
    return raw;
  }

  const normalized = raw.startsWith("/") ? raw.slice(1) : raw;
  return new URL(normalized, APP_BASE_URL).toString();
}

function isApiPath(url) {
  const raw = `${url || ""}`.trim();
  if (!raw) {
    return false;
  }

  if (/^[a-z]+:\/\//i.test(raw)) {
    try {
      return new URL(raw).pathname.includes("/api/");
    } catch {
      return false;
    }
  }

  const normalized = raw.replace(/^(\.\/)+/, "").replace(/^\/+/, "");
  return normalized.startsWith("api/");
}

function toApiPath(url) {
  const absolute = new URL(resolveRequestUrl(url));
  const pathname = absolute.pathname || "/";
  const apiIndex = pathname.indexOf("/api/");
  return apiIndex >= 0 ? pathname.slice(apiIndex) : pathname;
}

function isStaticSiteHost() {
  const host = `${window.location.hostname || ""}`.toLowerCase();
  return host.endsWith("github.io");
}

async function maybeStaticApiFallback(url, options, statusCode) {
  if (!isApiPath(url)) {
    return null;
  }

  if (!isStaticSiteHost() && statusCode !== 404 && statusCode !== 0) {
    return null;
  }

  const fallback = await staticApiRequest(url, options);
  if (fallback?.ok) {
    return fallback;
  }

  if (statusCode === 404 || statusCode === 0) {
    return fallback;
  }

  return null;
}

async function staticApiRequest(url, options = {}) {
  const method = `${options.method || "GET"}`.toUpperCase();
  const absolute = new URL(resolveRequestUrl(url));
  const apiPath = toApiPath(url);

  if (apiPath === "/api/weather/watchlist" && method === "GET") {
    const bundle = await loadStaticBundle();
    return {
      ok: true,
      status: 200,
      source: "public/data",
      data: buildWatchlistPayloadStatic(bundle)
    };
  }

  if (apiPath === "/api/weather/watchlist" && method === "POST") {
    const body = readApiRequestBody(options.body);
    const location = [body?.location, body?.name, absolute.searchParams.get("location")]
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .find(Boolean);

    if (!location) {
      return {
        ok: false,
        status: 400,
        error: "Body must include 'location' or 'name'.",
        data: null
      };
    }

    const bundle = await loadStaticBundle();
    const hasLocation = hasLocationInListStatic(bundle.watchlist.locations, location);

    if (!hasLocation) {
      bundle.watchlist.locations.push(location);
      bundle.watchlist.updated_at_utc = new Date().toISOString();
      saveLocalWatchlist(bundle.watchlist);
      staticBundleCache = null;
    }

    const refreshed = await loadStaticBundle(true);

    return {
      ok: true,
      status: 200,
      source: "public/data",
      location,
      added: !hasLocation,
      message: hasLocation ? "Location already exists in local watchlist." : "Location added to local watchlist.",
      watchlist: buildWatchlistPayloadStatic(refreshed),
      sync: {
        enabled: false,
        ok: false,
        status: 0,
        error: STATIC_SYNC_UNAVAILABLE
      }
    };
  }

  if (
    (apiPath === "/api/weather" || apiPath === "/api/weather/daily" || apiPath === "/api/weather/benchmark" || apiPath === "/api/weather/history") &&
    method === "GET"
  ) {
    const location = (absolute.searchParams.get("location") || "").trim();
    if (!location) {
      return {
        ok: false,
        status: 400,
        error: "Query parameter 'location' is required.",
        data: null
      };
    }

    const bundle = await loadStaticBundle();
    const knownLocations = collectKnownLocationsStatic(bundle.report, bundle.history, bundle.watchlist.locations);
    const resolvedLocation = resolveLocationFromStatic(location, knownLocations);

    const daily = buildDailyDataStatic(bundle.report, bundle.history, resolvedLocation);
    const benchmark = buildBenchmarkDataStatic(bundle.benchmark, resolvedLocation);
    const history = buildHistoryDataStatic(bundle.history, resolvedLocation);
    const watchlist = buildWatchlistPayloadStatic(bundle);

    if (apiPath === "/api/weather/daily") {
      return {
        ok: true,
        status: 200,
        source: "public/data",
        location: resolvedLocation,
        data: daily
      };
    }

    if (apiPath === "/api/weather/benchmark") {
      return {
        ok: true,
        status: 200,
        source: "public/data",
        location: resolvedLocation,
        data: benchmark
      };
    }

    if (apiPath === "/api/weather/history") {
      return {
        ok: true,
        status: 200,
        source: "public/data",
        location: resolvedLocation,
        data: history
      };
    }

    return {
      ok: true,
      status: 200,
      source: "public/data",
      location: resolvedLocation,
      data: {
        daily,
        benchmark,
        history,
        watchlist
      }
    };
  }

  return null;
}

function readApiRequestBody(body) {
  if (!body) {
    return {};
  }

  if (typeof body === "string") {
    const parsed = parseJsonSafely(body);
    return toObject(parsed) || {};
  }

  return toObject(body) || {};
}

async function loadStaticBundle(force = false) {
  if (staticBundleCache && !force) {
    return staticBundleCache;
  }

  const [report, benchmark, history, watchlistFile] = await Promise.all([
    fetchDataJson("data/weather_latest_report.json", {}),
    fetchDataJson("data/weather_benchmarks_latest.json", {}),
    fetchDataJson("data/weather_history_recent.json", {}),
    fetchDataJson("data/weather_watchlist.json", { locations: [], updated_at_utc: null })
  ]);

  const fileWatchlist = normalizeWatchlistPayload(watchlistFile);
  const localWatchlist = loadLocalWatchlist();
  const mergedWatchlist = {
    updated_at_utc: localWatchlist.updated_at_utc || fileWatchlist.updated_at_utc || null,
    locations: mergeLocationsStatic(fileWatchlist.locations, localWatchlist.locations)
  };

  staticBundleCache = {
    report: toObject(report) || {},
    benchmark: toObject(benchmark) || {},
    history: toObject(history) || {},
    watchlist: mergedWatchlist
  };

  return staticBundleCache;
}

async function fetchDataJson(relativePath, fallbackValue) {
  try {
    const response = await fetch(resolveRequestUrl(relativePath), { cache: "no-store" });
    if (!response.ok) {
      return fallbackValue;
    }

    return await response.json();
  } catch {
    return fallbackValue;
  }
}

function loadLocalWatchlist() {
  try {
    const raw = window.localStorage.getItem(LOCAL_WATCHLIST_STORAGE_KEY);
    if (!raw) {
      return { locations: [], updated_at_utc: null };
    }

    return normalizeWatchlistPayload(parseJsonSafely(raw));
  } catch {
    return { locations: [], updated_at_utc: null };
  }
}

function saveLocalWatchlist(payload) {
  const normalized = normalizeWatchlistPayload(payload);
  try {
    window.localStorage.setItem(LOCAL_WATCHLIST_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Storage can fail in restrictive browser contexts; ignore silently.
  }
}

function normalizeWatchlistPayload(payload) {
  if (Array.isArray(payload)) {
    return {
      updated_at_utc: null,
      locations: payload.map((item) => `${item || ""}`.trim()).filter(Boolean)
    };
  }

  const source = toObject(payload) || {};
  const list = Array.isArray(source.locations) ? source.locations : [];

  return {
    updated_at_utc: typeof source.updated_at_utc === "string" ? source.updated_at_utc : null,
    locations: list.map((item) => `${item || ""}`.trim()).filter(Boolean)
  };
}

function buildDailyDataStatic(report, history, location) {
  const zones = Array.isArray(report?.zones) ? report.zones : [];
  const zone = zones.find((item) => normalizeLocation(item?.name) === normalizeLocation(location)) || null;

  const forecasts = Array.isArray(history?.forecasts) ? history.forecasts : [];
  const locationForecasts = forecasts
    .filter((item) => normalizeLocation(item?.location) === normalizeLocation(location))
    .sort((a, b) => `${b.run_date || ""}${b.target_date || ""}`.localeCompare(`${a.run_date || ""}${a.target_date || ""}`));

  const latestForecast = locationForecasts[0] || null;
  const tempMin = toNumber(zone?.ensemble?.temp_min) ?? toNumber(latestForecast?.temp_min);
  const tempMax = toNumber(zone?.ensemble?.temp_max) ?? toNumber(latestForecast?.temp_max);

  return {
    location,
    condition: zone?.briefing || `Forecast snapshot for ${location}.`,
    summary: zone?.briefing || null,
    temperature: averageValues(tempMin, tempMax),
    temp_min: tempMin,
    temp_max: tempMax,
    humidity: null,
    wind_kph: toNumber(zone?.ensemble?.wind_max) ?? toNumber(latestForecast?.wind_max),
    updated_at: report?.generated_at_utc || history?.generated_at_utc || null,
    forecast_date: report?.forecast_date || latestForecast?.target_date || null,
    suitability: zone?.suitability || null,
    source_forecasts: zone?.source_forecasts || null,
    reference: latestForecast
  };
}

function buildBenchmarkDataStatic(benchmark, location) {
  const sources = Array.isArray(benchmark?.sources) ? benchmark.sources : [];
  if (!sources.length) {
    return {
      location,
      score: null,
      delta: null,
      source: null,
      generated_at_utc: benchmark?.generated_at_utc || null,
      run_date: benchmark?.run_date || null,
      lookback_days: benchmark?.lookback_days || null,
      sources: []
    };
  }

  const withConfidence = sources.filter((item) => Number.isFinite(toNumber(item?.latest_confidence)));
  const topSource = withConfidence.length
    ? withConfidence.reduce((best, row) => (toNumber(row.latest_confidence) > toNumber(best.latest_confidence) ? row : best))
    : sources[0];

  const averageConfidence = withConfidence.length
    ? withConfidence.reduce((sum, row) => sum + toNumber(row.latest_confidence), 0) / withConfidence.length
    : null;

  const topConfidence = toNumber(topSource?.latest_confidence);

  return {
    location,
    score: topConfidence,
    delta: topConfidence !== null && averageConfidence !== null ? topConfidence - averageConfidence : null,
    source: topSource?.source_label || topSource?.source || null,
    generated_at_utc: benchmark?.generated_at_utc || null,
    run_date: benchmark?.run_date || null,
    lookback_days: benchmark?.lookback_days || null,
    sources
  };
}

function buildHistoryDataStatic(history, location) {
  const normalizedLocation = normalizeLocation(location);
  const actuals = Array.isArray(history?.actuals) ? history.actuals : [];
  const forecasts = Array.isArray(history?.forecasts) ? history.forecasts : [];

  const actualRows = actuals
    .filter((item) => normalizeLocation(item?.location) === normalizedLocation)
    .sort((a, b) => `${b.date || ""}`.localeCompare(`${a.date || ""}`))
    .map((item) => ({
      kind: "actual",
      date: item.date || null,
      temperature: averageValues(toNumber(item.temp_max), toNumber(item.temp_min)),
      temp_max: toNumber(item.temp_max),
      temp_min: toNumber(item.temp_min),
      wind_max: toNumber(item.wind_max),
      condition: buildActualConditionStatic(item)
    }));

  const forecastRows = forecasts
    .filter((item) => normalizeLocation(item?.location) === normalizedLocation)
    .sort((a, b) => `${b.target_date || ""}${b.run_date || ""}`.localeCompare(`${a.target_date || ""}${a.run_date || ""}`))
    .slice(0, 10)
    .map((item) => ({
      kind: "forecast",
      date: item.target_date || null,
      temperature: averageValues(toNumber(item.temp_max), toNumber(item.temp_min)),
      temp_max: toNumber(item.temp_max),
      temp_min: toNumber(item.temp_min),
      wind_max: toNumber(item.wind_max),
      condition: `Forecast (${item.source_label || item.source || "source"})`,
      run_date: item.run_date || null,
      source: item.source || null,
      source_label: item.source_label || null
    }));

  const combined = [...actualRows, ...forecastRows]
    .sort((a, b) => `${b.date || ""}`.localeCompare(`${a.date || ""}`))
    .slice(0, 30);

  return {
    location,
    generated_at_utc: history?.generated_at_utc || null,
    run_date: history?.run_date || null,
    history: combined,
    counts: {
      actuals: actualRows.length,
      forecasts: forecastRows.length
    }
  };
}

function buildWatchlistPayloadStatic(bundle) {
  const dynamicLocations = collectKnownLocationsStatic(bundle.report, bundle.history, []);
  const customLocations = Array.isArray(bundle.watchlist?.locations) ? bundle.watchlist.locations : [];
  const merged = mergeLocationsStatic(dynamicLocations, customLocations);

  return {
    generated_at_utc: bundle.report?.generated_at_utc || bundle.history?.generated_at_utc || null,
    updated_at_utc: bundle.watchlist?.updated_at_utc || null,
    locations: merged,
    counts: {
      total: merged.length,
      dynamic: dynamicLocations.length,
      custom: customLocations.length
    }
  };
}

function collectKnownLocationsStatic(report, history, extraLocations = []) {
  const list = [];

  const zones = Array.isArray(report?.zones) ? report.zones : [];
  for (const zone of zones) {
    if (typeof zone?.name === "string" && zone.name.trim()) {
      list.push(zone.name.trim());
    }
  }

  const actuals = Array.isArray(history?.actuals) ? history.actuals : [];
  for (const row of actuals) {
    if (typeof row?.location === "string" && row.location.trim()) {
      list.push(row.location.trim());
    }
  }

  const forecasts = Array.isArray(history?.forecasts) ? history.forecasts : [];
  for (const row of forecasts) {
    if (typeof row?.location === "string" && row.location.trim()) {
      list.push(row.location.trim());
    }
  }

  for (const extra of extraLocations) {
    if (typeof extra === "string" && extra.trim()) {
      list.push(extra.trim());
    }
  }

  return mergeLocationsStatic(list);
}

function mergeLocationsStatic(...groups) {
  const merged = [];
  const seen = new Set();

  for (const group of groups) {
    if (!Array.isArray(group)) {
      continue;
    }

    for (const raw of group) {
      const value = `${raw || ""}`.trim();
      if (!value) {
        continue;
      }

      const key = normalizeLocation(value);
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      merged.push(value);
    }
  }

  return merged.sort((a, b) => a.localeCompare(b));
}

function resolveLocationFromStatic(location, knownLocations) {
  const normalized = normalizeLocation(location);
  if (!normalized) {
    return "";
  }

  const exact = knownLocations.find((item) => normalizeLocation(item) === normalized);
  return exact || location.trim();
}

function hasLocationInListStatic(list, location) {
  const normalized = normalizeLocation(location);
  return Array.isArray(list) && list.some((item) => normalizeLocation(item) === normalized);
}

function buildActualConditionStatic(item) {
  const pieces = [];
  const min = toNumber(item?.temp_min);
  const max = toNumber(item?.temp_max);
  const wind = toNumber(item?.wind_max);

  if (min !== null && max !== null) {
    pieces.push(`Min ${min.toFixed(1)} C / Max ${max.toFixed(1)} C`);
  }

  if (wind !== null) {
    pieces.push(`Wind ${wind.toFixed(1)} km/h`);
  }

  return pieces.join(" | ") || "Observed weather";
}

function averageValues(a, b) {
  const hasA = Number.isFinite(a);
  const hasB = Number.isFinite(b);

  if (hasA && hasB) {
    return (a + b) / 2;
  }

  if (hasA) {
    return a;
  }

  if (hasB) {
    return b;
  }

  return null;
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
