import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadDotEnv(path.join(__dirname, ".env"));

const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(PUBLIC_DIR, "data");
const PORT = Number(process.env.PORT || 4173);
const AIBOT_WATCHLIST_SYNC_URL = (process.env.AIBOT_WATCHLIST_SYNC_URL || "").trim();
const AIBOT_SYNC_TIMEOUT_MS = Number(process.env.AIBOT_SYNC_TIMEOUT_MS || 5000);

const DATA_FILES = {
  report: "weather_latest_report.json",
  benchmark: "weather_benchmarks_latest.json",
  history: "weather_history_recent.json",
  watchlist: "weather_watchlist.json"
};

const DATA_FILE_PATHS = {
  report: path.join(DATA_DIR, DATA_FILES.report),
  benchmark: path.join(DATA_DIR, DATA_FILES.benchmark),
  history: path.join(DATA_DIR, DATA_FILES.history),
  watchlist: path.join(DATA_DIR, DATA_FILES.watchlist)
};

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2"
};

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || "/", "http://localhost");

    if (requestUrl.pathname.startsWith("/api/")) {
      applyApiHeaders(res);

      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
      }

      await handleApi(req, res, requestUrl);
      return;
    }

    if (requestUrl.pathname === "/health" && req.method === "GET") {
      sendJson(res, 200, {
        ok: true,
        service: "yuen-yuen-weather",
        mode: "local-data",
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { ok: false, error: "Method not allowed." });
      return;
    }

    await serveStatic(res, requestUrl.pathname);
  } catch (error) {
    console.error("Unhandled request error:", error);
    sendJson(res, 500, { ok: false, error: "Internal server error." });
  }
});

server.listen(PORT, () => {
  console.log(`Yuen Yuen Weather running at http://127.0.0.1:${PORT}`);
});

async function handleApi(req, res, requestUrl) {
  const { pathname } = requestUrl;

  if (pathname === "/api/config" && req.method === "GET") {
    const meta = await buildDataFileMeta();
    sendJson(res, 200, {
      ok: true,
      mode: "local-data",
      dataDir: "public/data",
      files: meta,
      watchlistSync: {
        enabled: Boolean(AIBOT_WATCHLIST_SYNC_URL),
        timeoutMs: AIBOT_SYNC_TIMEOUT_MS
      }
    });
    return;
  }

  if (pathname === "/api/weather" && req.method === "GET") {
    const location = (requestUrl.searchParams.get("location") || "").trim();
    if (!location) {
      sendJson(res, 400, { ok: false, error: "Query parameter 'location' is required." });
      return;
    }

    const bundle = await loadWeatherBundle();
    const resolvedLocation = resolveLocation(location, bundle.knownLocations);

    const daily = buildDailyData(bundle.report, bundle.history, resolvedLocation);
    const benchmark = buildBenchmarkData(bundle.benchmark, resolvedLocation);
    const history = buildHistoryData(bundle.history, resolvedLocation);
    const watchlist = buildWatchlistPayload(bundle);

    sendJson(res, 200, {
      ok: true,
      source: "public/data",
      location: resolvedLocation,
      data: {
        daily,
        benchmark,
        history,
        watchlist
      }
    });
    return;
  }

  if (pathname === "/api/weather/daily" && req.method === "GET") {
    await singleWeatherRoute(res, requestUrl, "daily");
    return;
  }

  if (pathname === "/api/weather/benchmark" && req.method === "GET") {
    await singleWeatherRoute(res, requestUrl, "benchmark");
    return;
  }

  if (pathname === "/api/weather/history" && req.method === "GET") {
    await singleWeatherRoute(res, requestUrl, "history");
    return;
  }

  if (pathname === "/api/weather/watchlist" && req.method === "GET") {
    const bundle = await loadWeatherBundle();
    sendJson(res, 200, {
      ok: true,
      source: "public/data",
      data: buildWatchlistPayload(bundle)
    });
    return;
  }

  if (pathname === "/api/weather/watchlist" && req.method === "POST") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
      return;
    }

    const location = [body?.location, body?.name, requestUrl.searchParams.get("location")]
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .find(Boolean);

    if (!location) {
      sendJson(res, 400, {
        ok: false,
        error: "Body must include 'location' or 'name'."
      });
      return;
    }

    const customWatchlist = await loadCustomWatchlist();
    const hasLocation = hasLocationInList(customWatchlist.locations, location);

    if (!hasLocation) {
      customWatchlist.locations.push(location);
      customWatchlist.updated_at_utc = new Date().toISOString();
      await saveCustomWatchlist(customWatchlist);
    }

    const syncResult = await trySyncWatchlistLocation(location);
    const bundle = await loadWeatherBundle();

    sendJson(res, 200, {
      ok: true,
      source: "public/data",
      location,
      added: !hasLocation,
      message: hasLocation ? "Location already exists in local watchlist." : "Location added to local watchlist.",
      watchlist: buildWatchlistPayload(bundle),
      sync: syncResult
    });
    return;
  }

  sendJson(res, 404, { ok: false, error: "API route not found." });
}

async function singleWeatherRoute(res, requestUrl, kind) {
  const location = (requestUrl.searchParams.get("location") || "").trim();
  if (!location) {
    sendJson(res, 400, { ok: false, error: "Query parameter 'location' is required." });
    return;
  }

  const bundle = await loadWeatherBundle();
  const resolvedLocation = resolveLocation(location, bundle.knownLocations);

  let data;
  if (kind === "daily") {
    data = buildDailyData(bundle.report, bundle.history, resolvedLocation);
  } else if (kind === "benchmark") {
    data = buildBenchmarkData(bundle.benchmark, resolvedLocation);
  } else {
    data = buildHistoryData(bundle.history, resolvedLocation);
  }

  sendJson(res, 200, {
    ok: true,
    source: "public/data",
    location: resolvedLocation,
    data
  });
}

async function loadWeatherBundle() {
  const [report, benchmark, history, customWatchlist] = await Promise.all([
    readJsonFile(DATA_FILE_PATHS.report, {}),
    readJsonFile(DATA_FILE_PATHS.benchmark, {}),
    readJsonFile(DATA_FILE_PATHS.history, {}),
    loadCustomWatchlist()
  ]);

  const knownLocations = collectKnownLocations(report, history, customWatchlist.locations);

  return {
    report: toObject(report),
    benchmark: toObject(benchmark),
    history: toObject(history),
    customWatchlist,
    knownLocations
  };
}

function buildDailyData(report, history, location) {
  const zones = Array.isArray(report?.zones) ? report.zones : [];
  const zone = zones.find((item) => normalizeLocation(item?.name) === normalizeLocation(location)) || null;

  const forecasts = Array.isArray(history?.forecasts) ? history.forecasts : [];
  const locationForecasts = forecasts
    .filter((item) => normalizeLocation(item?.location) === normalizeLocation(location))
    .sort((a, b) => {
      const left = `${a.run_date || ""}${a.target_date || ""}`;
      const right = `${b.run_date || ""}${b.target_date || ""}`;
      return right.localeCompare(left);
    });

  const latestForecast = locationForecasts[0] || null;

  const tempMin = toNumber(zone?.ensemble?.temp_min) ?? toNumber(latestForecast?.temp_min);
  const tempMax = toNumber(zone?.ensemble?.temp_max) ?? toNumber(latestForecast?.temp_max);
  const temperature = averageValues(tempMin, tempMax);

  return {
    location,
    condition: zone?.briefing || `Forecast snapshot for ${location}.`,
    summary: zone?.briefing || null,
    temperature,
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

function buildBenchmarkData(benchmark, location) {
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
    ? withConfidence.reduce((best, row) =>
        toNumber(row.latest_confidence) > toNumber(best.latest_confidence) ? row : best
      )
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

function buildHistoryData(history, location) {
  const actuals = Array.isArray(history?.actuals) ? history.actuals : [];
  const forecasts = Array.isArray(history?.forecasts) ? history.forecasts : [];

  const normalizedLocation = normalizeLocation(location);

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
      condition: buildActualCondition(item)
    }));

  const forecastRows = forecasts
    .filter((item) => normalizeLocation(item?.location) === normalizedLocation)
    .sort((a, b) => {
      const left = `${a.target_date || ""}${a.run_date || ""}`;
      const right = `${b.target_date || ""}${b.run_date || ""}`;
      return right.localeCompare(left);
    })
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

function buildWatchlistPayload(bundle) {
  const dynamicLocations = collectKnownLocations(bundle.report, bundle.history, []);
  const merged = mergeLocations(dynamicLocations, bundle.customWatchlist.locations);

  return {
    generated_at_utc: bundle.report?.generated_at_utc || bundle.history?.generated_at_utc || null,
    updated_at_utc: bundle.customWatchlist.updated_at_utc || null,
    locations: merged,
    counts: {
      total: merged.length,
      dynamic: dynamicLocations.length,
      custom: bundle.customWatchlist.locations.length
    }
  };
}

async function trySyncWatchlistLocation(location) {
  if (!AIBOT_WATCHLIST_SYNC_URL) {
    return {
      enabled: false,
      ok: false,
      status: 0,
      error: "AIBOT_WATCHLIST_SYNC_URL is not configured."
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AIBOT_SYNC_TIMEOUT_MS);

  try {
    const response = await fetch(AIBOT_WATCHLIST_SYNC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain;q=0.9, */*;q=0.8"
      },
      body: JSON.stringify({ location }),
      signal: controller.signal
    });

    const text = await response.text();
    const parsed = parseJsonSafely(text);

    return {
      enabled: true,
      ok: response.ok,
      status: response.status,
      error: response.ok ? null : toErrorMessage(parsed, response.statusText || "Sync failed."),
      response: parsed
    };
  } catch (error) {
    const timeoutError = error?.name === "AbortError";
    return {
      enabled: true,
      ok: false,
      status: 0,
      error: timeoutError
        ? `Sync request timed out after ${AIBOT_SYNC_TIMEOUT_MS}ms.`
        : (error?.message || "Failed to sync watchlist location.")
    };
  } finally {
    clearTimeout(timeout);
  }
}

function collectKnownLocations(report, history, extraLocations = []) {
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

  return mergeLocations(list);
}

function mergeLocations(...groups) {
  const merged = [];
  const seen = new Set();

  for (const group of groups) {
    if (!Array.isArray(group)) {
      continue;
    }

    for (const rawValue of group) {
      if (typeof rawValue !== "string") {
        continue;
      }

      const value = rawValue.trim();
      if (!value) {
        continue;
      }

      const key = normalizeLocation(value);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(value);
      }
    }
  }

  return merged.sort((a, b) => a.localeCompare(b));
}

function resolveLocation(location, knownLocations) {
  const normalized = normalizeLocation(location);
  if (!normalized) {
    return "";
  }

  const exact = knownLocations.find((item) => normalizeLocation(item) === normalized);
  return exact || location.trim();
}

function hasLocationInList(list, location) {
  const key = normalizeLocation(location);
  return list.some((item) => normalizeLocation(item) === key);
}

function buildActualCondition(item) {
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

function normalizeLocation(value) {
  if (!value || typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/\s+/g, " ").toLowerCase();
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

async function loadCustomWatchlist() {
  const loaded = await readJsonFile(DATA_FILE_PATHS.watchlist, {
    locations: [],
    updated_at_utc: null
  });

  if (Array.isArray(loaded)) {
    return {
      locations: loaded
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean),
      updated_at_utc: null
    };
  }

  const source = toObject(loaded) || {};
  const rawLocations = Array.isArray(source.locations) ? source.locations : [];

  return {
    locations: rawLocations
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean),
    updated_at_utc: typeof source.updated_at_utc === "string" ? source.updated_at_utc : null
  };
}

async function saveCustomWatchlist(payload) {
  const normalized = {
    updated_at_utc: payload.updated_at_utc || new Date().toISOString(),
    locations: mergeLocations(payload.locations || [])
  };

  await writeFile(DATA_FILE_PATHS.watchlist, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

async function buildDataFileMeta() {
  const entries = await Promise.all(
    Object.entries(DATA_FILE_PATHS).map(async ([key, filePath]) => {
      try {
        const fileStat = await stat(filePath);
        return [key, {
          file: path.basename(filePath),
          exists: true,
          size: fileStat.size,
          modified_at: fileStat.mtime.toISOString()
        }];
      } catch {
        return [key, {
          file: path.basename(filePath),
          exists: false,
          size: 0,
          modified_at: null
        }];
      }
    })
  );

  return Object.fromEntries(entries);
}

async function readJsonFile(filePath, fallbackValue) {
  try {
    const text = await readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return fallbackValue;
    }

    throw error;
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

function toErrorMessage(data, fallback) {
  if (typeof data === "string" && data.trim()) {
    return data;
  }

  if (data && typeof data === "object") {
    const message = data.error || data.message || data.detail || data.reason;
    if (message) {
      return `${message}`;
    }
  }

  return fallback;
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function toObject(value) {
  return value && typeof value === "object" ? value : null;
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) {
      throw new Error("Request body is too large.");
    }
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

function applyApiHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function serveStatic(res, pathname) {
  const decoded = decodeURIComponent(pathname || "/");
  const initialPath = decoded === "/" ? "/index.html" : decoded;

  const safePath = path.normalize(initialPath).replace(/^([.]{2}[\\/])+/g, "");
  let absolutePath = path.join(PUBLIC_DIR, safePath);

  if (!absolutePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { ok: false, error: "Forbidden." });
    return;
  }

  try {
    const fileStat = await stat(absolutePath);
    if (fileStat.isDirectory()) {
      absolutePath = path.join(absolutePath, "index.html");
    }

    const data = await readFile(absolutePath);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(absolutePath).toLowerCase()] || "application/octet-stream",
      "Content-Length": data.byteLength
    });
    res.end(data);
    return;
  } catch {
    if (!path.extname(initialPath)) {
      const fallbackPath = path.join(PUBLIC_DIR, "index.html");
      const fallbackData = await readFile(fallbackPath);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": fallbackData.byteLength
      });
      res.end(fallbackData);
      return;
    }

    sendJson(res, 404, { ok: false, error: "Not found." });
  }
}

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const text = readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();

    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = rawValue;
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}
