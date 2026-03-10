const state = {
  location: "Hong Kong",
  rawPayload: null
};

const elements = {
  statusText: document.getElementById("statusText"),
  searchForm: document.getElementById("searchForm"),
  locationInput: document.getElementById("locationInput"),
  loadBtn: document.getElementById("loadBtn"),
  addLocationForm: document.getElementById("addLocationForm"),
  newLocationInput: document.getElementById("newLocationInput"),
  addBtn: document.getElementById("addBtn"),
  refreshWatchlistBtn: document.getElementById("refreshWatchlistBtn"),
  dailyCondition: document.getElementById("dailyCondition"),
  dailyTemp: document.getElementById("dailyTemp"),
  dailyHumidity: document.getElementById("dailyHumidity"),
  dailyWind: document.getElementById("dailyWind"),
  dailyUpdated: document.getElementById("dailyUpdated"),
  benchmarkScore: document.getElementById("benchmarkScore"),
  benchmarkDelta: document.getElementById("benchmarkDelta"),
  benchmarkSource: document.getElementById("benchmarkSource"),
  historyList: document.getElementById("historyList"),
  watchlistList: document.getElementById("watchlistList"),
  rawPayload: document.getElementById("rawPayload")
};

bindEvents();
initialize();

function bindEvents() {
  elements.searchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const location = elements.locationInput.value.trim();
    if (!location) {
      return;
    }

    await loadDashboard(location, { refreshWatchlist: false });
  });

  elements.addLocationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const location = elements.newLocationInput.value.trim();
    if (!location) {
      return;
    }

    await addLocation(location);
  });

  elements.refreshWatchlistBtn.addEventListener("click", async () => {
    await refreshWatchlist();
  });

  elements.watchlistList.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const chip = target.closest("button[data-location]");
    if (!chip) {
      return;
    }

    const location = chip.getAttribute("data-location") || "";
    if (!location) {
      return;
    }

    elements.locationInput.value = location;
    await loadDashboard(location, { refreshWatchlist: false });
  });
}

async function initialize() {
  const params = new URLSearchParams(window.location.search);
  const queryLocation = (params.get("location") || "").trim();

  if (queryLocation) {
    state.location = queryLocation;
  }

  elements.locationInput.value = state.location;

  await refreshWatchlist();
  await loadDashboard(state.location, { refreshWatchlist: false });
}

async function loadDashboard(location, options = {}) {
  const normalizedLocation = location.trim();
  if (!normalizedLocation) {
    return;
  }

  setLoading(true);
  setStatus(`Loading weather dashboard for ${normalizedLocation}...`);

  const result = await apiRequest(`/api/weather?location=${encodeURIComponent(normalizedLocation)}`);

  setLoading(false);

  if (!result.ok) {
    setStatus(result.error || "Unable to load dashboard data.", "error");
    return;
  }

  state.location = normalizedLocation;
  window.history.replaceState(window.history.state, "", `?location=${encodeURIComponent(normalizedLocation)}`);

  renderDaily(result.data?.daily);
  renderBenchmark(result.data?.benchmark);
  renderHistory(result.data?.history);

  if (options.refreshWatchlist !== false) {
    await refreshWatchlist();
  } else {
    renderWatchlist(result.data?.watchlist);
  }

  setRawPayload(result);
  setStatus(`Dashboard updated for ${normalizedLocation}.`, "success");
}

async function refreshWatchlist() {
  const result = await apiRequest("/api/weather/watchlist");

  if (!result.ok) {
    renderWatchlist(null);
    setStatus(result.error || "Unable to refresh watchlist.", "error");
    return;
  }

  renderWatchlist(result.data);
}

async function addLocation(location) {
  setLoading(true);
  setStatus(`Adding ${location} to Yuen Yuen AIBot watchlist...`);

  const result = await apiRequest("/api/weather/watchlist", {
    method: "POST",
    body: JSON.stringify({ location })
  });

  setLoading(false);

  if (!result.ok) {
    setStatus(result.error || "Failed to add location.", "error");
    return;
  }

  elements.newLocationInput.value = "";
  renderWatchlist(result.watchlist || result.data?.watchlist || null);
  setStatus(`${location} was sent to Yuen Yuen AIBot watchlist.`, "success");

  await loadDashboard(location, { refreshWatchlist: true });
}

function renderDaily(payload) {
  const source = toObject(payload);

  const condition = pickValue(source, [
    "condition",
    "weather",
    "summary",
    "description",
    "current.condition",
    "current.summary",
    "forecast.condition"
  ]);

  const temperature = pickValue(source, [
    "temperature",
    "temp",
    "temp_c",
    "tempC",
    "current.temperature",
    "current.temp",
    "current.temp_c",
    "forecast.temp_c"
  ]);

  const humidity = pickValue(source, ["humidity", "rh", "current.humidity", "forecast.humidity"]);

  const wind = pickValue(source, [
    "wind",
    "wind_kph",
    "wind_speed",
    "windSpeed",
    "current.wind",
    "current.wind_kph"
  ]);

  const updatedAt = pickValue(source, ["updated_at", "timestamp", "date", "datetime", "current.updated_at"]);

  elements.dailyCondition.textContent = formatValue(condition);
  elements.dailyTemp.textContent = formatTemperature(temperature);
  elements.dailyHumidity.textContent = formatPercent(humidity);
  elements.dailyWind.textContent = formatWind(wind);
  elements.dailyUpdated.textContent = formatDateTime(updatedAt);
}

function renderBenchmark(payload) {
  const source = toObject(payload);

  const score = pickValue(source, [
    "score",
    "benchmark_score",
    "accuracy",
    "confidence",
    "metrics.score",
    "stats.score"
  ]);

  const delta = pickValue(source, [
    "delta",
    "difference",
    "variance",
    "metrics.delta",
    "stats.delta"
  ]);

  const provider = pickValue(source, ["source", "provider", "model", "reference", "meta.source"]);

  elements.benchmarkScore.textContent = formatScore(score);
  elements.benchmarkDelta.textContent = formatDelta(delta);
  elements.benchmarkSource.textContent = formatValue(provider);
}

function renderHistory(payload) {
  const rows = extractHistoryRows(payload);
  elements.historyList.innerHTML = "";

  if (!rows.length) {
    const empty = document.createElement("li");
    empty.className = "history-item";
    empty.textContent = "No history data found.";
    elements.historyList.appendChild(empty);
    return;
  }

  for (const row of rows.slice(0, 10)) {
    const item = document.createElement("li");
    item.className = "history-item";

    const date = document.createElement("strong");
    date.textContent = formatDateLabel(row.date);

    const temp = document.createElement("span");
    temp.textContent = formatTemperature(row.temperature);

    const summary = document.createElement("span");
    summary.textContent = formatValue(row.condition);

    item.appendChild(date);
    item.appendChild(temp);
    item.appendChild(summary);
    elements.historyList.appendChild(item);
  }
}

function renderWatchlist(payload) {
  const locations = extractLocations(payload);
  elements.watchlistList.innerHTML = "";

  if (!locations.length) {
    const note = document.createElement("span");
    note.className = "muted";
    note.textContent = "No watchlist locations returned.";
    elements.watchlistList.appendChild(note);
    return;
  }

  for (const location of locations) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.setAttribute("data-location", location);
    chip.textContent = location;
    elements.watchlistList.appendChild(chip);
  }
}

function setRawPayload(payload) {
  const serialized = JSON.stringify(payload, null, 2);
  elements.rawPayload.textContent = serialized.length > 12000 ? `${serialized.slice(0, 12000)}\n...truncated` : serialized;
}

function setLoading(isLoading) {
  elements.loadBtn.disabled = isLoading;
  elements.addBtn.disabled = isLoading;
  elements.refreshWatchlistBtn.disabled = isLoading;
}

function setStatus(message, type = "info") {
  elements.statusText.textContent = message;
  elements.statusText.classList.remove("is-error", "is-success");

  if (type === "error") {
    elements.statusText.classList.add("is-error");
  }

  if (type === "success") {
    elements.statusText.classList.add("is-success");
  }
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

      return {
        ok: false,
        status: response.status,
        error,
        data
      };
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

function extractLocations(payload) {
  const source = toObject(payload);

  const candidates = [
    payload,
    source?.watchlist,
    source?.locations,
    source?.data,
    source?.items,
    source?.results,
    source?.watch_list,
    source?.data?.watchlist,
    source?.data?.locations
  ];

  let list = [];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      list = candidate;
      break;
    }
  }

  if (!list.length && source) {
    const values = Object.values(source);
    const nestedArray = values.find((value) => Array.isArray(value));
    if (nestedArray) {
      list = nestedArray;
    }
  }

  const normalized = list
    .map((entry) => {
      if (typeof entry === "string") {
        return entry.trim();
      }

      if (entry && typeof entry === "object") {
        return (
          entry.location ||
          entry.name ||
          entry.city ||
          entry.label ||
          entry.value ||
          ""
        )
          .toString()
          .trim();
      }

      return "";
    })
    .filter(Boolean);

  return [...new Set(normalized)];
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
          condition: entry
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
          entry.condition || entry.summary || entry.weather || entry.description || entry.note || null
      };
    })
    .filter((item) => item.date || item.temperature || item.condition);
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

function formatPercent(value) {
  const numeric = toNumber(value);
  if (numeric === null) {
    return formatValue(value);
  }

  return `${numeric.toFixed(0)}%`;
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

  return numeric.toFixed(2);
}

function formatDelta(value) {
  const numeric = toNumber(value);
  if (numeric === null) {
    return formatValue(value);
  }

  const prefix = numeric > 0 ? "+" : "";
  return `${prefix}${numeric.toFixed(2)}`;
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
