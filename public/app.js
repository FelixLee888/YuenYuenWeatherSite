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

const LOCATION_COUNTRY_BY_NAME = {
  glencoe: "United Kingdom",
  "ben nevis": "United Kingdom",
  glenshee: "United Kingdom",
  cairngorms: "United Kingdom",
  paisley: "United Kingdom",
  "passo del tonale": "Italy"
};

const MWIS_REGION_CODES_BY_LOCATION = {
  glencoe: ["wh", "nw"],
  "ben nevis": ["wh", "nw"],
  glenshee: ["eh", "sh"],
  cairngorms: ["eh"]
};

const HISTORY_SOURCE_COLORS = ["#1f78ff", "#34a853", "#f29900", "#7c4dff", "#e84d8a", "#00a0a0", "#5e6f82"];

const HISTORY_METRIC_CONFIG = {
  temperature: { label: "Temperature", unit: "C" },
  wind: { label: "Wind", unit: "km/h" }
};

const DETAIL_WEATHER_ICON_SET2 = {
  thunder: "./asset/weather-icons-set2/svg/weather_icon_set2_08.svg",
  storm: "./asset/weather-icons-set2/svg/weather_icon_set2_07.svg",
  rain: "./asset/weather-icons-set2/svg/weather_icon_set2_21.svg",
  rainNight: "./asset/weather-icons-set2/svg/weather_icon_set2_20.svg",
  heavyRain: "./asset/weather-icons-set2/svg/weather_icon_set2_01.svg",
  cold: "./asset/weather-icons-set2/svg/weather_icon_set2_13.svg",
  snow: "./asset/weather-icons-set2/svg/weather_icon_set2_13.svg",
  wind: "./asset/weather-icons-set2/svg/weather_icon_set2_15.svg",
  cloud: "./asset/weather-icons-set2/svg/weather_icon_set2_16.svg",
  clearDay: "./asset/weather-icons-set2/svg/weather_icon_set2_22.svg",
  clearNight: "./asset/weather-icons-set2/svg/weather_icon_set2_18.svg",
  fallback: "./asset/weather-icons-set2/svg/weather_icon_set2_16.svg"
};

const CARD_WEATHER_ICON_SET = {
  thunder: "./asset/weather-icons/svg/weather_icon_13.svg",
  storm: "./asset/weather-icons/svg/weather_icon_18.svg",
  rain: "./asset/weather-icons/svg/weather_icon_14.svg",
  heavyRain: "./asset/weather-icons/svg/weather_icon_15.svg",
  cold: "./asset/weather-icons/svg/weather_icon_20.svg",
  wind: "./asset/weather-icons/svg/weather_icon_17.svg",
  cloud: "./asset/weather-icons/svg/weather_icon_12.svg",
  clearDay: "./asset/weather-icons/svg/weather_icon_04.svg",
  clearNight: "./asset/weather-icons/svg/weather_icon_03.svg",
  fallback: "./asset/weather-icons/svg/weather_icon_23.svg"
};

const APP_BASE_URL = new URL("./", window.location.href);
const LOCAL_WATCHLIST_STORAGE_KEY = "yuen_yuen_weather_watchlist";
const STATIC_SYNC_UNAVAILABLE = "GitHub Pages mode: AIBot watchlist sync is unavailable.";
const SWIPE_MIN_DISTANCE_PX = 44;
const SWIPE_DIRECTION_RATIO = 1.2;
const SWIPE_CLICK_SUPPRESS_MS = 420;

let staticBundleCache = null;

const state = {
  locations: [],
  cards: new Map(),
  focusedLocation: "",
  selectedLocation: "",
  historyMetric: "temperature",
  historyTrendModel: null,
  isMobileLayout: false,
  isTransitioningDetail: false,
  suppressDeckClickUntil: 0,
  swipe: {
    tracking: false,
    startX: 0,
    startY: 0,
    handled: false
  },
  detailSwipe: {
    tracking: false,
    startX: 0,
    startY: 0,
    handled: false,
    blocked: false
  }
};

const elements = {
  homeBtn: document.getElementById("homeBtn"),
  statusText: document.getElementById("statusText"),
  overviewPage: document.getElementById("overviewPage"),
  detailPage: document.getElementById("detailPage"),
  detailViewport: document.getElementById("detailViewport"),
  detailContent: document.getElementById("detailContent"),
  locationGrid: document.getElementById("locationGrid"),
  detailBackBtn: document.getElementById("detailBackBtn"),
  selectedLocationName: document.getElementById("selectedLocationName"),
  selectedUpdated: document.getElementById("selectedUpdated"),
  detailConditionIcon: document.getElementById("detailConditionIcon"),
  dailyCondition: document.getElementById("dailyCondition"),
  dailyTemp: document.getElementById("dailyTemp"),
  dailyLowHigh: document.getElementById("dailyLowHigh"),
  dailyWind: document.getElementById("dailyWind"),
  dailyWindDirection: document.getElementById("dailyWindDirection"),
  dailyRainfall: document.getElementById("dailyRainfall"),
  benchmarkScore: document.getElementById("benchmarkScore"),
  benchmarkSource: document.getElementById("benchmarkSource"),
  benchmarkDelta: document.getElementById("benchmarkDelta"),
  benchmarkList: document.getElementById("benchmarkList"),
  mwisMeta: document.getElementById("mwisMeta"),
  mwisLinks: document.getElementById("mwisLinks"),
  next7Meta: document.getElementById("next7Meta"),
  next7Grid: document.getElementById("next7Grid"),
  sportGrid: document.getElementById("sportGrid"),
  historyMetricTempBtn: document.getElementById("historyMetricTempBtn"),
  historyMetricWindBtn: document.getElementById("historyMetricWindBtn"),
  historyMeta: document.getElementById("historyMeta"),
  historyChart: document.getElementById("historyChart"),
  historyLegend: document.getElementById("historyLegend")
};

bindEvents();
initialize();

function isMobileViewport() {
  return window.matchMedia("(pointer: coarse)").matches && window.matchMedia("(max-width: 1024px)").matches;
}

function setHeaderDetailState(isDetail) {
  document.body.classList.toggle("is-detail-view", Boolean(isDetail));
}


function bindEvents() {
  elements.homeBtn.addEventListener("click", () => {
    showOverviewPage();
  });

  elements.detailBackBtn?.addEventListener("click", () => {
    showOverviewPage();
  });

  elements.locationGrid.addEventListener("click", async (event) => {
    if (Date.now() < state.suppressDeckClickUntil) {
      event.preventDefault();
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

    if (isMobileViewport()) {
      updateFocusedCard(location);
      await openDetailPage(location);
      return;
    }

    updateFocusedCard(location);
    setStatus(`Focused ${location}. Use left/right keys to browse, or double-click to open detail view.`);
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

  elements.locationGrid.addEventListener("touchstart", handleDeckTouchStart, { passive: true });
  elements.locationGrid.addEventListener("touchmove", handleDeckTouchMove, { passive: true });
  elements.locationGrid.addEventListener("touchend", handleDeckTouchEnd, { passive: true });
  elements.locationGrid.addEventListener("touchcancel", handleDeckTouchEnd, { passive: true });
  elements.detailPage.addEventListener("touchstart", handleDetailTouchStart, { passive: true });
  elements.detailPage.addEventListener("touchmove", handleDetailTouchMove, { passive: true });
  elements.detailPage.addEventListener("touchend", handleDetailTouchEnd, { passive: true });
  elements.detailPage.addEventListener("touchcancel", handleDetailTouchEnd, { passive: true });
  window.addEventListener("keydown", handleGlobalKeydown);

  elements.historyMetricTempBtn?.addEventListener("click", () => {
    setHistoryMetric("temperature");
  });

  elements.historyMetricWindBtn?.addEventListener("click", () => {
    setHistoryMetric("wind");
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
  setHeaderDetailState(false);
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
  setStatus("Loading locations...");

  const locationResult = await loadPredefinedLocations();
  if (!locationResult.ok) {
    setLoading(false);
    setStatus(locationResult.error || "Unable to load locations.", "error");
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
    const watchlistResult = await apiRequest("/api/weather/watchlist");
    if (!watchlistResult.ok) {
      return {
        ok: false,
        locations: [],
        error: watchlistResult.error || "Unable to load weather watchlist."
      };
    }

    const watchlistData = toObject(watchlistResult.data);
    const locations = Array.isArray(watchlistData?.locations)
      ? watchlistData.locations.map((item) => `${item || ""}`.trim()).filter(Boolean)
      : [];

    if (!locations.length) {
      return {
        ok: false,
        locations: [],
        error: "No locations found in weather watchlist payload."
      };
    }

    return {
      ok: true,
      locations: [...new Set(locations)],
      source: watchlistResult.source || "api"
    };
  } catch (error) {
    return {
      ok: false,
      locations: [],
      error: error?.message || "Failed to read weather watchlist."
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

async function deleteLocation(location) {
  setLoading(true);
  setStatus(`Removing ${location}...`);

  const result = await apiRequest("/api/weather/watchlist", {
    method: "DELETE",
    body: JSON.stringify({ location })
  });

  if (!result.ok) {
    setLoading(false);
    setStatus(result.error || `Unable to remove ${location}.`, "error");
    return;
  }

  await loadOverview();
  setStatus(result.removed ? `${location} removed.` : `${location} is not in watch list.`, "success");
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
    setHeaderDetailState(true);
    if (options.animate !== false) {
      await playDetailTransition(location);
    }
    renderDetail(payload);
    showDetailPage();
    window.history.replaceState(window.history.state, "", `?location=${encodeURIComponent(location)}`);
    setStatus(`Opened detail page for ${location}.`, "success");
  } catch (error) {
    setHeaderDetailState(false);
    setStatus(error?.message || `Unable to open detail page for ${location}.`, "error");
  } finally {
    setLoading(false);
    state.isTransitioningDetail = false;
  }
}

async function switchDetailLocation(directionStep, options = {}) {
  if (state.isTransitioningDetail || !Array.isArray(state.locations) || !state.locations.length) {
    return false;
  }

  const currentIndex = Math.max(
    0,
    state.locations.findIndex((entry) => normalizeLocation(entry) === normalizeLocation(state.selectedLocation || state.focusedLocation))
  );
  const nextIndex = Math.min(state.locations.length - 1, Math.max(0, currentIndex + directionStep));

  if (nextIndex === currentIndex) {
    return false;
  }

  const nextLocation = state.locations[nextIndex];
  const swipeDirection = directionStep > 0 ? "next" : "prev";

  state.isTransitioningDetail = true;
  setLoading(true);

  try {
    let payload = state.cards.get(nextLocation);
    if (!payload) {
      const result = await apiRequest(`/api/weather?location=${encodeURIComponent(nextLocation)}`);
      if (!result.ok) {
        setStatus(result.error || `Unable to load detail for ${nextLocation}.`, "error");
        return false;
      }
      payload = result;
      state.cards.set(nextLocation, result);
    }

    updateFocusedCard(nextLocation);

    if (options.animate !== false) {
      await playDetailCitySwitchTransition(swipeDirection, () => {
        state.selectedLocation = nextLocation;
        renderDetail(payload);
        window.history.replaceState(window.history.state, "", `?location=${encodeURIComponent(nextLocation)}`);
      });
    } else {
      state.selectedLocation = nextLocation;
      renderDetail(payload);
      window.history.replaceState(window.history.state, "", `?location=${encodeURIComponent(nextLocation)}`);
    }

    setStatus(`Showing ${nextLocation} (${nextIndex + 1}/${state.locations.length}).`, "success");
    return true;
  } catch (error) {
    setStatus(error?.message || `Unable to switch to ${nextLocation}.`, "error");
    return false;
  } finally {
    setLoading(false);
    state.isTransitioningDetail = false;
  }
}

function showOverviewPage() {
  setHeaderDetailState(false);
  elements.overviewPage.classList.remove("is-hidden");
  elements.detailPage.classList.add("is-hidden");
  window.history.replaceState(window.history.state, "", window.location.pathname);
  const hint = isMobileViewport()
    ? "Showing predefined locations. Swipe to browse, tap a card for details."
    : "Showing predefined locations. Use left/right keys to browse, or double-click a card for details.";
  setStatus(hint);
}

function showDetailPage() {
  setHeaderDetailState(true);
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

  const actionHint = isMobileViewport()
    ? "Swipe or tap for detail"
    : "Arrows browse, double-click opens";

  for (let index = 0; index < state.locations.length; index += 1) {
    const location = state.locations[index];
    const payload = state.cards.get(location);

    const daily = toObject(payload?.data?.daily);
    const benchmark = toObject(payload?.data?.benchmark);
    const history = toObject(payload?.data?.history);

    const condition = pickValue(daily, ["condition", "summary", "description"]);
    const temp = pickValue(daily, ["temperature", "temp", "temp_c"]);
    const low = pickValue(daily, ["temp_min", "low", "temperature_min"]);
    const high = pickValue(daily, ["temp_max", "high", "temperature_max"]);
    const wind = pickValue(daily, ["wind_kph", "wind", "wind_speed"]);
    const windDirection = pickValue(daily, ["wind_direction", "wind_dir", "wind_bearing", "wind_deg"]);
    const rainChance = pickValue(daily, ["rainfall_chance", "rain_chance", "precip_probability", "precip_chance"]);
    const score = pickValue(benchmark, ["score", "confidence", "latest_confidence"]);
    const weatherDate = resolveWeatherDate(daily);
    const cardIconInput = resolveDetailForecastIconInput(daily, history, location, weatherDate, {
      condition,
      rainfall: rainChance,
      wind,
      temp,
      low,
      high
    });
    const cardIcon = pickForecastWeatherIcon(cardIconInput, CARD_WEATHER_ICON_SET);

    const tempValue = toNumber(temp);
    const tone = CARD_TONES[index % CARD_TONES.length];
    const displayTemp = tempValue === null ? "--" : tempValue.toFixed(0);
    const displayCondition = cleanConditionForCard(location, condition);
    const country = resolveCountryForLocation(location);

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
          <p class="location-label">${escapeHtml(country)}</p>
        </div>
        <div class="location-head-actions">
          <p class="location-time">${escapeHtml(formatWeatherDateShort(weatherDate))}</p>
        </div>
      </div>
      <div class="location-main">
        <img class="weather-icon weather-icon-image" src="${escapeHtml(cardIcon.src)}" alt="" aria-hidden="true" />
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
          <span>Direction</span>
          <strong>${escapeHtml(formatWindDirection(windDirection))}</strong>
        </article>
        <article class="mini-stat">
          <span>Rain</span>
          <strong>${escapeHtml(formatRainChance(rainChance))}</strong>
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

async function playDetailCitySwitchTransition(direction, renderNext) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    renderNext();
    return;
  }

  const viewport = elements.detailViewport;
  const liveContent = elements.detailContent;
  if (!viewport || !liveContent) {
    renderNext();
    return;
  }

  const directionClass = direction === "prev" ? "is-swipe-prev" : "is-swipe-next";
  const outgoing = liveContent.cloneNode(true);
  stripTransientIds(outgoing);
  outgoing.setAttribute("aria-hidden", "true");
  outgoing.classList.add("detail-swipe-clone", "is-outgoing", directionClass);

  viewport.classList.remove("is-swiping", "is-swipe-next", "is-swipe-prev");
  viewport.style.minHeight = `${liveContent.offsetHeight}px`;
  viewport.appendChild(outgoing);

  liveContent.classList.remove("is-incoming", "is-animating", "is-swipe-next", "is-swipe-prev");
  liveContent.classList.add("is-incoming", directionClass);
  renderNext();

  void viewport.offsetWidth;
  viewport.classList.add("is-swiping", directionClass);
  liveContent.classList.add("is-animating");
  outgoing.classList.add("is-animating");

  await wait(600);

  outgoing.remove();
  liveContent.classList.remove("is-incoming", "is-animating", "is-swipe-next", "is-swipe-prev");
  viewport.classList.remove("is-swiping", "is-swipe-next", "is-swipe-prev");
  viewport.style.minHeight = "";
}

function stripTransientIds(root) {
  if (!(root instanceof Element)) {
    return;
  }

  root.removeAttribute("id");
  root.querySelectorAll("[id]").forEach((node) => {
    node.removeAttribute("id");
  });
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
  const weatherDate = resolveWeatherDate(daily);
  const condition = pickValue(daily, ["condition", "summary", "description"]);
  const temp = pickValue(daily, ["temperature", "temp", "temp_c"]);
  const low = pickValue(daily, ["temp_min", "low", "temperature_min"]);
  const high = pickValue(daily, ["temp_max", "high", "temperature_max"]);
  const wind = pickValue(daily, ["wind_kph", "wind", "wind_speed"]);
  const windDirection = pickValue(daily, ["wind_direction", "wind_dir", "wind_bearing", "wind_deg"]);
  const rainfall = pickValue(daily, ["rainfall_chance", "rain_chance", "precip_probability", "precip_chance"]);
  const detailIconInput = resolveDetailForecastIconInput(daily, history, location, weatherDate, {
    condition,
    rainfall,
    wind,
    temp,
    low,
    high
  });

  elements.selectedLocationName.textContent = location;
  elements.selectedUpdated.textContent = `Weather for ${formatWeatherDateLong(weatherDate)}`;

  if (elements.detailConditionIcon) {
    const detailIcon = pickForecastWeatherIcon(detailIconInput);
    elements.detailConditionIcon.src = detailIcon.src;
    elements.detailConditionIcon.alt = detailIcon.alt;
  }

  elements.dailyCondition.textContent = formatValue(cleanConditionForCard(location, condition));
  elements.dailyTemp.textContent = formatTemperature(temp);
  elements.dailyLowHigh.textContent = `${formatTemperature(low)} / ${formatTemperature(high)}`;
  elements.dailyWind.textContent = formatWind(wind);
  elements.dailyWindDirection.textContent = formatWindDirection(windDirection);
  elements.dailyRainfall.textContent = formatRainChance(rainfall);

  const score = pickValue(benchmark, ["score", "confidence", "latest_confidence"]);
  const source = pickValue(benchmark, ["source", "provider", "model"]);
  const delta = pickValue(benchmark, ["delta", "difference", "variance"]);

  elements.benchmarkScore.textContent = formatScore(score);
  elements.benchmarkSource.textContent = formatValue(source);
  elements.benchmarkDelta.textContent = `Delta ${formatDelta(delta)}`;

  renderNext7Forecast(daily, history, location, weatherDate);
  renderSportRecommendations(daily?.suitability);
  renderBenchmarkSources(benchmark);
  renderMwisLinks(location, daily?.mwis_links);

  state.historyTrendModel = buildHistoryTrendModel(history);
  if (!historyModelHasMetricData(state.historyTrendModel, state.historyMetric)) {
    state.historyMetric = historyModelHasMetricData(state.historyTrendModel, "temperature") ? "temperature" : "wind";
  }
  syncHistoryMetricButtons();
  renderHistoryChart(state.historyTrendModel, state.historyMetric);
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

function renderMwisLinks(location, links) {
  if (!elements.mwisLinks || !elements.mwisMeta) {
    return;
  }

  elements.mwisLinks.innerHTML = "";

  const uniqueLinks = Array.from(new Set((Array.isArray(links) ? links : []).map((item) => `${item || ""}`.trim()).filter(Boolean)));
  if (!uniqueLinks.length) {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = `No MWIS PDF available for ${location}.`;
    elements.mwisLinks.appendChild(note);
    elements.mwisMeta.textContent = "Unavailable";
    return;
  }

  uniqueLinks.forEach((link, index) => {
    const anchor = document.createElement("a");
    anchor.className = "mwis-link";
    anchor.href = link;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.textContent = uniqueLinks.length > 1 ? `Download MWIS PDF ${index + 1}` : "Download MWIS PDF";
    elements.mwisLinks.appendChild(anchor);
  });

  elements.mwisMeta.textContent = `${uniqueLinks.length} file${uniqueLinks.length > 1 ? "s" : ""}`;
}

function renderNext7Forecast(dailyPayload, historyPayload, location, startDate) {
  if (!elements.next7Grid || !elements.next7Meta) {
    return;
  }

  elements.next7Grid.innerHTML = "";

  const forecastRows = resolveForecastRows(dailyPayload, historyPayload, location, startDate);
  if (!forecastRows.length) {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = `No 7-day forecast available for ${location}.`;
    elements.next7Grid.appendChild(note);
    elements.next7Meta.textContent = "Unavailable";
    return;
  }

  for (const row of forecastRows) {
    const card = document.createElement("article");
    card.className = "next7-card";

    const icon = pickForecastWeatherIcon({
      condition: row.condition,
      dateTime: row?.date ? `${row.date}T12:00:00` : null,
      rainChance: row.rainChance,
      wind: row.wind,
      temperature: row.temperature,
      low: row.low,
      high: row.high
    });
    const sourceCountText = `${row.sourceCount} src${row.sourceCount === 1 ? "" : "s"}`;
    const conditionText = row.condition ? shortText(row.condition, 92) : "Forecast summary not available.";
    const windDirection = row.windDirection ? ` ${row.windDirection}` : "";

    card.innerHTML = `
      <div class="next7-card-head">
        <p class="next7-day">${escapeHtml(formatDateLabel(row.date))}</p>
        <span class="next7-source-pill">${escapeHtml(sourceCountText)}</span>
      </div>
      <div class="next7-card-main">
        <img class="next7-icon" src="${escapeHtml(icon.src)}" alt="${escapeHtml(icon.alt)}" />
        <p class="next7-temp">${escapeHtml(formatTemperature(row.temperature))}</p>
      </div>
      <p class="next7-range">L ${escapeHtml(formatTemperature(row.low))} • H ${escapeHtml(formatTemperature(row.high))}</p>
      <p class="next7-wind">Wind ${escapeHtml(formatWind(row.wind))}${escapeHtml(windDirection)}</p>
      <p class="next7-rain">Rain ${escapeHtml(formatRainChance(row.rainChance))}</p>
      <p class="next7-condition">${escapeHtml(conditionText)}</p>
    `;

    elements.next7Grid.appendChild(card);
  }

  const totalSources = forecastRows.reduce((sum, row) => sum + row.sourceCount, 0);
  const averageSources = totalSources / forecastRows.length;
  elements.next7Meta.textContent = `${forecastRows.length} days • latest model runs (~${averageSources.toFixed(1)} sources/day)`;
}

function resolveForecastRows(dailyPayload, historyPayload, location, startDate) {
  const fromDaily = normalizeDailyNext7ForecastRows(dailyPayload?.next_7_days, location);
  const fromSourceForecasts = buildNext7ForecastRowsFromSourceForecasts(dailyPayload?.source_forecasts, location);
  const rows = fromDaily.length
    ? fromDaily
    : (fromSourceForecasts.length ? fromSourceForecasts : buildNext7ForecastRows(historyPayload, location));

  return selectForecastRowsWindow(rows, startDate);
}

function resolveDetailForecastIconInput(dailyPayload, historyPayload, location, weatherDate, fallback) {
  const forecastRows = resolveForecastRows(dailyPayload, historyPayload, location, weatherDate);
  const targetDate = normalizeDateKey(weatherDate);
  const matchingRow = targetDate
    ? forecastRows.find((row) => normalizeDateKey(row?.date) === targetDate)
    : forecastRows[0];

  if (matchingRow) {
    return {
      condition: matchingRow.condition,
      dateTime: matchingRow.date ? `${matchingRow.date}T12:00:00` : null,
      rainChance: matchingRow.rainChance,
      wind: matchingRow.wind,
      temperature: matchingRow.temperature,
      low: matchingRow.low,
      high: matchingRow.high
    };
  }

  return {
    condition: fallback.condition,
    dateTime: targetDate ? `${targetDate}T12:00:00` : weatherDate || null,
    rainChance: fallback.rainfall,
    wind: fallback.wind,
    temperature: fallback.temp,
    low: fallback.low,
    high: fallback.high
  };
}

function selectForecastRowsWindow(rows, startDate, maxDays = 7) {
  if (!Array.isArray(rows) || !rows.length) {
    return [];
  }

  const normalizedRows = rows
    .map((row) => {
      const date = normalizeDateKey(row?.date || row?.target_date || row?.forecast_date);
      return date ? { ...row, date } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.date.localeCompare(right.date));

  if (!normalizedRows.length) {
    return [];
  }

  const anchorDate = normalizeDateKey(startDate);
  if (!anchorDate) {
    return normalizedRows.slice(0, maxDays);
  }

  const anchoredRows = normalizedRows.filter((row) => row.date >= anchorDate);
  return (anchoredRows.length ? anchoredRows : normalizedRows).slice(0, maxDays);
}

function normalizeDailyNext7ForecastRows(rows, location) {
  if (!Array.isArray(rows) || !rows.length) {
    return [];
  }

  return rows
    .map((row) => {
      const source = toObject(row) || {};
      const date = normalizeDateKey(source.date || source.target_date || source.forecast_date);
      if (!date) {
        return null;
      }

      const temperature = toNumber(source.temperature) ?? averageValues(toNumber(source.temp_max), toNumber(source.temp_min));
      const low = toNumber(source.temp_min) ?? toNumber(source.low);
      const high = toNumber(source.temp_max) ?? toNumber(source.high);
      const wind = toNumber(source.wind_kph) ?? toNumber(source.wind_max) ?? toNumber(source.wind);
      const rainChance = normalizeRainfallChance(
        source.rainChance ?? source.rainfall_chance ?? source.rain_chance ?? source.precip_probability ?? source.precip_chance
      );
      const windDirection = normalizeWindDirection(
        source.windDirection ?? source.wind_direction ?? source.wind_dir ?? source.wind_bearing ?? source.wind_deg
      );
      const condition = cleanConditionForCard(location, source.condition || source.summary || source.description || "");
      const sourceCount = toNumber(source.source_count) || toNumber(source.sourceCount) || 1;

      return {
        date,
        temperature,
        low,
        high,
        wind,
        rainChance,
        windDirection,
        condition,
        sourceCount: Number.isFinite(sourceCount) && sourceCount > 0 ? Math.round(sourceCount) : 1
      };
    })
    .filter(Boolean);
}

function buildNext7ForecastRowsFromSourceForecasts(sourceForecastsPayload, location) {
  const sourceForecasts = toObject(sourceForecastsPayload) || {};
  const groupedByDate = new Map();

  for (const [sourceId, sourceData] of Object.entries(sourceForecasts)) {
    const rows = Array.isArray(sourceData?.next_7_days) ? sourceData.next_7_days : [];
    if (!rows.length) {
      continue;
    }

    for (const raw of rows) {
      const row = toObject(raw) || {};
      const dateKey = normalizeDateKey(row.date || row.target_date || row.forecast_date);
      if (!dateKey) {
        continue;
      }

      let sourceKey = normalizeLocation(sourceData?.source_label || sourceId || "");
      if (!sourceKey) {
        sourceKey = "forecast-default";
      }

      if (!groupedByDate.has(dateKey)) {
        groupedByDate.set(dateKey, new Map());
      }

      const sourceMap = groupedByDate.get(dateKey);
      const runRank = resolveForecastRunRank(row);
      const existing = sourceMap.get(sourceKey);
      if (!existing || runRank > existing.runRank) {
        sourceMap.set(sourceKey, {
          row: {
            ...row,
            source: row.source || sourceId || null,
            source_label: row.source_label || sourceData?.source_label || sourceId || null
          },
          runRank
        });
      }
    }
  }

  const sortedDates = Array.from(groupedByDate.keys()).sort((a, b) => a.localeCompare(b));
  if (!sortedDates.length) {
    return [];
  }

  const todayKey = normalizeDateKey(new Date().toISOString());
  const upcomingDates = todayKey ? sortedDates.filter((dateKey) => dateKey >= todayKey) : sortedDates;
  const selectedDates = upcomingDates.length
    ? upcomingDates.slice(0, 7)
    : sortedDates.slice(Math.max(0, sortedDates.length - 7));

  return selectedDates
    .map((dateKey) => summarizeNext7ForecastDate(dateKey, Array.from(groupedByDate.get(dateKey)?.values() || []), location))
    .filter(Boolean);
}

function buildNext7ForecastRows(historyPayload, location) {
  const source = toObject(historyPayload) || {};
  const rowsFromHistory = Array.isArray(source.history) ? source.history : [];
  const rowsFromForecasts = Array.isArray(source.forecasts)
    ? source.forecasts
        .filter((row) => normalizeLocation(row?.location) === normalizeLocation(location))
        .map((row) => ({
          kind: "forecast",
          date: row?.target_date || row?.date || row?.forecast_date || null,
          temp_min: row?.temp_min ?? null,
          temp_max: row?.temp_max ?? null,
          wind_max: row?.wind_max ?? null,
          rainfall_chance: row?.rainfall_chance ?? row?.rain_chance ?? row?.precip_probability ?? null,
          wind_direction: row?.wind_direction ?? row?.wind_dir ?? null,
          condition: `Forecast (${row?.source_label || row?.source || "source"})`,
          run_date: row?.run_date || null,
          source: row?.source || null,
          source_label: row?.source_label || null
        }))
    : [];

  const rows = rowsFromHistory.length ? rowsFromHistory : (rowsFromForecasts.length ? rowsFromForecasts : extractHistoryRows(historyPayload));
  const groupedByDate = new Map();

  for (const row of rows) {
    const kind = normalizeLocation(row?.kind);
    if (kind && kind !== "forecast") {
      continue;
    }

    if (!kind && !row?.run_date && !row?.source && !row?.source_label) {
      continue;
    }

    const dateKey = normalizeDateKey(row?.date || row?.target_date || row?.forecast_date);
    if (!dateKey) {
      continue;
    }

    let sourceKey = normalizeLocation(row?.source_label || row?.source || "");
    if (!sourceKey) {
      sourceKey = "forecast-default";
    }

    if (!groupedByDate.has(dateKey)) {
      groupedByDate.set(dateKey, new Map());
    }

    const sourceMap = groupedByDate.get(dateKey);
    const runRank = resolveForecastRunRank(row);
    const existing = sourceMap.get(sourceKey);
    if (!existing || runRank > existing.runRank) {
      sourceMap.set(sourceKey, { row, runRank });
    }
  }

  const sortedDates = Array.from(groupedByDate.keys()).sort((a, b) => a.localeCompare(b));
  if (!sortedDates.length) {
    return [];
  }

  const todayKey = normalizeDateKey(new Date().toISOString());
  const upcomingDates = todayKey ? sortedDates.filter((dateKey) => dateKey >= todayKey) : sortedDates;
  const selectedDates = upcomingDates.length
    ? upcomingDates.slice(0, 7)
    : sortedDates.slice(Math.max(0, sortedDates.length - 7));

  return selectedDates
    .map((dateKey) => summarizeNext7ForecastDate(dateKey, Array.from(groupedByDate.get(dateKey)?.values() || []), location))
    .filter(Boolean);
}

function summarizeNext7ForecastDate(dateKey, entries, location) {
  if (!entries.length) {
    return null;
  }

  const temperatures = [];
  const lows = [];
  const highs = [];
  const winds = [];
  const rainChances = [];
  const windDirections = [];
  const conditions = [];

  for (const entry of entries) {
    const row = entry?.row;
    if (!row) {
      continue;
    }

    const temperature = toNumber(row?.temperature) ?? averageValues(toNumber(row?.temp_max), toNumber(row?.temp_min));
    const low = toNumber(row?.temp_min);
    const high = toNumber(row?.temp_max);
    const wind = toNumber(row?.wind_max);
    const rainChance = normalizeRainfallChance(
      row?.rainfall_chance ?? row?.rain_chance ?? row?.precip_probability ?? row?.precip_chance
    );
    const windDirection = normalizeWindDirection(
      row?.wind_direction ?? row?.wind_dir ?? row?.wind_bearing ?? row?.wind_deg ?? row?.wind_degree
    );

    if (Number.isFinite(temperature)) {
      temperatures.push(temperature);
    }
    if (Number.isFinite(low)) {
      lows.push(low);
    }
    if (Number.isFinite(high)) {
      highs.push(high);
    }
    if (Number.isFinite(wind)) {
      winds.push(wind);
    }
    if (Number.isFinite(rainChance)) {
      rainChances.push(rainChance);
    }
    if (windDirection) {
      windDirections.push(windDirection);
    }

    const rawCondition = `${row?.condition || row?.summary || row?.description || ""}`.trim();
    const cleanedCondition = cleanConditionForCard(location, rawCondition);
    if (cleanedCondition && !/^forecast\b/i.test(cleanedCondition.toLowerCase())) {
      conditions.push(cleanedCondition);
    }
  }

  const meanTemperature = averageList(temperatures);
  const lowTemperature = lows.length ? Math.min(...lows) : (temperatures.length ? Math.min(...temperatures) : null);
  const highTemperature = highs.length ? Math.max(...highs) : (temperatures.length ? Math.max(...temperatures) : null);
  const meanWind = averageList(winds);
  const meanRainChance = averageList(rainChances);

  let condition = conditions[0] || "";
  if (!condition) {
    if (Number.isFinite(meanWind) && meanWind >= 45) {
      condition = "Very windy conditions expected.";
    } else if (Number.isFinite(highTemperature) && highTemperature <= 0) {
      condition = "Cold conditions expected.";
    } else {
      condition = "Forecast from latest model runs.";
    }
  }

  return {
    date: dateKey,
    temperature: meanTemperature,
    low: lowTemperature,
    high: highTemperature,
    wind: meanWind,
    rainChance: meanRainChance,
    windDirection: mostCommonString(windDirections),
    condition,
    sourceCount: entries.length
  };
}

function resolveForecastRunRank(row) {
  const candidates = [row?.run_date, row?.updated_at, row?.generated_at_utc];
  for (const value of candidates) {
    const raw = `${value || ""}`.trim();
    if (!raw) {
      continue;
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.getTime();
    }

    const compact = raw.replace(/\D/g, "");
    if (compact.length >= 8) {
      return Number.parseInt(compact.slice(0, 14), 10);
    }
  }

  return 0;
}

function averageList(values) {
  if (!Array.isArray(values) || !values.length) {
    return null;
  }

  const finite = values.filter((value) => Number.isFinite(value));
  if (!finite.length) {
    return null;
  }

  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const text = `${value || ""}`.trim();
    if (text) {
      return text;
    }
  }
  return null;
}

function setHistoryMetric(metric) {
  if (!Object.prototype.hasOwnProperty.call(HISTORY_METRIC_CONFIG, metric)) {
    return;
  }

  state.historyMetric = metric;
  syncHistoryMetricButtons();

  if (state.historyTrendModel) {
    renderHistoryChart(state.historyTrendModel, state.historyMetric);
  }
}

function syncHistoryMetricButtons() {
  const hasTemp = historyModelHasMetricData(state.historyTrendModel, "temperature");
  const hasWind = historyModelHasMetricData(state.historyTrendModel, "wind");

  if (elements.historyMetricTempBtn) {
    const isActive = state.historyMetric === "temperature";
    elements.historyMetricTempBtn.classList.toggle("is-active", isActive);
    elements.historyMetricTempBtn.setAttribute("aria-pressed", isActive ? "true" : "false");
    elements.historyMetricTempBtn.disabled = !hasTemp;
  }

  if (elements.historyMetricWindBtn) {
    const isActive = state.historyMetric === "wind";
    elements.historyMetricWindBtn.classList.toggle("is-active", isActive);
    elements.historyMetricWindBtn.setAttribute("aria-pressed", isActive ? "true" : "false");
    elements.historyMetricWindBtn.disabled = !hasWind;
  }
}

function historyModelHasMetricData(model, metric) {
  if (!model || !Array.isArray(model.series) || !model.series.length) {
    return false;
  }

  return model.series.some((series) =>
    Array.isArray(series.points) &&
    series.points.some((point) => Number.isFinite(toNumber(metric === "wind" ? point?.wind : point?.temperature)))
  );
}

function buildHistoryTrendModel(payload) {
  const rows = Array.isArray(payload?.history) ? payload.history : extractHistoryRows(payload);
  const forecastRows = rows
    .filter((row) => normalizeLocation(row?.kind) === "forecast")
    .sort((a, b) => `${b.date || ""}${b.run_date || ""}`.localeCompare(`${a.date || ""}${a.run_date || ""}`));

  const seriesMap = new Map();
  for (const row of forecastRows) {
    const sourceKey = `${row?.source || row?.source_label || ""}`.trim();
    if (!sourceKey) {
      continue;
    }

    const dateKey = normalizeDateKey(row?.date);
    if (!dateKey) {
      continue;
    }

    const temp = toNumber(row?.temperature) ?? averageValues(toNumber(row?.temp_max), toNumber(row?.temp_min));
    const wind = toNumber(row?.wind_max);
    if (!Number.isFinite(temp) && !Number.isFinite(wind)) {
      continue;
    }

    if (!seriesMap.has(sourceKey)) {
      seriesMap.set(sourceKey, {
        key: sourceKey,
        label: `${row?.source_label || sourceKey}`,
        pointsByDate: new Map()
      });
    }

    const targetSeries = seriesMap.get(sourceKey);
    if (!targetSeries.pointsByDate.has(dateKey)) {
      targetSeries.pointsByDate.set(dateKey, {
        date: dateKey,
        temperature: temp,
        wind
      });
    }
  }

  const rawSeries = Array.from(seriesMap.values())
    .map((entry) => ({
      ...entry,
      pointCount: entry.pointsByDate.size
    }))
    .filter((entry) => entry.pointCount > 0)
    .sort((left, right) => {
      if (left.pointCount !== right.pointCount) {
        return right.pointCount - left.pointCount;
      }
      return left.label.localeCompare(right.label);
    })
    .slice(0, 7);

  const dateSet = new Set();
  for (const series of rawSeries) {
    for (const dateKey of series.pointsByDate.keys()) {
      dateSet.add(dateKey);
    }
  }

  const dates = Array.from(dateSet).sort((a, b) => a.localeCompare(b));
  const series = rawSeries.map((entry, index) => ({
    key: entry.key,
    label: entry.label,
    color: HISTORY_SOURCE_COLORS[index % HISTORY_SOURCE_COLORS.length],
    points: dates.map((dateKey) => entry.pointsByDate.get(dateKey) || { date: dateKey, temperature: null, wind: null }),
    pointCount: entry.pointCount
  }));

  return {
    dates,
    series,
    rowCount: forecastRows.length
  };
}

function renderHistoryChart(model, metric = "temperature") {
  if (!elements.historyChart || !elements.historyLegend || !elements.historyMeta) {
    return;
  }

  elements.historyChart.innerHTML = "";
  elements.historyLegend.innerHTML = "";

  if (!model || !Array.isArray(model.series) || !model.series.length || !Array.isArray(model.dates) || !model.dates.length) {
    elements.historyMeta.textContent = "No trend data";
    renderHistoryChartEmpty("No source trend data available.");
    return;
  }

  const metricKey = metric === "wind" ? "wind" : "temperature";
  const metricInfo = HISTORY_METRIC_CONFIG[metricKey];
  const readPointValue = (point) => toNumber(metricKey === "wind" ? point?.wind : point?.temperature);

  const numericValues = [];
  for (const series of model.series) {
    for (const point of series.points) {
      const value = readPointValue(point);
      if (Number.isFinite(value)) {
        numericValues.push(value);
      }
    }
  }

  if (!numericValues.length) {
    elements.historyMeta.textContent = `${model.series.length} sources`;
    renderHistoryChartEmpty(`No ${metricInfo.label.toLowerCase()} values in source trend data.`);
    return;
  }

  let min = Math.min(...numericValues);
  let max = Math.max(...numericValues);
  if (min === max) {
    const pad = metricKey === "wind" ? 2 : 0.5;
    min -= pad;
    max += pad;
  }

  const marginTop = 20;
  const marginRight = 24;
  const marginBottom = 34;
  const marginLeft = 52;
  const plotHeight = 166;
  const stepX = Math.max(56, Math.min(90, 760 / Math.max(1, model.dates.length - 1)));
  const chartWidth = Math.max(520, marginLeft + marginRight + stepX * Math.max(1, model.dates.length - 1));
  const chartHeight = marginTop + plotHeight + marginBottom;
  const range = max - min || 1;

  const svg = createSvgNode("svg", {
    class: "history-line-svg",
    viewBox: `0 0 ${chartWidth} ${chartHeight}`,
    width: chartWidth,
    height: chartHeight,
    role: "img",
    "aria-label": `${metricInfo.label} trend by source`
  });

  for (let tick = 0; tick <= 4; tick += 1) {
    const ratio = tick / 4;
    const y = marginTop + ratio * plotHeight;
    const value = max - ratio * range;

    svg.appendChild(createSvgNode("line", {
      class: "history-grid-line",
      x1: marginLeft,
      y1: y,
      x2: chartWidth - marginRight,
      y2: y
    }));

    const label = createSvgNode("text", {
      class: "history-axis-label",
      x: marginLeft - 8,
      y: y + 4,
      "text-anchor": "end"
    });
    label.textContent = formatMetricValue(value, metricKey);
    svg.appendChild(label);
  }

  const labelStride = Math.max(1, Math.ceil(model.dates.length / 6));
  for (let index = 0; index < model.dates.length; index += 1) {
    const isLast = index === model.dates.length - 1;
    if (!isLast && index % labelStride !== 0) {
      continue;
    }

    const x = marginLeft + index * stepX;
    const label = createSvgNode("text", {
      class: "history-axis-label history-axis-label-x",
      x,
      y: chartHeight - 8,
      "text-anchor": "middle"
    });
    label.textContent = shortDateLabel(model.dates[index]);
    svg.appendChild(label);
  }

  for (const series of model.series) {
    let pathData = "";
    let hasSegment = false;

    for (let index = 0; index < series.points.length; index += 1) {
      const point = series.points[index];
      const value = readPointValue(point);
      if (!Number.isFinite(value)) {
        hasSegment = false;
        continue;
      }

      const x = marginLeft + index * stepX;
      const y = marginTop + ((max - value) / range) * plotHeight;
      pathData += hasSegment ? ` L ${x} ${y}` : ` M ${x} ${y}`;
      hasSegment = true;
    }

    if (pathData.trim()) {
      svg.appendChild(createSvgNode("path", {
        class: "history-series-line",
        d: pathData,
        stroke: series.color
      }));
    }

    for (let index = 0; index < series.points.length; index += 1) {
      const point = series.points[index];
      const value = readPointValue(point);
      if (!Number.isFinite(value)) {
        continue;
      }

      const x = marginLeft + index * stepX;
      const y = marginTop + ((max - value) / range) * plotHeight;
      svg.appendChild(createSvgNode("circle", {
        class: "history-point",
        cx: x,
        cy: y,
        r: 2.8,
        fill: series.color
      }));
    }
  }

  elements.historyChart.appendChild(svg);
  renderHistoryLegend(model.series);
  elements.historyMeta.textContent = `${model.series.length} sources • ${model.dates.length} days • ${metricInfo.label}`;
}

function renderHistoryLegend(seriesList) {
  if (!elements.historyLegend) {
    return;
  }

  elements.historyLegend.innerHTML = "";
  for (const series of seriesList) {
    const item = document.createElement("span");
    item.className = "history-legend-item";

    const swatch = document.createElement("i");
    swatch.className = "history-legend-swatch";
    swatch.style.backgroundColor = series.color;

    const text = document.createElement("span");
    text.textContent = series.label;

    item.appendChild(swatch);
    item.appendChild(text);
    elements.historyLegend.appendChild(item);
  }
}

function renderHistoryChartEmpty(message) {
  if (!elements.historyChart) {
    return;
  }

  elements.historyChart.innerHTML = "";
  const note = document.createElement("p");
  note.className = "muted";
  note.textContent = message;
  elements.historyChart.appendChild(note);
}

function formatMetricValue(value, metric) {
  const numeric = toNumber(value);
  if (numeric === null) {
    return "-";
  }

  if (metric === "wind") {
    return `${numeric.toFixed(0)} km/h`;
  }

  return `${numeric.toFixed(1)} C`;
}

function createSvgNode(tagName, attributes = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tagName);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, `${value}`);
  }
  return node;
}

function getLocationButton(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  return target.closest("button[data-location]");
}

function resolveCountryForLocation(location) {
  const normalized = normalizeLocation(location);
  if (normalized && LOCATION_COUNTRY_BY_NAME[normalized]) {
    return LOCATION_COUNTRY_BY_NAME[normalized];
  }

  const parts = `${location || ""}`
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    const country = parts[parts.length - 1];
    if (country.length <= 3) {
      return country.toUpperCase();
    }
    return country;
  }

  return "Unknown Country";
}

function cleanConditionForCard(location, condition) {
  const original = `${condition || ""}`.trim();
  if (!original) {
    return "N/A";
  }

  const escapedLocation = escapeRegExp(`${location || ""}`.trim());
  let cleaned = original;

  if (escapedLocation) {
    cleaned = cleaned.replace(new RegExp(`^[\\s\\-–—]*${escapedLocation}[\\s\\-–—:]*`, "i"), "");
  }

  cleaned = cleaned.replace(/^[\s\-–—:;,]+/, "").trim();
  return cleaned || original;
}

function extractMwisRegionCode(link) {
  const match = /\/([a-z]{2})-mwi-/i.exec(`${link || ""}`);
  return match ? match[1].toLowerCase() : "";
}

function resolveMwisLinksForLocation(report, location) {
  const links = Array.isArray(report?.mwis_pdf_links) ? report.mwis_pdf_links : [];
  if (!links.length) {
    return [];
  }

  const normalized = normalizeLocation(location);
  const expectedCodes = MWIS_REGION_CODES_BY_LOCATION[normalized] || [];
  if (!expectedCodes.length) {
    return [];
  }

  const matched = links.filter((link) => expectedCodes.includes(extractMwisRegionCode(link)));
  return matched.length ? matched : [];
}

function isOverviewVisible() {
  return !elements.overviewPage.classList.contains("is-hidden");
}

function isDetailVisible() {
  return !elements.detailPage.classList.contains("is-hidden");
}

function isDetailSwipeBlockedTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.closest(
      "button, a, input, select, textarea, label, #next7Grid, #historyChart, .history-toggle, #mwisLinks"
    )
  );
}

function isKeyboardNavigationTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return true;
  }

  if (target.isContentEditable) {
    return false;
  }

  return !Boolean(target.closest("input, textarea, select, [contenteditable='true'], [contenteditable=''], [role='textbox']"));
}

function handleGlobalKeydown(event) {
  if (isMobileViewport() || state.isTransitioningDetail) {
    return;
  }

  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
    return;
  }

  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
    return;
  }

  if (!isKeyboardNavigationTarget(event.target)) {
    return;
  }

  const directionStep = event.key === "ArrowRight" ? 1 : -1;

  if (isDetailVisible()) {
    event.preventDefault();
    void switchDetailLocation(directionStep);
    return;
  }

  if (isOverviewVisible()) {
    event.preventDefault();
    shiftFocusedCard(directionStep);
  }
}

function handleDeckTouchStart(event) {
  if (!isMobileViewport() || state.isTransitioningDetail || !isOverviewVisible()) {
    return;
  }

  if (event.touches.length !== 1) {
    state.swipe.tracking = false;
    return;
  }

  const touch = event.touches[0];
  state.swipe.tracking = true;
  state.swipe.startX = touch.clientX;
  state.swipe.startY = touch.clientY;
  state.swipe.handled = false;
}

function handleDeckTouchMove(event) {
  if (!state.swipe.tracking || state.swipe.handled || event.touches.length !== 1) {
    return;
  }

  const touch = event.touches[0];
  const deltaX = touch.clientX - state.swipe.startX;
  const deltaY = touch.clientY - state.swipe.startY;
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);

  if (absX < SWIPE_MIN_DISTANCE_PX) {
    return;
  }

  if (absX <= absY * SWIPE_DIRECTION_RATIO) {
    return;
  }

  state.swipe.handled = true;
  state.suppressDeckClickUntil = Date.now() + SWIPE_CLICK_SUPPRESS_MS;
  shiftFocusedCard(deltaX < 0 ? 1 : -1);
}

function handleDeckTouchEnd() {
  state.swipe.tracking = false;
  state.swipe.handled = false;
}

function handleDetailTouchStart(event) {
  if (!isMobileViewport() || state.isTransitioningDetail || !isDetailVisible()) {
    return;
  }

  if (event.touches.length !== 1) {
    state.detailSwipe.tracking = false;
    return;
  }

  const target = event.target;
  if (isDetailSwipeBlockedTarget(target)) {
    state.detailSwipe.tracking = false;
    state.detailSwipe.blocked = true;
    return;
  }

  const touch = event.touches[0];
  state.detailSwipe.tracking = true;
  state.detailSwipe.startX = touch.clientX;
  state.detailSwipe.startY = touch.clientY;
  state.detailSwipe.handled = false;
  state.detailSwipe.blocked = false;
}

function handleDetailTouchMove(event) {
  if (
    !state.detailSwipe.tracking ||
    state.detailSwipe.handled ||
    state.detailSwipe.blocked ||
    event.touches.length !== 1
  ) {
    return;
  }

  const touch = event.touches[0];
  const deltaX = touch.clientX - state.detailSwipe.startX;
  const deltaY = touch.clientY - state.detailSwipe.startY;
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);

  if (absX < SWIPE_MIN_DISTANCE_PX) {
    return;
  }

  if (absX <= absY * SWIPE_DIRECTION_RATIO) {
    return;
  }

  state.detailSwipe.handled = true;
  void switchDetailLocation(deltaX < 0 ? 1 : -1);
}

function handleDetailTouchEnd() {
  state.detailSwipe.tracking = false;
  state.detailSwipe.handled = false;
  state.detailSwipe.blocked = false;
}

function shiftFocusedCard(directionStep) {
  if (!Array.isArray(state.locations) || !state.locations.length) {
    return false;
  }

  const focusedIndex = Math.max(
    0,
    state.locations.findIndex((location) => normalizeLocation(location) === normalizeLocation(state.focusedLocation))
  );

  const nextIndex = Math.min(state.locations.length - 1, Math.max(0, focusedIndex + directionStep));
  if (nextIndex === focusedIndex) {
    return false;
  }

  const nextLocation = state.locations[nextIndex];
  updateFocusedCard(nextLocation);
  setStatus(`Focused ${nextLocation} (${nextIndex + 1}/${state.locations.length}).`);
  return true;
}

function setLoading(isLoading) {
  elements.homeBtn.disabled = isLoading;
  if (elements.detailBackBtn) {
    elements.detailBackBtn.disabled = isLoading;
  }
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

  if (apiPath === "/api/weather/watchlist" && method === "DELETE") {
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
    const existingWatchlist = buildWatchlistPayloadStatic(bundle);
    const baseLocations = Array.isArray(bundle.watchlist?.locations) && bundle.watchlist.locations.length
      ? [...bundle.watchlist.locations]
      : [...existingWatchlist.locations];
    const key = normalizeLocation(location);
    const nextLocations = baseLocations.filter((item) => normalizeLocation(item) !== key);
    const removed = nextLocations.length !== baseLocations.length;

    if (removed) {
      bundle.watchlist.locations = nextLocations;
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
      removed,
      message: removed ? "Location removed from local watchlist." : "Location not found in local watchlist.",
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
    const benchmark = buildBenchmarkDataStatic(bundle.benchmark, bundle.history, resolvedLocation);
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
  const localWatchlist = normalizeWatchlistPayload(loadLocalWatchlist());
  const hasLocalOverride = localWatchlist.updated_at_utc !== null || localWatchlist.locations.length > 0;
  const mergedWatchlist = hasLocalOverride
    ? localWatchlist
    : {
        updated_at_utc: fileWatchlist.updated_at_utc || null,
        locations: mergeLocationsStatic(fileWatchlist.locations)
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
  const sourceForecastRows = Object.values(toObject(zone?.source_forecasts) || {});
  const tempMin = toNumber(zone?.ensemble?.temp_min) ?? toNumber(latestForecast?.temp_min);
  const tempMax = toNumber(zone?.ensemble?.temp_max) ?? toNumber(latestForecast?.temp_max);
  const rainfallChance = firstFiniteNumber(
    normalizeRainfallChance(zone?.ensemble?.rainfall_chance),
    normalizeRainfallChance(zone?.rainfall_chance),
    normalizeRainfallChance(latestForecast?.rainfall_chance),
    normalizeRainfallChance(latestForecast?.rain_chance),
    normalizeRainfallChance(latestForecast?.precip_probability),
    averageList(sourceForecastRows.map((row) => normalizeRainfallChance(
      row?.rainfall_chance ?? row?.rain_chance ?? row?.precip_probability
    )))
  );
  const windDirection = firstNonEmptyString(
    normalizeWindDirection(zone?.ensemble?.wind_direction),
    normalizeWindDirection(zone?.wind_direction),
    normalizeWindDirection(latestForecast?.wind_direction ?? latestForecast?.wind_dir),
    mostCommonString(sourceForecastRows.map((row) => normalizeWindDirection(row?.wind_direction ?? row?.wind_dir)))
  );
  const next7FromZone = normalizeDailyNext7ForecastRows(zone?.next_7_days, location);
  const next7FromSources = buildNext7ForecastRowsFromSourceForecasts(zone?.source_forecasts, location);
  const next7Days = next7FromZone.length
    ? next7FromZone
    : (next7FromSources.length ? next7FromSources : buildNext7ForecastRows(history, location));

  return {
    location,
    condition: zone?.briefing || `Forecast snapshot for ${location}.`,
    summary: zone?.briefing || null,
    temperature: averageValues(tempMin, tempMax),
    temp_min: tempMin,
    temp_max: tempMax,
    humidity: null,
    wind_kph: toNumber(zone?.ensemble?.wind_max) ?? toNumber(latestForecast?.wind_max),
    rainfall_chance: rainfallChance,
    wind_direction: windDirection,
    updated_at: report?.generated_at_utc || history?.generated_at_utc || null,
    forecast_date: report?.forecast_date || latestForecast?.target_date || null,
    next_7_days: next7Days,
    mwis_links: resolveMwisLinksForLocation(report, location),
    suitability: zone?.suitability || null,
    source_forecasts: zone?.source_forecasts || null,
    reference: latestForecast
  };
}

function getLatestHistoryScoreRows(history) {
  const scoreRows = Array.isArray(history?.source_scores) ? history.source_scores : [];
  const datedRows = scoreRows
    .filter((row) => `${row?.date || ""}`.trim())
    .sort((left, right) => `${right?.date || ""}`.localeCompare(`${left?.date || ""}`));

  if (!datedRows.length) {
    return [];
  }

  const latestDate = `${datedRows[0]?.date || ""}`;
  return datedRows.filter((row) => `${row?.date || ""}` === latestDate);
}

function getLatestHistoryWeightRows(history) {
  const weightRows = Array.isArray(history?.source_weights) ? history.source_weights : [];
  const datedRows = weightRows
    .filter((row) => `${row?.date || ""}`.trim())
    .sort((left, right) => `${right?.date || ""}`.localeCompare(`${left?.date || ""}`));

  if (!datedRows.length) {
    return [];
  }

  const latestDate = `${datedRows[0]?.date || ""}`;
  return datedRows.filter((row) => `${row?.date || ""}` === latestDate);
}

function enrichBenchmarkSources(benchmark, history) {
  const baseSources = Array.isArray(benchmark?.sources) ? benchmark.sources : [];
  const scoreRows = getLatestHistoryScoreRows(history);
  const weightRows = getLatestHistoryWeightRows(history);
  const scoreBySource = new Map(
    scoreRows.map((row) => [
      normalizeLocation(row?.source),
      {
        latest_confidence: toNumber(row?.confidence),
        sample_count: toNumber(row?.sample_count),
        source_label: row?.source_label || row?.source || null
      }
    ])
  );
  const weightBySource = new Map(
    weightRows.map((row) => [
      normalizeLocation(row?.source),
      {
        rolling_confidence: toNumber(row?.rolling_confidence),
        ensemble_weight_pct: toNumber(row?.weight_pct),
        ensemble_weight: toNumber(row?.weight),
        lookback_days: toNumber(row?.lookback_days),
        source_label: row?.source_label || row?.source || null
      }
    ])
  );

  const merged = [];
  const seen = new Set();

  for (const row of baseSources) {
    const key = normalizeLocation(row?.source);
    const scoreFallback = scoreBySource.get(key);
    const weightFallback = weightBySource.get(key);
    merged.push({
      ...row,
      source_label: row?.source_label || scoreFallback?.source_label || weightFallback?.source_label || row?.source || null,
      latest_confidence: toNumber(row?.latest_confidence) ?? scoreFallback?.latest_confidence ?? null,
      sample_count: toNumber(row?.sample_count) ?? scoreFallback?.sample_count ?? null,
      rolling_confidence: toNumber(row?.rolling_confidence) ?? weightFallback?.rolling_confidence ?? null,
      ensemble_weight_pct: toNumber(row?.ensemble_weight_pct) ?? weightFallback?.ensemble_weight_pct ?? null,
      ensemble_weight: toNumber(row?.ensemble_weight) ?? weightFallback?.ensemble_weight ?? null,
      lookback_days: toNumber(row?.lookback_days) ?? weightFallback?.lookback_days ?? row?.lookback_days ?? null
    });
    seen.add(key);
  }

  for (const [key, scoreFallback] of scoreBySource.entries()) {
    if (seen.has(key)) {
      continue;
    }
    const weightFallback = weightBySource.get(key);
    merged.push({
      source: scoreFallback?.source || key,
      source_label: scoreFallback?.source_label || weightFallback?.source_label || key,
      latest_confidence: scoreFallback?.latest_confidence ?? null,
      sample_count: scoreFallback?.sample_count ?? null,
      rolling_confidence: weightFallback?.rolling_confidence ?? null,
      ensemble_weight_pct: weightFallback?.ensemble_weight_pct ?? null,
      ensemble_weight: weightFallback?.ensemble_weight ?? null,
      lookback_days: weightFallback?.lookback_days ?? null
    });
  }

  return merged;
}

function buildBenchmarkDataStatic(benchmark, history, location) {
  const sources = enrichBenchmarkSources(benchmark, history);
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
    generated_at_utc: benchmark?.generated_at_utc || history?.generated_at_utc || null,
    run_date: benchmark?.run_date || history?.run_date || null,
    lookback_days: benchmark?.lookback_days || history?.window_days || null,
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
      rainfall_chance: normalizeRainfallChance(item.rainfall_chance ?? item.rain_chance ?? item.precip_probability),
      wind_direction: normalizeWindDirection(item.wind_direction ?? item.wind_dir),
      condition: buildActualConditionStatic(item)
    }));

  const forecastRows = forecasts
    .filter((item) => normalizeLocation(item?.location) === normalizedLocation)
    .sort((a, b) => `${b.target_date || ""}${b.run_date || ""}`.localeCompare(`${a.target_date || ""}${a.run_date || ""}`))
    .slice(0, 60)
    .map((item) => ({
      kind: "forecast",
      date: item.target_date || null,
      temperature: averageValues(toNumber(item.temp_max), toNumber(item.temp_min)),
      temp_max: toNumber(item.temp_max),
      temp_min: toNumber(item.temp_min),
      wind_max: toNumber(item.wind_max),
      rainfall_chance: normalizeRainfallChance(item.rainfall_chance ?? item.rain_chance ?? item.precip_probability),
      wind_direction: normalizeWindDirection(item.wind_direction ?? item.wind_dir),
      condition: `Forecast (${item.source_label || item.source || "source"})`,
      run_date: item.run_date || null,
      source: item.source || null,
      source_label: item.source_label || null
    }));

  const combined = [...actualRows, ...forecastRows]
    .sort((a, b) => `${b.date || ""}`.localeCompare(`${a.date || ""}`))
    .slice(0, 120);

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
  const merged = customLocations.length ? mergeLocationsStatic(customLocations) : dynamicLocations;

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
  const rainChance = normalizeRainfallChance(item?.rainfall_chance ?? item?.rain_chance ?? item?.precip_probability);
  const windDirection = normalizeWindDirection(item?.wind_direction ?? item?.wind_dir);

  if (min !== null && max !== null) {
    pieces.push(`Min ${min.toFixed(1)} C / Max ${max.toFixed(1)} C`);
  }

  if (wind !== null) {
    pieces.push(`Wind ${wind.toFixed(1)} km/h${windDirection ? ` ${windDirection}` : ""}`);
  }

  if (rainChance !== null) {
    pieces.push(`Rain ${rainChance.toFixed(0)}%`);
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

function pickDetailWeatherIcon(condition, updatedAt, iconSet = DETAIL_WEATHER_ICON_SET2) {
  const text = `${condition || ""}`.toLowerCase();
  const isNight = text.includes("night") || isLikelyNightTime(updatedAt);

  if (text.includes("thunder") || text.includes("lightning") || text.includes("storm")) {
    return { src: iconSet.thunder, alt: "Thunderstorm" };
  }

  if (text.includes("tornado") || text.includes("cyclone") || text.includes("hurricane")) {
    return { src: iconSet.storm, alt: "Severe storm" };
  }

  if (text.includes("snow") || text.includes("sleet") || text.includes("blizzard") || text.includes("hail")) {
    return { src: iconSet.snow, alt: "Snow" };
  }

  if (text.includes("rain") || text.includes("shower") || text.includes("drizzle")) {
    const heavyRain = text.includes("heavy") || text.includes("intense") || text.includes("downpour");
    return heavyRain
      ? { src: iconSet.heavyRain, alt: "Heavy rain" }
      : { src: isNight && iconSet.rainNight ? iconSet.rainNight : iconSet.rain, alt: "Rain" };
  }

  if (text.includes("ice") || text.includes("frost") || text.includes("freez")) {
    return { src: iconSet.cold, alt: "Cold weather" };
  }

  if (text.includes("wind") || text.includes("gust") || text.includes("gale")) {
    return { src: iconSet.wind, alt: "Windy weather" };
  }

  if (text.includes("overcast") || text.includes("cloud") || text.includes("fog") || text.includes("mist") || text.includes("haze")) {
    return { src: iconSet.cloud, alt: "Cloudy weather" };
  }

  if (text.includes("clear") || text.includes("sun")) {
    return isNight
      ? { src: iconSet.clearNight, alt: "Clear night" }
      : { src: iconSet.clearDay, alt: "Clear weather" };
  }

  if (isNight) {
    return { src: iconSet.clearNight, alt: "Night weather" };
  }

  return { src: iconSet.fallback, alt: "Current weather" };
}

function pickForecastWeatherIcon(input, iconSet = DETAIL_WEATHER_ICON_SET2) {
  const source = toObject(input) || {};
  const condition = `${source.condition || ""}`;
  const conditionLower = condition.toLowerCase();
  const dateTime = source.dateTime || null;
  const isNight = isLikelyNightTime(dateTime);
  const rainChance = normalizeRainfallChance(source.rainChance);
  const wind = toNumber(source.wind);
  const temperature = toNumber(source.temperature);
  const low = toNumber(source.low);
  const high = toNumber(source.high);
  const freezing = (
    (high !== null && high <= 1) ||
    (temperature !== null && temperature <= 0) ||
    (low !== null && low <= -2)
  );

  if (conditionLower.includes("thunder") || conditionLower.includes("lightning") || conditionLower.includes("storm")) {
    return { src: iconSet.thunder, alt: "Thunderstorm forecast" };
  }

  if (conditionLower.includes("tornado") || conditionLower.includes("cyclone") || conditionLower.includes("hurricane")) {
    return { src: iconSet.storm, alt: "Severe storm forecast" };
  }

  if (conditionLower.includes("snow") || conditionLower.includes("sleet") || conditionLower.includes("blizzard") || conditionLower.includes("hail")) {
    return { src: iconSet.snow, alt: "Snow forecast" };
  }

  if (conditionLower.includes("ice") || conditionLower.includes("frost") || conditionLower.includes("freez")) {
    return { src: iconSet.cold, alt: "Cold forecast" };
  }

  if (rainChance !== null) {
    if (freezing && rainChance >= 35) {
      return { src: iconSet.snow, alt: "Snow forecast" };
    }
    if (rainChance >= 85) {
      return { src: iconSet.heavyRain, alt: "Heavy rain forecast" };
    }
    if (rainChance >= 60) {
      return { src: isNight && iconSet.rainNight ? iconSet.rainNight : iconSet.rain, alt: "Rain forecast" };
    }
  }

  if (freezing) {
    return { src: iconSet.cold, alt: "Cold forecast" };
  }

  if (wind !== null && wind >= 45) {
    return { src: iconSet.wind, alt: "Windy forecast" };
  }

  if (rainChance !== null && rainChance >= 35) {
    return { src: iconSet.cloud, alt: "Cloudy forecast" };
  }

  const hasSpecificCondition = /rain|shower|drizzle|snow|sleet|ice|frost|hail|wind|gust|gale|overcast|cloud|fog|mist|haze|clear|sun/.test(
    conditionLower
  );
  if (hasSpecificCondition) {
    return pickDetailWeatherIcon(condition, dateTime, iconSet);
  }

  if (isLikelyNightTime(dateTime)) {
    return { src: iconSet.clearNight, alt: "Clear night forecast" };
  }

  return { src: iconSet.clearDay, alt: "Clear forecast" };
}

function isLikelyNightTime(value) {
  if (!value) {
    return false;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  const hour = parsed.getHours();
  return hour < 6 || hour >= 18;
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

function formatWindDirection(value) {
  const normalized = normalizeWindDirection(value);
  if (!normalized) {
    return formatValue(value);
  }

  return normalized;
}

function formatRainChance(value) {
  const numeric = toNumber(value);
  if (numeric === null) {
    return formatValue(value);
  }

  const normalized = numeric <= 1 ? numeric * 100 : numeric;
  return `${Math.max(0, Math.min(100, normalized)).toFixed(0)}%`;
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

function resolveWeatherDate(daily) {
  const source = toObject(daily) || {};
  return pickValue(source, ["forecast_date", "date", "timestamp", "updated_at"]);
}

function formatWeatherDateShort(value) {
  if (!value) {
    return "-";
  }

  const normalized = normalizeDateKey(value);
  return shortDateLabel(normalized || value);
}

function formatWeatherDateLong(value) {
  if (!value) {
    return "N/A";
  }

  const normalized = normalizeDateKey(value);
  const parsed = new Date(normalized || value);
  if (Number.isNaN(parsed.getTime())) {
    return `${value}`;
  }

  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
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

function normalizeDateKey(value) {
  const raw = `${value || ""}`.trim();
  if (!raw) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toISOString().slice(0, 10);
}

function normalizeRainfallChance(value) {
  const numeric = toNumber(value);
  if (numeric === null || numeric < 0) {
    return null;
  }

  const normalized = numeric <= 1 ? numeric * 100 : numeric;
  return Math.max(0, Math.min(100, normalized));
}

function normalizeWindDirection(value) {
  const numeric = toNumber(value);
  if (numeric !== null) {
    return degreesToCompass(numeric);
  }

  const text = `${value || ""}`.trim();
  if (!text) {
    return null;
  }

  const upper = text.toUpperCase();
  if (/^\d+(\.\d+)?$/.test(upper)) {
    return degreesToCompass(Number.parseFloat(upper));
  }

  return upper;
}

function degreesToCompass(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const normalized = ((numeric % 360) + 360) % 360;
  const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const index = Math.round(normalized / 22.5) % directions.length;
  return directions[index];
}

function mostCommonString(values) {
  if (!Array.isArray(values) || !values.length) {
    return null;
  }

  const counts = new Map();
  for (const value of values) {
    const text = `${value || ""}`.trim();
    if (!text) {
      continue;
    }
    counts.set(text, (counts.get(text) || 0) + 1);
  }

  let topValue = null;
  let topCount = 0;
  for (const [value, count] of counts.entries()) {
    if (count > topCount) {
      topValue = value;
      topCount = count;
    }
  }

  return topValue;
}

function normalizeLocation(value) {
  return `${value || ""}`.trim().replace(/\s+/g, " ").toLowerCase();
}

function escapeRegExp(value) {
  return `${value || ""}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
