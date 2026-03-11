import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSign } from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadDotEnv(path.join(__dirname, ".env"));

const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(PUBLIC_DIR, "data");
const PORT = Number(process.env.PORT || 4173);
const AIBOT_WATCHLIST_SYNC_URL = (process.env.AIBOT_WATCHLIST_SYNC_URL || "").trim();
const AIBOT_SYNC_TIMEOUT_MS = Number(process.env.AIBOT_SYNC_TIMEOUT_MS || 5000);
const GOOGLE_SHEETS_SPREADSHEET_ID = (process.env.GOOGLE_SHEETS_SPREADSHEET_ID || "").trim();
const GOOGLE_SHEETS_ENABLED = (process.env.GOOGLE_SHEETS_ENABLED || "1").trim() !== "0";
const GOOGLE_OAUTH_ACCESS_TOKEN = (process.env.GOOGLE_OAUTH_ACCESS_TOKEN || "").trim();
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const googleTokenCache = {
  accessToken: "",
  expiresAtMs: 0
};

const SOURCE_BUCKETS = ["configured", "available", "used_for_report", "missing_api_keys", "skipped_errors"];
const MWIS_REGION_CODES_BY_LOCATION = {
  glencoe: ["wh", "nw"],
  "ben nevis": ["wh", "nw"],
  glenshee: ["eh", "sh"],
  cairngorms: ["eh"]
};

const SHEET_TABLE_DEFS = {
  latest_meta: {
    tab: "weather_latest_report",
    columns: [
      { name: "generated_at_utc", type: "nullable_string" },
      { name: "mode", type: "string" },
      { name: "run_date", type: "string" },
      { name: "forecast_date", type: "string" },
      { name: "eval_date", type: "string" },
      { name: "lookback_days", type: "nullable_integer" }
    ]
  },
  latest_sources: {
    tab: "weather_latest_report_sources",
    columns: [
      { name: "bucket", type: "string" },
      { name: "item_order", type: "integer" },
      { name: "source", type: "string" }
    ]
  },
  latest_zones: {
    tab: "weather_latest_report_zones",
    columns: [
      { name: "zone_order", type: "integer" },
      { name: "name", type: "string" },
      { name: "lat", type: "nullable_number" },
      { name: "lon", type: "nullable_number" },
      { name: "ensemble_temp_min", type: "nullable_number" },
      { name: "ensemble_temp_max", type: "nullable_number" },
      { name: "ensemble_wind_max", type: "nullable_number" },
      { name: "ensemble_rainfall_chance", type: "nullable_number" },
      { name: "ensemble_wind_direction", type: "nullable_string" },
      { name: "ensemble_spread_temp", type: "nullable_number" },
      { name: "ensemble_spread_wind", type: "nullable_number" },
      { name: "briefing", type: "string" },
      { name: "suitability_cycling", type: "string" },
      { name: "suitability_hiking", type: "string" },
      { name: "suitability_skiing", type: "string" }
    ]
  },
  latest_zone_sources: {
    tab: "weather_latest_report_zone_sources",
    columns: [
      { name: "zone_order", type: "integer" },
      { name: "name", type: "string" },
      { name: "source_order", type: "integer" },
      { name: "source", type: "string" },
      { name: "source_label", type: "string" },
      { name: "temp_min", type: "nullable_number" },
      { name: "temp_max", type: "nullable_number" },
      { name: "wind_max", type: "nullable_number" },
      { name: "rainfall_chance", type: "nullable_number" },
      { name: "wind_direction", type: "nullable_string" }
    ]
  },
  latest_mwis_links: {
    tab: "weather_latest_report_mwis_links",
    columns: [
      { name: "link_order", type: "integer" },
      { name: "link", type: "string" }
    ]
  },
  benchmarks_meta: {
    tab: "weather_benchmarks_latest",
    columns: [
      { name: "generated_at_utc", type: "nullable_string" },
      { name: "run_date", type: "string" },
      { name: "eval_date", type: "string" },
      { name: "lookback_days", type: "nullable_integer" }
    ]
  },
  benchmarks_sources: {
    tab: "weather_benchmarks_latest_sources",
    columns: [
      { name: "source_order", type: "integer" },
      { name: "source", type: "string" },
      { name: "source_label", type: "string" },
      { name: "is_available", type: "boolean" },
      { name: "is_missing_api_key", type: "boolean" },
      { name: "is_skipped_error", type: "boolean" },
      { name: "runtime_note", type: "string" },
      { name: "latest_confidence", type: "nullable_number" },
      { name: "mae_temp_max", type: "nullable_number" },
      { name: "mae_temp_min", type: "nullable_number" },
      { name: "mae_wind_max", type: "nullable_number" },
      { name: "composite_error", type: "nullable_number" },
      { name: "sample_count", type: "nullable_integer" },
      { name: "rolling_confidence", type: "nullable_number" },
      { name: "rolling_error", type: "nullable_number" },
      { name: "rolling_samples", type: "nullable_integer" },
      { name: "ensemble_weight", type: "nullable_number" },
      { name: "ensemble_weight_pct", type: "nullable_number" }
    ]
  },
  history_meta: {
    tab: "weather_history_recent",
    columns: [
      { name: "generated_at_utc", type: "nullable_string" },
      { name: "run_date", type: "string" },
      { name: "window_days", type: "nullable_integer" },
      { name: "start_date", type: "string" }
    ]
  },
  history_source_scores: {
    tab: "weather_history_recent_source_scores",
    columns: [
      { name: "row_order", type: "integer" },
      { name: "date", type: "string" },
      { name: "source", type: "string" },
      { name: "source_label", type: "string" },
      { name: "mae_temp_max", type: "nullable_number" },
      { name: "mae_temp_min", type: "nullable_number" },
      { name: "mae_wind_max", type: "nullable_number" },
      { name: "composite_error", type: "nullable_number" },
      { name: "confidence", type: "nullable_number" },
      { name: "sample_count", type: "nullable_integer" }
    ]
  },
  history_source_weights: {
    tab: "weather_history_recent_source_weights",
    columns: [
      { name: "row_order", type: "integer" },
      { name: "date", type: "string" },
      { name: "source", type: "string" },
      { name: "source_label", type: "string" },
      { name: "weight", type: "nullable_number" },
      { name: "weight_pct", type: "nullable_number" },
      { name: "rolling_confidence", type: "nullable_number" },
      { name: "lookback_days", type: "nullable_integer" }
    ]
  },
  history_actuals: {
    tab: "weather_history_recent_actuals",
    columns: [
      { name: "row_order", type: "integer" },
      { name: "date", type: "string" },
      { name: "location", type: "string" },
      { name: "lat", type: "nullable_number" },
      { name: "lon", type: "nullable_number" },
      { name: "temp_max", type: "nullable_number" },
      { name: "temp_min", type: "nullable_number" },
      { name: "wind_max", type: "nullable_number" },
      { name: "rainfall_chance", type: "nullable_number" },
      { name: "wind_direction", type: "nullable_string" }
    ]
  },
  history_forecasts: {
    tab: "weather_history_recent_forecasts",
    columns: [
      { name: "row_order", type: "integer" },
      { name: "run_date", type: "string" },
      { name: "target_date", type: "string" },
      { name: "source", type: "string" },
      { name: "source_label", type: "string" },
      { name: "location", type: "string" },
      { name: "temp_max", type: "nullable_number" },
      { name: "temp_min", type: "nullable_number" },
      { name: "wind_max", type: "nullable_number" },
      { name: "rainfall_chance", type: "nullable_number" },
      { name: "wind_direction", type: "nullable_string" }
    ]
  },
  watchlist: {
    tab: "weather_watchlist",
    columns: [
      { name: "location_order", type: "integer" },
      { name: "location", type: "string" },
      { name: "updated_at_utc", type: "nullable_string" }
    ]
  }
};

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
        mode: getDataBackendMode(),
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
      mode: getDataBackendMode(),
      dataDir: getDataBackendMode() === "google-sheets" ? "google-sheets" : "public/data",
      spreadsheetId: GOOGLE_SHEETS_SPREADSHEET_ID || null,
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
      source: bundle.source,
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
      source: bundle.source,
      data: buildWatchlistPayload(bundle)
    });
    return;
  }

  if (pathname === "/api/weather/watchlist" && req.method === "DELETE") {
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

    const bundle = await loadWeatherBundle();
    const existingWatchlist = buildWatchlistPayload(bundle);
    const baseLocations = bundle.customWatchlist.locations.length
      ? [...bundle.customWatchlist.locations]
      : [...existingWatchlist.locations];
    const key = normalizeLocation(location);
    const nextLocations = baseLocations.filter((item) => normalizeLocation(item) !== key);
    const removed = nextLocations.length !== baseLocations.length;

    if (removed) {
      await saveCustomWatchlist({
        locations: nextLocations,
        updated_at_utc: new Date().toISOString()
      }, bundle.storage);
    }

    const refreshedBundle = await loadWeatherBundle();
    sendJson(res, 200, {
      ok: true,
      source: refreshedBundle.source,
      location,
      removed,
      message: removed ? "Location removed from watchlist." : "Location not found in watchlist.",
      watchlist: buildWatchlistPayload(refreshedBundle)
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

    const bundle = await loadWeatherBundle();
    const existingWatchlist = buildWatchlistPayload(bundle);
    const customWatchlist = {
      locations: [...bundle.customWatchlist.locations],
      updated_at_utc: bundle.customWatchlist.updated_at_utc
    };
    const hasLocation = hasLocationInList(existingWatchlist.locations, location);

    if (!hasLocation) {
      customWatchlist.locations.push(location);
      customWatchlist.updated_at_utc = new Date().toISOString();
      await saveCustomWatchlist(customWatchlist, bundle.storage);
    }

    const syncResult = await trySyncWatchlistLocation(location);
    const refreshedBundle = await loadWeatherBundle();

    sendJson(res, 200, {
      ok: true,
      source: refreshedBundle.source,
      location,
      added: !hasLocation,
      message: hasLocation ? "Location already exists in local watchlist." : "Location added to local watchlist.",
      watchlist: buildWatchlistPayload(refreshedBundle),
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
    source: bundle.source,
    location: resolvedLocation,
    data
  });
}

function getDataBackendMode() {
  return isGoogleSheetsReady() ? "google-sheets" : "local-data";
}

function isGoogleSheetsReady() {
  if (!GOOGLE_SHEETS_ENABLED || !GOOGLE_SHEETS_SPREADSHEET_ID) {
    return false;
  }

  if (GOOGLE_OAUTH_ACCESS_TOKEN) {
    return true;
  }

  return hasGoogleServiceAccountCredentials();
}

function hasGoogleServiceAccountCredentials() {
  const serviceAccountJson = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON || "").trim();
  if (serviceAccountJson) {
    try {
      const parsed = JSON.parse(serviceAccountJson);
      return Boolean(parsed?.client_email && parsed?.private_key);
    } catch {
      return false;
    }
  }

  const clientEmail = (
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    process.env.GOOGLE_CLIENT_EMAIL ||
    process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL ||
    ""
  ).trim();
  const privateKey = (
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ||
    process.env.GOOGLE_PRIVATE_KEY ||
    process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY ||
    ""
  ).trim();
  return Boolean(clientEmail && privateKey);
}

function resolveGoogleServiceAccountCredentials() {
  const serviceAccountJson = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON || "").trim();
  if (serviceAccountJson) {
    const parsed = JSON.parse(serviceAccountJson);
    const clientEmail = `${parsed?.client_email || ""}`.trim();
    const privateKey = `${parsed?.private_key || ""}`.replace(/\\n/g, "\n");
    if (!clientEmail || !privateKey) {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key.");
    }
    return { clientEmail, privateKey };
  }

  const clientEmail = (
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    process.env.GOOGLE_CLIENT_EMAIL ||
    process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL ||
    ""
  ).trim();
  const privateKey = (
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ||
    process.env.GOOGLE_PRIVATE_KEY ||
    process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY ||
    ""
  ).replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) {
    throw new Error("Missing Google service account credentials.");
  }

  return { clientEmail, privateKey };
}

function base64UrlEncode(value) {
  const raw = Buffer.isBuffer(value) ? value.toString("base64") : Buffer.from(String(value)).toString("base64");
  return raw.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function getGoogleAccessToken() {
  if (GOOGLE_OAUTH_ACCESS_TOKEN) {
    return GOOGLE_OAUTH_ACCESS_TOKEN;
  }

  const nowMs = Date.now();
  if (googleTokenCache.accessToken && nowMs < googleTokenCache.expiresAtMs) {
    return googleTokenCache.accessToken;
  }

  const { clientEmail, privateKey } = resolveGoogleServiceAccountCredentials();
  const now = Math.floor(nowMs / 1000);

  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file",
    aud: GOOGLE_TOKEN_URL,
    exp: now + 3600,
    iat: now
  };

  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claim))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey);
  const assertion = `${signingInput}.${base64UrlEncode(signature)}`;

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  const payload = await response.json();
  if (!response.ok || !payload?.access_token) {
    throw new Error(`Unable to obtain Google access token: ${JSON.stringify(payload)}`);
  }

  const expiresIn = Number(payload.expires_in) || 3600;
  googleTokenCache.accessToken = payload.access_token;
  googleTokenCache.expiresAtMs = Date.now() + Math.max(60, expiresIn - 60) * 1000;
  return googleTokenCache.accessToken;
}

async function googleSheetsRequest(accessToken, apiPath, options = {}) {
  const { method = "GET", body } = options;
  const url = `${GOOGLE_SHEETS_API_BASE}/${encodeURIComponent(GOOGLE_SHEETS_SPREADSHEET_ID)}${apiPath}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  const payload = text ? parseJsonSafely(text) : null;
  if (!response.ok) {
    throw new Error(`Google Sheets API ${method} ${apiPath} failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

function quoteSheetTitle(title) {
  return `'${String(title || "").replace(/'/g, "''")}'`;
}

function extractSheetTitleFromRange(range) {
  const raw = `${range || ""}`.split("!")[0];
  if (raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  return raw;
}

async function fetchGoogleSheetTitles(accessToken) {
  const payload = await googleSheetsRequest(accessToken, "?includeGridData=false&fields=sheets.properties.title");
  const items = Array.isArray(payload?.sheets) ? payload.sheets : [];
  const titles = new Set();
  for (const item of items) {
    const title = `${item?.properties?.title || ""}`.trim();
    if (title) {
      titles.add(title);
    }
  }
  return titles;
}

async function ensureGoogleSheetTabs(accessToken, tabTitles) {
  const required = Array.from(new Set((tabTitles || []).map((item) => `${item || ""}`.trim()).filter(Boolean)));
  if (!required.length) {
    return;
  }

  const existing = await fetchGoogleSheetTitles(accessToken);
  const missing = required.filter((tab) => !existing.has(tab));
  if (!missing.length) {
    return;
  }

  await googleSheetsRequest(accessToken, ":batchUpdate", {
    method: "POST",
    body: {
      requests: missing.map((tab) => ({
        addSheet: {
          properties: { title: tab }
        }
      }))
    }
  });
}

function parseSheetCell(raw, type) {
  const text = raw === undefined || raw === null ? "" : `${raw}`;

  if (type === "string") {
    return text;
  }

  if (type === "nullable_string") {
    return text === "" ? null : text;
  }

  if (type === "number" || type === "nullable_number") {
    if (text === "") {
      return null;
    }
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }

  if (type === "integer" || type === "nullable_integer") {
    if (text === "") {
      return null;
    }
    const n = Number(text);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }

  if (type === "boolean" || type === "nullable_boolean") {
    if (text === "") {
      return type === "boolean" ? false : null;
    }
    if (typeof raw === "boolean") {
      return raw;
    }
    const normalized = text.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }

  return text;
}

function formatSheetCell(value, type) {
  if (value === undefined || value === null) {
    return "";
  }

  if (type === "number" || type === "nullable_number" || type === "integer" || type === "nullable_integer") {
    const n = Number(value);
    return Number.isFinite(n) ? n : "";
  }

  if (type === "boolean" || type === "nullable_boolean") {
    return Boolean(value);
  }

  return `${value}`;
}

function parseTableRowsFromSheetValues(values, columns) {
  if (!Array.isArray(values) || !values.length || !Array.isArray(columns)) {
    return [];
  }

  const header = Array.isArray(values[0]) ? values[0].map((item) => `${item || ""}`) : [];
  const colIndexByName = new Map();
  for (const col of columns) {
    colIndexByName.set(col.name, header.indexOf(col.name));
  }

  const rows = [];
  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    const sourceRow = Array.isArray(values[rowIndex]) ? values[rowIndex] : [];
    let hasAnyValue = false;
    const row = {};

    for (const col of columns) {
      const idx = colIndexByName.get(col.name);
      const raw = idx >= 0 ? sourceRow[idx] : "";
      if (`${raw || ""}` !== "") {
        hasAnyValue = true;
      }
      row[col.name] = parseSheetCell(raw, col.type);
    }

    if (hasAnyValue) {
      rows.push(row);
    }
  }

  return rows;
}

function sortRowsByKeys(rows, ...keys) {
  return [...rows].sort((left, right) => {
    for (const key of keys) {
      const lv = left?.[key];
      const rv = right?.[key];
      const ln = Number(lv);
      const rn = Number(rv);
      if (Number.isFinite(ln) && Number.isFinite(rn)) {
        if (ln !== rn) {
          return ln - rn;
        }
        continue;
      }

      const ls = `${lv ?? ""}`;
      const rs = `${rv ?? ""}`;
      if (ls !== rs) {
        return ls.localeCompare(rs);
      }
    }
    return 0;
  });
}

async function readGoogleSheetTables(accessToken) {
  const tableEntries = Object.entries(SHEET_TABLE_DEFS);
  await ensureGoogleSheetTabs(
    accessToken,
    tableEntries.map(([, def]) => def.tab)
  );

  const params = new URLSearchParams();
  for (const [, def] of tableEntries) {
    params.append("ranges", `${quoteSheetTitle(def.tab)}!A:ZZ`);
  }
  params.set("majorDimension", "ROWS");

  const payload = await googleSheetsRequest(accessToken, `/values:batchGet?${params.toString()}`);
  const valueRanges = Array.isArray(payload?.valueRanges) ? payload.valueRanges : [];
  const byTab = new Map();
  for (const valueRange of valueRanges) {
    byTab.set(extractSheetTitleFromRange(valueRange?.range), Array.isArray(valueRange?.values) ? valueRange.values : []);
  }

  const tables = {};
  for (const [tableKey, def] of tableEntries) {
    tables[tableKey] = parseTableRowsFromSheetValues(byTab.get(def.tab) || [], def.columns);
  }

  return tables;
}

function latestTablesToJson(tables) {
  const metaRow = (tables.latest_meta || [])[0] || {};
  const sources = {
    configured: [],
    available: [],
    used_for_report: [],
    missing_api_keys: [],
    skipped_errors: []
  };

  for (const row of sortRowsByKeys(tables.latest_sources || [], "bucket", "item_order")) {
    const bucket = `${row?.bucket || ""}`;
    if (!Object.prototype.hasOwnProperty.call(sources, bucket)) {
      continue;
    }
    const source = `${row?.source || ""}`.trim();
    if (source) {
      sources[bucket].push(source);
    }
  }

  const zoneMap = new Map();
  for (const row of sortRowsByKeys(tables.latest_zones || [], "zone_order")) {
    const zoneOrder = Number(row?.zone_order);
    if (!Number.isFinite(zoneOrder)) {
      continue;
    }

    zoneMap.set(zoneOrder, {
      name: `${row?.name || ""}`,
      lat: row?.lat ?? null,
      lon: row?.lon ?? null,
      ensemble: {
        temp_min: row?.ensemble_temp_min ?? null,
        temp_max: row?.ensemble_temp_max ?? null,
        wind_max: row?.ensemble_wind_max ?? null,
        rainfall_chance: row?.ensemble_rainfall_chance ?? null,
        wind_direction: row?.ensemble_wind_direction ?? null,
        spread_temp: row?.ensemble_spread_temp ?? null,
        spread_wind: row?.ensemble_spread_wind ?? null
      },
      briefing: `${row?.briefing || ""}`,
      suitability: {
        cycling: `${row?.suitability_cycling || ""}`,
        hiking: `${row?.suitability_hiking || ""}`,
        skiing: `${row?.suitability_skiing || ""}`
      },
      source_forecasts: {}
    });
  }

  for (const row of sortRowsByKeys(tables.latest_zone_sources || [], "zone_order", "source_order")) {
    const zoneOrder = Number(row?.zone_order);
    if (!Number.isFinite(zoneOrder)) {
      continue;
    }

    if (!zoneMap.has(zoneOrder)) {
      zoneMap.set(zoneOrder, {
        name: `${row?.name || ""}`,
        lat: null,
        lon: null,
        ensemble: {
          temp_min: null,
          temp_max: null,
          wind_max: null,
          rainfall_chance: null,
          wind_direction: null,
          spread_temp: null,
          spread_wind: null
        },
        briefing: "",
        suitability: { cycling: "", hiking: "", skiing: "" },
        source_forecasts: {}
      });
    }

    const source = `${row?.source || ""}`.trim();
    if (!source) {
      continue;
    }

    zoneMap.get(zoneOrder).source_forecasts[source] = {
      source_label: `${row?.source_label || source}`,
      temp_min: row?.temp_min ?? null,
      temp_max: row?.temp_max ?? null,
      wind_max: row?.wind_max ?? null,
      rainfall_chance: row?.rainfall_chance ?? null,
      wind_direction: row?.wind_direction ?? null
    };
  }

  const zones = Array.from(zoneMap.entries())
    .sort((left, right) => left[0] - right[0])
    .map((entry) => entry[1]);

  const mwisPdfLinks = sortRowsByKeys(tables.latest_mwis_links || [], "link_order")
    .map((row) => `${row?.link || ""}`.trim())
    .filter(Boolean);

  return {
    generated_at_utc: metaRow?.generated_at_utc ?? null,
    mode: `${metaRow?.mode || ""}`,
    run_date: `${metaRow?.run_date || ""}`,
    forecast_date: `${metaRow?.forecast_date || ""}`,
    eval_date: `${metaRow?.eval_date || ""}`,
    lookback_days: metaRow?.lookback_days ?? null,
    sources,
    zones,
    mwis_pdf_links: mwisPdfLinks
  };
}

function benchmarkTablesToJson(tables) {
  const metaRow = (tables.benchmarks_meta || [])[0] || {};
  const sources = sortRowsByKeys(tables.benchmarks_sources || [], "source_order").map((row) => ({
    source: `${row?.source || ""}`,
    source_label: `${row?.source_label || ""}`,
    is_available: Boolean(row?.is_available),
    is_missing_api_key: Boolean(row?.is_missing_api_key),
    is_skipped_error: Boolean(row?.is_skipped_error),
    runtime_note: `${row?.runtime_note || ""}`,
    latest_confidence: row?.latest_confidence ?? null,
    mae_temp_max: row?.mae_temp_max ?? null,
    mae_temp_min: row?.mae_temp_min ?? null,
    mae_wind_max: row?.mae_wind_max ?? null,
    composite_error: row?.composite_error ?? null,
    sample_count: row?.sample_count ?? null,
    rolling_confidence: row?.rolling_confidence ?? null,
    rolling_error: row?.rolling_error ?? null,
    rolling_samples: row?.rolling_samples ?? null,
    ensemble_weight: row?.ensemble_weight ?? null,
    ensemble_weight_pct: row?.ensemble_weight_pct ?? null
  }));

  return {
    generated_at_utc: metaRow?.generated_at_utc ?? null,
    run_date: `${metaRow?.run_date || ""}`,
    eval_date: `${metaRow?.eval_date || ""}`,
    lookback_days: metaRow?.lookback_days ?? null,
    sources
  };
}

function historyTablesToJson(tables) {
  const metaRow = (tables.history_meta || [])[0] || {};
  const source_scores = sortRowsByKeys(tables.history_source_scores || [], "row_order").map((row) => ({
    date: `${row?.date || ""}`,
    source: `${row?.source || ""}`,
    source_label: `${row?.source_label || ""}`,
    mae_temp_max: row?.mae_temp_max ?? null,
    mae_temp_min: row?.mae_temp_min ?? null,
    mae_wind_max: row?.mae_wind_max ?? null,
    composite_error: row?.composite_error ?? null,
    confidence: row?.confidence ?? null,
    sample_count: row?.sample_count ?? null
  }));

  const source_weights = sortRowsByKeys(tables.history_source_weights || [], "row_order").map((row) => ({
    date: `${row?.date || ""}`,
    source: `${row?.source || ""}`,
    source_label: `${row?.source_label || ""}`,
    weight: row?.weight ?? null,
    weight_pct: row?.weight_pct ?? null,
    rolling_confidence: row?.rolling_confidence ?? null,
    lookback_days: row?.lookback_days ?? null
  }));

  const actuals = sortRowsByKeys(tables.history_actuals || [], "row_order").map((row) => ({
    date: `${row?.date || ""}`,
    location: `${row?.location || ""}`,
    lat: row?.lat ?? null,
    lon: row?.lon ?? null,
    temp_max: row?.temp_max ?? null,
    temp_min: row?.temp_min ?? null,
    wind_max: row?.wind_max ?? null,
    rainfall_chance: row?.rainfall_chance ?? null,
    wind_direction: row?.wind_direction ?? null
  }));

  const forecasts = sortRowsByKeys(tables.history_forecasts || [], "row_order").map((row) => ({
    run_date: `${row?.run_date || ""}`,
    target_date: `${row?.target_date || ""}`,
    source: `${row?.source || ""}`,
    source_label: `${row?.source_label || ""}`,
    location: `${row?.location || ""}`,
    temp_max: row?.temp_max ?? null,
    temp_min: row?.temp_min ?? null,
    wind_max: row?.wind_max ?? null,
    rainfall_chance: row?.rainfall_chance ?? null,
    wind_direction: row?.wind_direction ?? null
  }));

  return {
    generated_at_utc: metaRow?.generated_at_utc ?? null,
    run_date: `${metaRow?.run_date || ""}`,
    window_days: metaRow?.window_days ?? null,
    start_date: `${metaRow?.start_date || ""}`,
    source_scores,
    source_weights,
    actuals,
    forecasts
  };
}

function watchlistTableToPayload(tables) {
  const rows = sortRowsByKeys(tables.watchlist || [], "location_order");
  const updatedAt = rows.length ? rows[0]?.updated_at_utc ?? null : null;
  const locations = rows
    .map((row) => `${row?.location || ""}`.trim())
    .filter(Boolean);

  return {
    locations,
    updated_at_utc: updatedAt
  };
}

async function loadWeatherBundleFromGoogleSheets() {
  const accessToken = await getGoogleAccessToken();
  const tables = await readGoogleSheetTables(accessToken);

  return {
    report: latestTablesToJson(tables),
    benchmark: benchmarkTablesToJson(tables),
    history: historyTablesToJson(tables),
    customWatchlist: watchlistTableToPayload(tables)
  };
}

function watchlistPayloadToSheetRows(payload) {
  const updated_at_utc = payload?.updated_at_utc || new Date().toISOString();
  const locations = mergeLocations(payload?.locations || []);

  const rows = locations.map((location, index) => ({
    location_order: index,
    location,
    updated_at_utc
  }));

  if (!rows.length) {
    rows.push({
      location_order: 0,
      location: "",
      updated_at_utc
    });
  }

  return rows;
}

async function writeGoogleSheetTableRows(accessToken, tableKey, rows) {
  const table = SHEET_TABLE_DEFS[tableKey];
  if (!table) {
    throw new Error(`Unknown sheet table key: ${tableKey}`);
  }

  const range = `${quoteSheetTitle(table.tab)}!A:ZZ`;
  const header = table.columns.map((column) => column.name);
  const values = [
    header,
    ...(rows || []).map((row) => table.columns.map((column) => formatSheetCell(row?.[column.name], column.type)))
  ];

  await googleSheetsRequest(accessToken, `/values/${encodeURIComponent(range)}:clear`, {
    method: "POST",
    body: {}
  });

  await googleSheetsRequest(accessToken, `/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: "PUT",
    body: { values }
  });
}

async function saveCustomWatchlistToGoogleSheets(payload) {
  const accessToken = await getGoogleAccessToken();
  await ensureGoogleSheetTabs(accessToken, [SHEET_TABLE_DEFS.watchlist.tab]);
  const rows = watchlistPayloadToSheetRows(payload);
  await writeGoogleSheetTableRows(accessToken, "watchlist", rows);
}

async function loadWeatherBundle() {
  if (isGoogleSheetsReady()) {
    try {
      const sheetBundle = await loadWeatherBundleFromGoogleSheets();
      const knownLocations = collectKnownLocations(
        sheetBundle.report,
        sheetBundle.history,
        sheetBundle.customWatchlist.locations
      );

      return {
        ...sheetBundle,
        knownLocations,
        source: "google-sheets",
        storage: "google-sheets"
      };
    } catch (error) {
      console.error("Google Sheets backend read failed, falling back to local JSON:", error?.message || error);
    }
  }

  const [report, benchmark, history, customWatchlist] = await Promise.all([
    readJsonFile(DATA_FILE_PATHS.report, {}),
    readJsonFile(DATA_FILE_PATHS.benchmark, {}),
    readJsonFile(DATA_FILE_PATHS.history, {}),
    loadCustomWatchlistFromJson()
  ]);

  const knownLocations = collectKnownLocations(report, history, customWatchlist.locations);

  return {
    report: toObject(report),
    benchmark: toObject(benchmark),
    history: toObject(history),
    customWatchlist,
    knownLocations,
    source: "public/data",
    storage: "json"
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
  const sourceForecastRows = Object.values(toObject(zone?.source_forecasts) || {});

  const tempMin = toNumber(zone?.ensemble?.temp_min) ?? toNumber(latestForecast?.temp_min);
  const tempMax = toNumber(zone?.ensemble?.temp_max) ?? toNumber(latestForecast?.temp_max);
  const temperature = averageValues(tempMin, tempMax);
  const rainfallChance = firstFiniteNumber(
    normalizeRainfallChance(zone?.ensemble?.rainfall_chance),
    normalizeRainfallChance(zone?.rainfall_chance),
    normalizeRainfallChance(latestForecast?.rainfall_chance),
    normalizeRainfallChance(latestForecast?.rain_chance),
    normalizeRainfallChance(latestForecast?.precip_probability),
    normalizeRainfallChance(latestForecast?.precip_chance),
    averageNumberList(sourceForecastRows.map((row) => normalizeRainfallChance(pickRainfallChanceFromRecord(row))))
  );
  const windDirection = firstNonEmptyString(
    normalizeWindDirection(zone?.ensemble?.wind_direction),
    normalizeWindDirection(zone?.wind_direction),
    normalizeWindDirection(pickWindDirectionFromRecord(latestForecast)),
    mostCommonString(sourceForecastRows.map((row) => normalizeWindDirection(pickWindDirectionFromRecord(row))))
  );
  const next7Days = buildNext7ForecastRowsFromHistory(history, location);

  return {
    location,
    condition: zone?.briefing || `Forecast snapshot for ${location}.`,
    summary: zone?.briefing || null,
    temperature,
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
      rainfall_chance: normalizeRainfallChance(pickRainfallChanceFromRecord(item)),
      wind_direction: normalizeWindDirection(pickWindDirectionFromRecord(item)),
      condition: buildActualCondition(item)
    }));

  const forecastRows = forecasts
    .filter((item) => normalizeLocation(item?.location) === normalizedLocation)
    .sort((a, b) => {
      const left = `${a.target_date || ""}${a.run_date || ""}`;
      const right = `${b.target_date || ""}${b.run_date || ""}`;
      return right.localeCompare(left);
    })
    .slice(0, 60)
    .map((item) => ({
      kind: "forecast",
      date: item.target_date || null,
      temperature: averageValues(toNumber(item.temp_max), toNumber(item.temp_min)),
      temp_max: toNumber(item.temp_max),
      temp_min: toNumber(item.temp_min),
      wind_max: toNumber(item.wind_max),
      rainfall_chance: normalizeRainfallChance(pickRainfallChanceFromRecord(item)),
      wind_direction: normalizeWindDirection(pickWindDirectionFromRecord(item)),
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

function buildWatchlistPayload(bundle) {
  const dynamicLocations = collectKnownLocations(bundle.report, bundle.history, []);
  const customLocations = Array.isArray(bundle.customWatchlist?.locations) ? bundle.customWatchlist.locations : [];
  const merged = customLocations.length ? mergeLocations(customLocations) : dynamicLocations;

  return {
    generated_at_utc: bundle.report?.generated_at_utc || bundle.history?.generated_at_utc || null,
    updated_at_utc: bundle.customWatchlist.updated_at_utc || null,
    locations: merged,
    counts: {
      total: merged.length,
      dynamic: dynamicLocations.length,
      custom: customLocations.length
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
  const rainChance = normalizeRainfallChance(pickRainfallChanceFromRecord(item));
  const windDirection = normalizeWindDirection(pickWindDirectionFromRecord(item));

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

function averageNumberList(values) {
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

  let best = null;
  let bestCount = 0;
  for (const [value, count] of counts.entries()) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }

  return best;
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
  if (!Number.isFinite(numeric)) {
    return null;
  }

  if (numeric < 0) {
    return null;
  }

  const pct = numeric <= 1 ? numeric * 100 : numeric;
  return Math.min(100, Math.max(0, pct));
}

function normalizeWindDirection(value) {
  const numeric = toNumber(value);
  if (Number.isFinite(numeric)) {
    return degreesToCardinalDirection(numeric);
  }

  const text = `${value || ""}`.trim();
  if (!text) {
    return null;
  }

  const upper = text.toUpperCase();
  if (/^\d+(\.\d+)?$/.test(upper)) {
    return degreesToCardinalDirection(Number(upper));
  }

  return upper;
}

function degreesToCardinalDirection(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const normalized = ((numeric % 360) + 360) % 360;
  const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const index = Math.round(normalized / 22.5) % directions.length;
  return directions[index];
}

function pickRainfallChanceFromRecord(record) {
  const source = toObject(record) || {};
  return firstFiniteNumber(
    normalizeRainfallChance(source.rainfall_chance),
    normalizeRainfallChance(source.rain_chance),
    normalizeRainfallChance(source.precip_probability),
    normalizeRainfallChance(source.precip_chance),
    normalizeRainfallChance(source.chance_of_rain),
    normalizeRainfallChance(source.pop)
  );
}

function pickWindDirectionFromRecord(record) {
  const source = toObject(record) || {};
  return firstNonEmptyString(
    normalizeWindDirection(source.wind_direction),
    normalizeWindDirection(source.wind_dir),
    normalizeWindDirection(source.wind_bearing),
    normalizeWindDirection(source.wind_deg),
    normalizeWindDirection(source.wind_degree)
  );
}

function resolveForecastRunRank(record) {
  const source = toObject(record) || {};
  const candidates = [source.run_date, source.updated_at, source.generated_at_utc, source.timestamp];
  for (const value of candidates) {
    const raw = `${value || ""}`.trim();
    if (!raw) {
      continue;
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.getTime();
    }
  }

  return 0;
}

function buildNext7ForecastRowsFromHistory(history, location) {
  const forecasts = Array.isArray(history?.forecasts) ? history.forecasts : [];
  const normalizedLocation = normalizeLocation(location);
  const groupedByDate = new Map();

  for (const row of forecasts) {
    if (normalizeLocation(row?.location) !== normalizedLocation) {
      continue;
    }

    const dateKey = normalizeDateKey(row?.target_date || row?.date || row?.forecast_date);
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
    const row = toObject(entry?.row) || {};
    const temperature = averageValues(toNumber(row.temp_max), toNumber(row.temp_min));
    if (Number.isFinite(temperature)) {
      temperatures.push(temperature);
    }

    const low = toNumber(row.temp_min);
    if (Number.isFinite(low)) {
      lows.push(low);
    }

    const high = toNumber(row.temp_max);
    if (Number.isFinite(high)) {
      highs.push(high);
    }

    const wind = toNumber(row.wind_max);
    if (Number.isFinite(wind)) {
      winds.push(wind);
    }

    const rainChance = pickRainfallChanceFromRecord(row);
    if (Number.isFinite(rainChance)) {
      rainChances.push(rainChance);
    }

    const windDirection = pickWindDirectionFromRecord(row);
    if (windDirection) {
      windDirections.push(windDirection);
    }

    const rawCondition = `${row.condition || row.summary || row.description || ""}`.trim();
    if (rawCondition && !/^forecast\b/i.test(rawCondition.toLowerCase())) {
      conditions.push(rawCondition);
    }
  }

  return {
    date: dateKey,
    temperature: averageNumberList(temperatures),
    temp_min: lows.length ? Math.min(...lows) : null,
    temp_max: highs.length ? Math.max(...highs) : null,
    wind_kph: averageNumberList(winds),
    wind_direction: mostCommonString(windDirections),
    rainfall_chance: averageNumberList(rainChances),
    condition: conditions[0] || `Forecast snapshot for ${location}.`,
    source_count: entries.length
  };
}

async function loadCustomWatchlistFromJson() {
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

async function saveCustomWatchlistToJson(payload) {
  const normalized = {
    updated_at_utc: payload.updated_at_utc || new Date().toISOString(),
    locations: mergeLocations(payload.locations || [])
  };

  await writeFile(DATA_FILE_PATHS.watchlist, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

async function saveCustomWatchlist(payload, storage = "json") {
  if (storage === "google-sheets" && isGoogleSheetsReady()) {
    await saveCustomWatchlistToGoogleSheets(payload);
    return;
  }

  await saveCustomWatchlistToJson(payload);
}

async function buildDataFileMeta() {
  if (isGoogleSheetsReady()) {
    try {
      const accessToken = await getGoogleAccessToken();
      const titles = await fetchGoogleSheetTitles(accessToken);
      const entries = Object.entries(SHEET_TABLE_DEFS).map(([key, table]) => ([
        key,
        {
          tab: table.tab,
          exists: titles.has(table.tab),
          columns: table.columns.map((col) => col.name)
        }
      ]));
      return Object.fromEntries(entries);
    } catch (error) {
      console.error("Unable to read Google Sheets metadata; falling back to file metadata:", error?.message || error);
    }
  }

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
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
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
