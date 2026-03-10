import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadDotEnv(path.join(__dirname, ".env"));

const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 4173);
const AIBOT_BASE_URL = (process.env.AIBOT_BASE_URL || "http://127.0.0.1:18789").replace(/\/+$/, "");
const AIBOT_TIMEOUT_MS = Number(process.env.AIBOT_TIMEOUT_MS || 8000);

const DAILY_PATHS = getPathCandidates(["AIBOT_DAILY_PATHS", "AIBOT_DAILY_PATH"], [
  "/api/weather/daily",
  "/weather/daily",
  "/api/daily-weather",
  "/api/weather"
]);

const BENCHMARK_PATHS = getPathCandidates(["AIBOT_BENCHMARK_PATHS", "AIBOT_BENCHMARK_PATH"], [
  "/api/weather/benchmark",
  "/weather/benchmark",
  "/api/benchmark"
]);

const HISTORY_PATHS = getPathCandidates(["AIBOT_HISTORY_PATHS", "AIBOT_HISTORY_PATH"], [
  "/api/weather/history",
  "/weather/history",
  "/api/history"
]);

const WATCHLIST_GET_PATHS = getPathCandidates(
  ["AIBOT_WATCHLIST_GET_PATHS", "AIBOT_WATCHLIST_PATHS", "AIBOT_WATCHLIST_PATH"],
  ["/api/weather/watchlist", "/weather/watchlist", "/api/watchlist"]
);

const WATCHLIST_POST_PATHS = getPathCandidates(
  ["AIBOT_WATCHLIST_POST_PATHS", "AIBOT_WATCHLIST_PATHS", "AIBOT_WATCHLIST_PATH"],
  WATCHLIST_GET_PATHS
);

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
        timestamp: new Date().toISOString(),
        aibotBaseUrl: AIBOT_BASE_URL
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
    sendJson(res, 200, {
      ok: true,
      baseUrl: AIBOT_BASE_URL,
      timeoutMs: AIBOT_TIMEOUT_MS,
      paths: {
        daily: DAILY_PATHS,
        benchmark: BENCHMARK_PATHS,
        history: HISTORY_PATHS,
        watchlistGet: WATCHLIST_GET_PATHS,
        watchlistPost: WATCHLIST_POST_PATHS
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

    const [daily, benchmark, history, watchlist] = await Promise.all([
      tryUpstream({ paths: DAILY_PATHS, query: { location } }),
      tryUpstream({ paths: BENCHMARK_PATHS, query: { location } }),
      tryUpstream({ paths: HISTORY_PATHS, query: { location } }),
      tryUpstream({ paths: WATCHLIST_GET_PATHS })
    ]);

    const anySuccess = daily.ok || benchmark.ok || history.ok || watchlist.ok;
    sendJson(res, anySuccess ? 200 : 502, {
      ok: anySuccess,
      location,
      data: {
        daily: daily.ok ? daily.data : null,
        benchmark: benchmark.ok ? benchmark.data : null,
        history: history.ok ? history.data : null,
        watchlist: watchlist.ok ? watchlist.data : null
      },
      upstream: {
        daily: toUpstreamMeta(daily),
        benchmark: toUpstreamMeta(benchmark),
        history: toUpstreamMeta(history),
        watchlist: toUpstreamMeta(watchlist)
      }
    });
    return;
  }

  if (pathname === "/api/weather/daily" && req.method === "GET") {
    await proxyLocationRoute(res, requestUrl, DAILY_PATHS, "daily weather");
    return;
  }

  if (pathname === "/api/weather/benchmark" && req.method === "GET") {
    await proxyLocationRoute(res, requestUrl, BENCHMARK_PATHS, "benchmark");
    return;
  }

  if (pathname === "/api/weather/history" && req.method === "GET") {
    await proxyLocationRoute(res, requestUrl, HISTORY_PATHS, "history");
    return;
  }

  if (pathname === "/api/weather/watchlist" && req.method === "GET") {
    const location = (requestUrl.searchParams.get("location") || "").trim();
    const result = await tryUpstream({
      paths: WATCHLIST_GET_PATHS,
      query: location ? { location } : null
    });

    if (!result.ok) {
      sendJson(res, 502, {
        ok: false,
        error: "Unable to fetch watchlist from Yuen Yuen AIBot.",
        upstream: toUpstreamMeta(result)
      });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      data: result.data,
      upstream: toUpstreamMeta(result)
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

    const addResult = await addLocationToWatchlist(location);
    if (!addResult.ok) {
      sendJson(res, 502, {
        ok: false,
        location,
        error: addResult.error,
        attempts: addResult.attempts
      });
      return;
    }

    const refreshedWatchlist = await tryUpstream({ paths: WATCHLIST_GET_PATHS });

    sendJson(res, 200, {
      ok: true,
      location,
      message: "Location was forwarded to Yuen Yuen AIBot watchlist.",
      addUpstream: toUpstreamMeta(addResult.result),
      watchlist: refreshedWatchlist.ok ? refreshedWatchlist.data : null,
      watchlistUpstream: toUpstreamMeta(refreshedWatchlist)
    });
    return;
  }

  sendJson(res, 404, { ok: false, error: "API route not found." });
}

async function proxyLocationRoute(res, requestUrl, paths, label) {
  const location = (requestUrl.searchParams.get("location") || "").trim();
  if (!location) {
    sendJson(res, 400, { ok: false, error: "Query parameter 'location' is required." });
    return;
  }

  const result = await tryUpstream({ paths, query: { location } });

  if (!result.ok) {
    sendJson(res, 502, {
      ok: false,
      location,
      error: `Unable to fetch ${label} from Yuen Yuen AIBot.`,
      upstream: toUpstreamMeta(result)
    });
    return;
  }

  sendJson(res, 200, {
    ok: true,
    location,
    data: result.data,
    upstream: toUpstreamMeta(result)
  });
}

async function tryUpstream({ paths, method = "GET", query = null, body = undefined }) {
  if (!paths.length) {
    return {
      ok: false,
      status: 0,
      path: null,
      method,
      data: null,
      error: "No upstream paths are configured.",
      attempts: []
    };
  }

  const attempts = [];
  let lastResult = null;

  for (const endpointPath of paths) {
    const result = await attemptUpstream({ endpointPath, method, query, body });
    attempts.push(toAttemptMeta(result));

    if (result.ok) {
      return {
        ...result,
        attempts
      };
    }

    lastResult = result;
  }

  return {
    ...(lastResult || {
      ok: false,
      status: 0,
      path: null,
      method,
      data: null,
      error: "No upstream endpoint returned a successful response."
    }),
    ok: false,
    attempts
  };
}

async function addLocationToWatchlist(location) {
  const plans = [];

  for (const endpointPath of WATCHLIST_POST_PATHS) {
    plans.push({ method: "POST", endpointPath, body: { location } });
    plans.push({ method: "POST", endpointPath, body: { name: location } });
    plans.push({ method: "POST", endpointPath, query: { location } });
    plans.push({ method: "PUT", endpointPath, body: { location } });

    if (!endpointPath.endsWith("/add")) {
      plans.push({
        method: "POST",
        endpointPath: `${endpointPath.replace(/\/+$/, "")}/add`,
        body: { location }
      });
    }
  }

  const uniquePlans = [];
  const seen = new Set();

  for (const plan of plans) {
    const key = JSON.stringify({
      method: plan.method,
      endpointPath: plan.endpointPath,
      body: plan.body || null,
      query: plan.query || null
    });

    if (!seen.has(key)) {
      seen.add(key);
      uniquePlans.push(plan);
    }
  }

  const attempts = [];
  let lastResult = null;

  for (const plan of uniquePlans) {
    const result = await attemptUpstream(plan);
    attempts.push(toAttemptMeta(result));

    if (result.ok) {
      return {
        ok: true,
        result: {
          ...result,
          attempts
        },
        attempts
      };
    }

    lastResult = result;
  }

  return {
    ok: false,
    error: lastResult?.error || "Unable to add location to watchlist upstream.",
    attempts
  };
}

async function attemptUpstream({ endpointPath, method = "GET", query = null, body = undefined }) {
  const url = new URL(`${AIBOT_BASE_URL}${normalizePath(endpointPath)}`);

  if (query && typeof query === "object") {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && `${value}`.trim() !== "") {
        url.searchParams.set(key, `${value}`);
      }
    }
  }

  const headers = {
    Accept: "application/json, text/plain;q=0.9, */*;q=0.8"
  };

  let payload;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AIBOT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: payload,
      signal: controller.signal
    });

    const text = await response.text();
    const contentType = response.headers.get("content-type") || "";
    const data = parseResponseBody(text, contentType);

    return {
      ok: response.ok,
      status: response.status,
      method,
      path: normalizePath(endpointPath),
      data,
      error: response.ok ? null : toErrorMessage(data, response.statusText || "Upstream request failed.")
    };
  } catch (error) {
    const timeoutError = error?.name === "AbortError";
    return {
      ok: false,
      status: 0,
      method,
      path: normalizePath(endpointPath),
      data: null,
      error: timeoutError
        ? `Upstream request timed out after ${AIBOT_TIMEOUT_MS}ms.`
        : (error?.message || "Failed to contact upstream service.")
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseResponseBody(text, contentType) {
  if (!text) {
    return null;
  }

  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return { raw: text };
    }
  }

  return text;
}

function toErrorMessage(data, fallback) {
  if (typeof data === "string") {
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

function toUpstreamMeta(result) {
  return {
    ok: Boolean(result?.ok),
    path: result?.path || null,
    status: Number(result?.status || 0),
    method: result?.method || "GET",
    error: result?.error || null,
    attempts: Array.isArray(result?.attempts) ? result.attempts : []
  };
}

function toAttemptMeta(result) {
  return {
    ok: Boolean(result.ok),
    path: result.path,
    method: result.method,
    status: result.status,
    error: result.error || null
  };
}

function normalizePath(rawPath) {
  if (!rawPath) {
    return "";
  }

  const value = `${rawPath}`.trim();
  if (!value) {
    return "";
  }

  if (value.startsWith("http://") || value.startsWith("https://")) {
    try {
      const parsed = new URL(value);
      return parsed.pathname || "/";
    } catch {
      return "";
    }
  }

  const withSlash = value.startsWith("/") ? value : `/${value}`;
  return withSlash.replace(/\/{2,}/g, "/");
}

function getPathCandidates(envKeys, fallbackPaths) {
  const fromEnv = [];

  for (const key of envKeys) {
    const rawValue = process.env[key];
    if (!rawValue) {
      continue;
    }

    const pieces = rawValue.split(",");
    for (const piece of pieces) {
      const normalized = normalizePath(piece);
      if (normalized) {
        fromEnv.push(normalized);
      }
    }
  }

  const all = [...fromEnv, ...fallbackPaths.map((item) => normalizePath(item))].filter(Boolean);
  return [...new Set(all)];
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
