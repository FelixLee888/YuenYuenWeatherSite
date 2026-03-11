#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

const DATA_FILES = {
  weather_latest_report: "weather_latest_report.json",
  weather_benchmarks_latest: "weather_benchmarks_latest.json",
  weather_history_recent: "weather_history_recent.json"
};

const SOURCE_BUCKETS = ["configured", "available", "used_for_report", "missing_api_keys", "skipped_errors"];

const TABLE_DEFS = {
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
  latest_next7: {
    tab: "weather_latest_report_next7",
    columns: [
      { name: "zone_order", type: "integer" },
      { name: "name", type: "string" },
      { name: "source_order", type: "integer" },
      { name: "source", type: "string" },
      { name: "source_label", type: "string" },
      { name: "day_order", type: "integer" },
      { name: "date", type: "string" },
      { name: "temp_min", type: "nullable_number" },
      { name: "temp_max", type: "nullable_number" },
      { name: "wind_max", type: "nullable_number" },
      { name: "rainfall_chance", type: "nullable_number" },
      { name: "wind_direction", type: "nullable_string" },
      { name: "condition", type: "nullable_string" },
      { name: "source_count", type: "nullable_integer" }
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

function parseArgs(argv) {
  const args = {
    command: "",
    spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID || "",
    dataDir: process.env.WEATHER_DATA_DIR || "public/data",
    includeWatchlistJson: (process.env.WEATHER_INCLUDE_WATCHLIST_JSON || "0").trim() === "1"
  };

  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--spreadsheet-id" && next) {
      args.spreadsheetId = next;
      i += 1;
      continue;
    }

    if (arg === "--data-dir" && next) {
      args.dataDir = next;
      i += 1;
      continue;
    }

    if (arg === "--include-watchlist-json") {
      args.includeWatchlistJson = true;
      continue;
    }

    positional.push(arg);
  }

  args.command = positional[0] || "";

  if (!args.spreadsheetId) {
    throw new Error("Missing spreadsheet id. Set GOOGLE_SHEETS_SPREADSHEET_ID or pass --spreadsheet-id.");
  }

  return args;
}

function base64Url(input) {
  const raw = Buffer.isBuffer(input) ? input.toString("base64") : Buffer.from(input).toString("base64");
  return raw.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function resolveServiceAccountCredentials() {
  const asJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON || "";
  if (asJson) {
    const payload = JSON.parse(asJson);
    const email = payload.client_email || "";
    const privateKey = (payload.private_key || "").replace(/\\n/g, "\n");
    if (email && privateKey) {
      return { clientEmail: email, privateKey };
    }
  }

  const email =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    process.env.GOOGLE_CLIENT_EMAIL ||
    process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL ||
    "";

  const privateKey = (
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ||
    process.env.GOOGLE_PRIVATE_KEY ||
    process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY ||
    ""
  ).replace(/\\n/g, "\n");

  if (!email || !privateKey) {
    throw new Error(
      "Missing Google service account credentials. Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY."
    );
  }

  return { clientEmail: email, privateKey };
}

async function fetchGoogleAccessToken() {
  const directToken = (process.env.GOOGLE_OAUTH_ACCESS_TOKEN || "").trim();
  if (directToken) {
    return directToken;
  }

  const { clientEmail, privateKey } = resolveServiceAccountCredentials();
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file",
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now
  };

  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey);
  const assertion = `${signingInput}.${base64Url(signature)}`;

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  const payload = await response.json();
  if (!response.ok || !payload?.access_token) {
    throw new Error(`Failed to get Google access token: ${JSON.stringify(payload)}`);
  }

  return payload.access_token;
}

async function sheetsRequest(accessToken, spreadsheetId, apiPath, { method = "GET", body } = {}) {
  const url = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}${apiPath}`;
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
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(`Sheets API ${method} ${apiPath} failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  return payload;
}

function quoteSheetTitle(title) {
  return `'${title.replace(/'/g, "''")}'`;
}

function toCellValue(value, type) {
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

function parseCellValue(raw, type) {
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
    if (!Number.isFinite(n)) {
      return null;
    }
    return Math.trunc(n);
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

function sortRows(rows, ...keys) {
  return [...rows].sort((left, right) => {
    for (const key of keys) {
      const lv = left[key];
      const rv = right[key];

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

async function ensureSheets(accessToken, spreadsheetId) {
  const sheetDoc = await sheetsRequest(accessToken, spreadsheetId, "?includeGridData=false");
  const existing = new Set(
    Array.isArray(sheetDoc?.sheets)
      ? sheetDoc.sheets
          .map((item) => `${item?.properties?.title || ""}`.trim())
          .filter(Boolean)
      : []
  );

  const requests = [];
  for (const table of Object.values(TABLE_DEFS)) {
    if (existing.has(table.tab)) {
      continue;
    }

    requests.push({
      addSheet: {
        properties: {
          title: table.tab
        }
      }
    });
  }

  if (requests.length > 0) {
    await sheetsRequest(accessToken, spreadsheetId, ":batchUpdate", {
      method: "POST",
      body: { requests }
    });
  }
}

async function writeTableRows(accessToken, spreadsheetId, tableKey, rows) {
  const table = TABLE_DEFS[tableKey];
  if (!table) {
    throw new Error(`Unknown table key: ${tableKey}`);
  }

  const header = table.columns.map((column) => column.name);
  const values = [
    header,
    ...rows.map((row) => table.columns.map((column) => toCellValue(row[column.name], column.type)))
  ];

  const range = `${quoteSheetTitle(table.tab)}!A:ZZ`;
  await sheetsRequest(accessToken, spreadsheetId, `/values/${encodeURIComponent(range)}:clear`, {
    method: "POST",
    body: {}
  });

  await sheetsRequest(accessToken, spreadsheetId, `/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: "PUT",
    body: { values }
  });
}

async function readTableRows(accessToken, spreadsheetId, tableKey) {
  const table = TABLE_DEFS[tableKey];
  if (!table) {
    throw new Error(`Unknown table key: ${tableKey}`);
  }

  const range = `${quoteSheetTitle(table.tab)}!A:ZZ`;
  const payload = await sheetsRequest(accessToken, spreadsheetId, `/values/${encodeURIComponent(range)}`);
  const values = Array.isArray(payload?.values) ? payload.values : [];

  if (!values.length) {
    return [];
  }

  const header = values[0].map((item) => `${item}`);
  const indexByColumn = new Map();
  table.columns.forEach((column) => {
    indexByColumn.set(column.name, header.indexOf(column.name));
  });

  const rows = [];
  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    const sourceRow = values[rowIndex];
    const row = {};
    let hasAnyValue = false;

    for (const column of table.columns) {
      const columnIndex = indexByColumn.get(column.name);
      const raw = columnIndex >= 0 ? sourceRow[columnIndex] : "";
      if (`${raw ?? ""}` !== "") {
        hasAnyValue = true;
      }
      row[column.name] = parseCellValue(raw, column.type);
    }

    if (hasAnyValue) {
      rows.push(row);
    }
  }

  return rows;
}

async function readLocalJson(dataDir, filename) {
  const filePath = path.resolve(process.cwd(), dataDir, filename);
  const text = await fs.readFile(filePath, "utf8");
  return JSON.parse(text);
}

async function writeLocalJson(dataDir, filename, value) {
  const targetDir = path.resolve(process.cwd(), dataDir);
  await fs.mkdir(targetDir, { recursive: true });

  const filePath = path.join(targetDir, filename);
  const body = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(filePath, body, "utf8");
}

function toNullableNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string" && value.trim() === "") {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function pickRainfallChanceFromPayload(source) {
  if (!source || typeof source !== "object") {
    return null;
  }

  const candidates = [
    source.rainfall_chance,
    source.rain_chance,
    source.precip_probability,
    source.precip_chance,
    source.chance_of_rain,
    source.pop
  ];

  for (const value of candidates) {
    const numeric = toNullableNumber(value);
    if (numeric !== null) {
      return numeric;
    }
  }

  return null;
}

function pickWindDirectionFromPayload(source) {
  if (!source || typeof source !== "object") {
    return "";
  }

  const candidates = [
    source.wind_direction,
    source.wind_dir,
    source.wind_bearing,
    source.wind_deg,
    source.wind_degree
  ];

  for (const value of candidates) {
    const text = `${value ?? ""}`.trim();
    if (text) {
      return text;
    }
  }

  return "";
}

function extractNext7Rows(source) {
  if (!source || typeof source !== "object") {
    return [];
  }

  const candidates = [
    source.next_7_days,
    source.next7,
    source.next7_days,
    source.seven_day_outlook,
    source.outlook_7_days
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function normalizeNext7Row(raw) {
  const row = raw && typeof raw === "object" ? raw : {};
  const date = `${row.date ?? row.target_date ?? row.forecast_date ?? ""}`.trim();
  if (!date) {
    return null;
  }

  return {
    date,
    temp_min: toNullableNumber(row.temp_min ?? row.low),
    temp_max: toNullableNumber(row.temp_max ?? row.high),
    wind_max: toNullableNumber(row.wind_max ?? row.wind_kph ?? row.wind),
    rainfall_chance: pickRainfallChanceFromPayload(row),
    wind_direction: pickWindDirectionFromPayload(row),
    condition: `${row.condition ?? row.summary ?? row.description ?? ""}`.trim() || null,
    source_count: toNullableNumber(row.source_count ?? row.sourceCount)
  };
}

function latestJsonToTables(latest) {
  const payload = latest && typeof latest === "object" ? latest : {};

  const latestMeta = [
    {
      generated_at_utc: payload.generated_at_utc ?? null,
      mode: payload.mode ?? "",
      run_date: payload.run_date ?? "",
      forecast_date: payload.forecast_date ?? "",
      eval_date: payload.eval_date ?? "",
      lookback_days: payload.lookback_days ?? null
    }
  ];

  const latestSources = [];
  const sources = payload.sources && typeof payload.sources === "object" ? payload.sources : {};
  for (const bucket of SOURCE_BUCKETS) {
    const items = Array.isArray(sources[bucket]) ? sources[bucket] : [];
    for (let index = 0; index < items.length; index += 1) {
      latestSources.push({
        bucket,
        item_order: index,
        source: `${items[index] ?? ""}`
      });
    }
  }

  const latestZones = [];
  const latestZoneSources = [];
  const latestNext7 = [];
  const zones = Array.isArray(payload.zones) ? payload.zones : [];
  for (let zoneOrder = 0; zoneOrder < zones.length; zoneOrder += 1) {
    const zone = zones[zoneOrder] && typeof zones[zoneOrder] === "object" ? zones[zoneOrder] : {};
    const ensemble = zone.ensemble && typeof zone.ensemble === "object" ? zone.ensemble : {};
    const suitability = zone.suitability && typeof zone.suitability === "object" ? zone.suitability : {};

    latestZones.push({
      zone_order: zoneOrder,
      name: `${zone.name ?? ""}`,
      lat: zone.lat ?? null,
      lon: zone.lon ?? null,
      ensemble_temp_min: ensemble.temp_min ?? null,
      ensemble_temp_max: ensemble.temp_max ?? null,
      ensemble_wind_max: ensemble.wind_max ?? null,
      ensemble_rainfall_chance: pickRainfallChanceFromPayload(ensemble) ?? pickRainfallChanceFromPayload(zone),
      ensemble_wind_direction: pickWindDirectionFromPayload(ensemble) || pickWindDirectionFromPayload(zone),
      ensemble_spread_temp: ensemble.spread_temp ?? null,
      ensemble_spread_wind: ensemble.spread_wind ?? null,
      briefing: `${zone.briefing ?? ""}`,
      suitability_cycling: `${suitability.cycling ?? ""}`,
      suitability_hiking: `${suitability.hiking ?? ""}`,
      suitability_skiing: `${suitability.skiing ?? ""}`
    });

    const ensembleNext7 = extractNext7Rows(zone);
    for (let dayOrder = 0; dayOrder < ensembleNext7.length; dayOrder += 1) {
      const normalized = normalizeNext7Row(ensembleNext7[dayOrder]);
      if (!normalized) {
        continue;
      }
      latestNext7.push({
        zone_order: zoneOrder,
        name: `${zone.name ?? ""}`,
        source_order: -1,
        source: "ensemble",
        source_label: "Ensemble",
        day_order: dayOrder,
        date: normalized.date,
        temp_min: normalized.temp_min,
        temp_max: normalized.temp_max,
        wind_max: normalized.wind_max,
        rainfall_chance: normalized.rainfall_chance,
        wind_direction: normalized.wind_direction,
        condition: normalized.condition,
        source_count: normalized.source_count
      });
    }

    const sourceForecasts = zone.source_forecasts && typeof zone.source_forecasts === "object" ? zone.source_forecasts : {};
    let sourceOrder = 0;
    for (const [source, metricsRaw] of Object.entries(sourceForecasts)) {
      const metrics = metricsRaw && typeof metricsRaw === "object" ? metricsRaw : {};
      latestZoneSources.push({
        zone_order: zoneOrder,
        name: `${zone.name ?? ""}`,
        source_order: sourceOrder,
        source,
        source_label: `${metrics.source_label ?? source}`,
        temp_min: metrics.temp_min ?? null,
        temp_max: metrics.temp_max ?? null,
        wind_max: metrics.wind_max ?? null,
        rainfall_chance: pickRainfallChanceFromPayload(metrics),
        wind_direction: pickWindDirectionFromPayload(metrics)
      });

      const sourceNext7 = extractNext7Rows(metrics);
      for (let dayOrder = 0; dayOrder < sourceNext7.length; dayOrder += 1) {
        const normalized = normalizeNext7Row(sourceNext7[dayOrder]);
        if (!normalized) {
          continue;
        }
        latestNext7.push({
          zone_order: zoneOrder,
          name: `${zone.name ?? ""}`,
          source_order: sourceOrder,
          source,
          source_label: `${metrics.source_label ?? source}`,
          day_order: dayOrder,
          date: normalized.date,
          temp_min: normalized.temp_min,
          temp_max: normalized.temp_max,
          wind_max: normalized.wind_max,
          rainfall_chance: normalized.rainfall_chance,
          wind_direction: normalized.wind_direction,
          condition: normalized.condition,
          source_count: normalized.source_count
        });
      }
      sourceOrder += 1;
    }
  }

  const latestMwisLinks = [];
  const links = Array.isArray(payload.mwis_pdf_links) ? payload.mwis_pdf_links : [];
  for (let linkOrder = 0; linkOrder < links.length; linkOrder += 1) {
    latestMwisLinks.push({
      link_order: linkOrder,
      link: `${links[linkOrder] ?? ""}`
    });
  }

  return {
    latest_meta: latestMeta,
    latest_sources: latestSources,
    latest_zones: latestZones,
    latest_zone_sources: latestZoneSources,
    latest_next7: latestNext7,
    latest_mwis_links: latestMwisLinks
  };
}

function benchmarksJsonToTables(benchmarks) {
  const payload = benchmarks && typeof benchmarks === "object" ? benchmarks : {};

  const benchmarksMeta = [
    {
      generated_at_utc: payload.generated_at_utc ?? null,
      run_date: payload.run_date ?? "",
      eval_date: payload.eval_date ?? "",
      lookback_days: payload.lookback_days ?? null
    }
  ];

  const benchmarksSources = [];
  const sourceRows = Array.isArray(payload.sources) ? payload.sources : [];
  for (let sourceOrder = 0; sourceOrder < sourceRows.length; sourceOrder += 1) {
    const row = sourceRows[sourceOrder] && typeof sourceRows[sourceOrder] === "object" ? sourceRows[sourceOrder] : {};
    benchmarksSources.push({
      source_order: sourceOrder,
      source: `${row.source ?? ""}`,
      source_label: `${row.source_label ?? ""}`,
      is_available: Boolean(row.is_available),
      is_missing_api_key: Boolean(row.is_missing_api_key),
      is_skipped_error: Boolean(row.is_skipped_error),
      runtime_note: `${row.runtime_note ?? ""}`,
      latest_confidence: row.latest_confidence ?? null,
      mae_temp_max: row.mae_temp_max ?? null,
      mae_temp_min: row.mae_temp_min ?? null,
      mae_wind_max: row.mae_wind_max ?? null,
      composite_error: row.composite_error ?? null,
      sample_count: row.sample_count ?? null,
      rolling_confidence: row.rolling_confidence ?? null,
      rolling_error: row.rolling_error ?? null,
      rolling_samples: row.rolling_samples ?? null,
      ensemble_weight: row.ensemble_weight ?? null,
      ensemble_weight_pct: row.ensemble_weight_pct ?? null
    });
  }

  return {
    benchmarks_meta: benchmarksMeta,
    benchmarks_sources: benchmarksSources
  };
}

function historyJsonToTables(history) {
  const payload = history && typeof history === "object" ? history : {};

  const historyMeta = [
    {
      generated_at_utc: payload.generated_at_utc ?? null,
      run_date: payload.run_date ?? "",
      window_days: payload.window_days ?? null,
      start_date: payload.start_date ?? ""
    }
  ];

  const historySourceScores = [];
  const sourceScores = Array.isArray(payload.source_scores) ? payload.source_scores : [];
  for (let rowOrder = 0; rowOrder < sourceScores.length; rowOrder += 1) {
    const row = sourceScores[rowOrder] && typeof sourceScores[rowOrder] === "object" ? sourceScores[rowOrder] : {};
    historySourceScores.push({
      row_order: rowOrder,
      date: `${row.date ?? ""}`,
      source: `${row.source ?? ""}`,
      source_label: `${row.source_label ?? ""}`,
      mae_temp_max: row.mae_temp_max ?? null,
      mae_temp_min: row.mae_temp_min ?? null,
      mae_wind_max: row.mae_wind_max ?? null,
      composite_error: row.composite_error ?? null,
      confidence: row.confidence ?? null,
      sample_count: row.sample_count ?? null
    });
  }

  const historySourceWeights = [];
  const sourceWeights = Array.isArray(payload.source_weights) ? payload.source_weights : [];
  for (let rowOrder = 0; rowOrder < sourceWeights.length; rowOrder += 1) {
    const row = sourceWeights[rowOrder] && typeof sourceWeights[rowOrder] === "object" ? sourceWeights[rowOrder] : {};
    historySourceWeights.push({
      row_order: rowOrder,
      date: `${row.date ?? ""}`,
      source: `${row.source ?? ""}`,
      source_label: `${row.source_label ?? ""}`,
      weight: row.weight ?? null,
      weight_pct: row.weight_pct ?? null,
      rolling_confidence: row.rolling_confidence ?? null,
      lookback_days: row.lookback_days ?? null
    });
  }

  const historyActuals = [];
  const actuals = Array.isArray(payload.actuals) ? payload.actuals : [];
  for (let rowOrder = 0; rowOrder < actuals.length; rowOrder += 1) {
    const row = actuals[rowOrder] && typeof actuals[rowOrder] === "object" ? actuals[rowOrder] : {};
    historyActuals.push({
      row_order: rowOrder,
      date: `${row.date ?? ""}`,
      location: `${row.location ?? ""}`,
      lat: row.lat ?? null,
      lon: row.lon ?? null,
      temp_max: row.temp_max ?? null,
      temp_min: row.temp_min ?? null,
      wind_max: row.wind_max ?? null,
      rainfall_chance: row.rainfall_chance ?? row.rain_chance ?? row.precip_probability ?? null,
      wind_direction: `${row.wind_direction ?? row.wind_dir ?? ""}`
    });
  }

  const historyForecasts = [];
  const forecasts = Array.isArray(payload.forecasts) ? payload.forecasts : [];
  for (let rowOrder = 0; rowOrder < forecasts.length; rowOrder += 1) {
    const row = forecasts[rowOrder] && typeof forecasts[rowOrder] === "object" ? forecasts[rowOrder] : {};
    historyForecasts.push({
      row_order: rowOrder,
      run_date: `${row.run_date ?? ""}`,
      target_date: `${row.target_date ?? ""}`,
      source: `${row.source ?? ""}`,
      source_label: `${row.source_label ?? ""}`,
      location: `${row.location ?? ""}`,
      temp_max: row.temp_max ?? null,
      temp_min: row.temp_min ?? null,
      wind_max: row.wind_max ?? null,
      rainfall_chance: row.rainfall_chance ?? row.rain_chance ?? row.precip_probability ?? null,
      wind_direction: `${row.wind_direction ?? row.wind_dir ?? ""}`
    });
  }

  return {
    history_meta: historyMeta,
    history_source_scores: historySourceScores,
    history_source_weights: historySourceWeights,
    history_actuals: historyActuals,
    history_forecasts: historyForecasts
  };
}

function watchlistJsonToTable(watchlist) {
  const payload = watchlist && typeof watchlist === "object" ? watchlist : {};
  const updatedAt = payload.updated_at_utc ?? null;
  const locations = Array.isArray(payload.locations) ? payload.locations : [];

  const rows = [];
  for (let locationOrder = 0; locationOrder < locations.length; locationOrder += 1) {
    rows.push({
      location_order: locationOrder,
      location: `${locations[locationOrder] ?? ""}`,
      updated_at_utc: updatedAt
    });
  }

  if (!rows.length) {
    rows.push({
      location_order: 0,
      location: "",
      updated_at_utc: updatedAt
    });
  }

  return { watchlist: rows };
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

  for (const row of sortRows(tables.latest_sources || [], "bucket", "item_order")) {
    const bucket = `${row.bucket || ""}`;
    if (!Object.prototype.hasOwnProperty.call(sources, bucket)) {
      continue;
    }
    const source = `${row.source || ""}`.trim();
    if (!source) {
      continue;
    }
    sources[bucket].push(source);
  }

  const zoneMap = new Map();
  for (const row of sortRows(tables.latest_zones || [], "zone_order")) {
    const zoneOrder = Number(row.zone_order);
    if (!Number.isFinite(zoneOrder)) {
      continue;
    }

    zoneMap.set(zoneOrder, {
      name: `${row.name || ""}`,
      lat: row.lat ?? null,
      lon: row.lon ?? null,
      ensemble: {
        temp_min: row.ensemble_temp_min ?? null,
        temp_max: row.ensemble_temp_max ?? null,
        wind_max: row.ensemble_wind_max ?? null,
        ...(row.ensemble_rainfall_chance !== null && row.ensemble_rainfall_chance !== undefined
          ? { rainfall_chance: row.ensemble_rainfall_chance }
          : {}),
        ...(`${row.ensemble_wind_direction || ""}`.trim() ? { wind_direction: `${row.ensemble_wind_direction}`.trim() } : {}),
        spread_temp: row.ensemble_spread_temp ?? null,
        spread_wind: row.ensemble_spread_wind ?? null
      },
      briefing: `${row.briefing || ""}`,
      suitability: {
        cycling: `${row.suitability_cycling || ""}`,
        hiking: `${row.suitability_hiking || ""}`,
        skiing: `${row.suitability_skiing || ""}`
      },
      source_forecasts: {}
    });
  }

  for (const row of sortRows(tables.latest_zone_sources || [], "zone_order", "source_order")) {
    const zoneOrder = Number(row.zone_order);
    if (!Number.isFinite(zoneOrder)) {
      continue;
    }

    if (!zoneMap.has(zoneOrder)) {
      zoneMap.set(zoneOrder, {
        name: `${row.name || ""}`,
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
        suitability: {
          cycling: "",
          hiking: "",
          skiing: ""
        },
        source_forecasts: {}
      });
    }

    const source = `${row.source || ""}`.trim();
    if (!source) {
      continue;
    }

    zoneMap.get(zoneOrder).source_forecasts[source] = {
      source_label: `${row.source_label || source}`,
      temp_min: row.temp_min ?? null,
      temp_max: row.temp_max ?? null,
      wind_max: row.wind_max ?? null,
      ...(row.rainfall_chance !== null && row.rainfall_chance !== undefined ? { rainfall_chance: row.rainfall_chance } : {}),
      ...(`${row.wind_direction || ""}`.trim() ? { wind_direction: `${row.wind_direction}`.trim() } : {})
    };
  }

  const next7ByZone = new Map();
  for (const row of sortRows(tables.latest_next7 || [], "zone_order", "source_order", "day_order")) {
    const zoneOrder = Number(row.zone_order);
    if (!Number.isFinite(zoneOrder)) {
      continue;
    }

    if (!zoneMap.has(zoneOrder)) {
      zoneMap.set(zoneOrder, {
        name: `${row.name || ""}`,
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
        suitability: {
          cycling: "",
          hiking: "",
          skiing: ""
        },
        source_forecasts: {}
      });
    }

    const source = `${row.source || ""}`.trim() || "ensemble";
    const sourceLabel = `${row.source_label || source}`.trim() || source;
    if (!next7ByZone.has(zoneOrder)) {
      next7ByZone.set(zoneOrder, new Map());
    }
    const bySource = next7ByZone.get(zoneOrder);
    if (!bySource.has(source)) {
      bySource.set(source, {
        sourceLabel,
        entries: []
      });
    }

    const date = `${row.date || ""}`.trim();
    if (!date) {
      continue;
    }

    const entry = {
      date,
      temp_min: row.temp_min ?? null,
      temp_max: row.temp_max ?? null,
      wind_max: row.wind_max ?? null,
      ...(row.rainfall_chance !== null && row.rainfall_chance !== undefined ? { rainfall_chance: row.rainfall_chance } : {}),
      ...(`${row.wind_direction || ""}`.trim() ? { wind_direction: `${row.wind_direction}`.trim() } : {}),
      ...(`${row.condition || ""}`.trim() ? { condition: `${row.condition}`.trim() } : {}),
      ...(row.source_count !== null && row.source_count !== undefined ? { source_count: row.source_count } : {})
    };

    bySource.get(source).entries.push(entry);
  }

  for (const [zoneOrder, bySource] of next7ByZone.entries()) {
    const zone = zoneMap.get(zoneOrder);
    if (!zone) {
      continue;
    }

    for (const [source, sourceData] of bySource.entries()) {
      const entries = Array.isArray(sourceData?.entries) ? sourceData.entries : [];
      if (!entries.length) {
        continue;
      }

      if (source === "ensemble") {
        zone.next_7_days = entries;
        continue;
      }

      if (!zone.source_forecasts[source]) {
        zone.source_forecasts[source] = {
          source_label: `${sourceData?.sourceLabel || source}`
        };
      } else if (!`${zone.source_forecasts[source]?.source_label || ""}`.trim()) {
        zone.source_forecasts[source].source_label = `${sourceData?.sourceLabel || source}`;
      }

      zone.source_forecasts[source].next_7_days = entries;
    }
  }

  const zones = Array.from(zoneMap.entries())
    .sort((left, right) => left[0] - right[0])
    .map((entry) => entry[1]);

  const mwisPdfLinks = sortRows(tables.latest_mwis_links || [], "link_order")
    .map((row) => `${row.link || ""}`.trim())
    .filter(Boolean);

  return {
    generated_at_utc: metaRow.generated_at_utc ?? null,
    mode: `${metaRow.mode || ""}`,
    run_date: `${metaRow.run_date || ""}`,
    forecast_date: `${metaRow.forecast_date || ""}`,
    eval_date: `${metaRow.eval_date || ""}`,
    lookback_days: metaRow.lookback_days ?? null,
    sources,
    zones,
    mwis_pdf_links: mwisPdfLinks
  };
}

function benchmarksTablesToJson(tables) {
  const metaRow = (tables.benchmarks_meta || [])[0] || {};

  const sources = sortRows(tables.benchmarks_sources || [], "source_order").map((row) => ({
    source: `${row.source || ""}`,
    source_label: `${row.source_label || ""}`,
    is_available: Boolean(row.is_available),
    is_missing_api_key: Boolean(row.is_missing_api_key),
    is_skipped_error: Boolean(row.is_skipped_error),
    runtime_note: `${row.runtime_note || ""}`,
    latest_confidence: row.latest_confidence ?? null,
    mae_temp_max: row.mae_temp_max ?? null,
    mae_temp_min: row.mae_temp_min ?? null,
    mae_wind_max: row.mae_wind_max ?? null,
    composite_error: row.composite_error ?? null,
    sample_count: row.sample_count ?? null,
    rolling_confidence: row.rolling_confidence ?? null,
    rolling_error: row.rolling_error ?? null,
    rolling_samples: row.rolling_samples ?? null,
    ensemble_weight: row.ensemble_weight ?? null,
    ensemble_weight_pct: row.ensemble_weight_pct ?? null
  }));

  return {
    generated_at_utc: metaRow.generated_at_utc ?? null,
    run_date: `${metaRow.run_date || ""}`,
    eval_date: `${metaRow.eval_date || ""}`,
    lookback_days: metaRow.lookback_days ?? null,
    sources
  };
}

function historyTablesToJson(tables) {
  const metaRow = (tables.history_meta || [])[0] || {};

  const sourceScores = sortRows(tables.history_source_scores || [], "row_order").map((row) => ({
    date: `${row.date || ""}`,
    source: `${row.source || ""}`,
    source_label: `${row.source_label || ""}`,
    mae_temp_max: row.mae_temp_max ?? null,
    mae_temp_min: row.mae_temp_min ?? null,
    mae_wind_max: row.mae_wind_max ?? null,
    composite_error: row.composite_error ?? null,
    confidence: row.confidence ?? null,
    sample_count: row.sample_count ?? null
  }));

  const sourceWeights = sortRows(tables.history_source_weights || [], "row_order").map((row) => ({
    date: `${row.date || ""}`,
    source: `${row.source || ""}`,
    source_label: `${row.source_label || ""}`,
    weight: row.weight ?? null,
    weight_pct: row.weight_pct ?? null,
    rolling_confidence: row.rolling_confidence ?? null,
    lookback_days: row.lookback_days ?? null
  }));

  const actuals = sortRows(tables.history_actuals || [], "row_order").map((row) => ({
    date: `${row.date || ""}`,
    location: `${row.location || ""}`,
    lat: row.lat ?? null,
    lon: row.lon ?? null,
    temp_max: row.temp_max ?? null,
    temp_min: row.temp_min ?? null,
    wind_max: row.wind_max ?? null,
    ...(row.rainfall_chance !== null && row.rainfall_chance !== undefined ? { rainfall_chance: row.rainfall_chance } : {}),
    ...(`${row.wind_direction || ""}`.trim() ? { wind_direction: `${row.wind_direction}`.trim() } : {})
  }));

  const forecasts = sortRows(tables.history_forecasts || [], "row_order").map((row) => ({
    run_date: `${row.run_date || ""}`,
    target_date: `${row.target_date || ""}`,
    source: `${row.source || ""}`,
    source_label: `${row.source_label || ""}`,
    location: `${row.location || ""}`,
    temp_max: row.temp_max ?? null,
    temp_min: row.temp_min ?? null,
    wind_max: row.wind_max ?? null,
    ...(row.rainfall_chance !== null && row.rainfall_chance !== undefined ? { rainfall_chance: row.rainfall_chance } : {}),
    ...(`${row.wind_direction || ""}`.trim() ? { wind_direction: `${row.wind_direction}`.trim() } : {})
  }));

  return {
    generated_at_utc: metaRow.generated_at_utc ?? null,
    run_date: `${metaRow.run_date || ""}`,
    window_days: metaRow.window_days ?? null,
    start_date: `${metaRow.start_date || ""}`,
    source_scores: sourceScores,
    source_weights: sourceWeights,
    actuals,
    forecasts
  };
}

function watchlistTableToJson(tables) {
  const rows = sortRows(tables.watchlist || [], "location_order");
  const updatedAt = rows.length ? rows[0].updated_at_utc ?? null : null;

  const locations = rows
    .map((row) => `${row.location || ""}`.trim())
    .filter(Boolean);

  return {
    updated_at_utc: updatedAt,
    locations
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (value && typeof value === "object") {
    const sortedKeys = Object.keys(value).sort();
    const out = {};
    for (const key of sortedKeys) {
      out[key] = canonicalize(value[key]);
    }
    return out;
  }

  return value;
}

async function importFromJson(args) {
  const accessToken = await fetchGoogleAccessToken();
  await ensureSheets(accessToken, args.spreadsheetId);

  const latest = await readLocalJson(args.dataDir, DATA_FILES.weather_latest_report);
  const benchmarks = await readLocalJson(args.dataDir, DATA_FILES.weather_benchmarks_latest);
  const history = await readLocalJson(args.dataDir, DATA_FILES.weather_history_recent);

  const tableRows = {
    ...latestJsonToTables(latest),
    ...benchmarksJsonToTables(benchmarks),
    ...historyJsonToTables(history)
  };

  if (args.includeWatchlistJson) {
    const watchlist = await readLocalJson(args.dataDir, "weather_watchlist.json");
    Object.assign(tableRows, watchlistJsonToTable(watchlist));
  }

  for (const [tableKey, rows] of Object.entries(tableRows)) {
    await writeTableRows(accessToken, args.spreadsheetId, tableKey, rows);
    console.log(`Imported ${rows.length} row(s) into sheet tab '${TABLE_DEFS[tableKey].tab}'`);
  }
}

async function exportToJson(args) {
  const accessToken = await fetchGoogleAccessToken();
  await ensureSheets(accessToken, args.spreadsheetId);

  const tables = {};
  for (const tableKey of Object.keys(TABLE_DEFS)) {
    tables[tableKey] = await readTableRows(accessToken, args.spreadsheetId, tableKey);
  }

  const latest = latestTablesToJson(tables);
  const benchmarks = benchmarksTablesToJson(tables);
  const history = historyTablesToJson(tables);

  await writeLocalJson(args.dataDir, DATA_FILES.weather_latest_report, latest);
  await writeLocalJson(args.dataDir, DATA_FILES.weather_benchmarks_latest, benchmarks);
  await writeLocalJson(args.dataDir, DATA_FILES.weather_history_recent, history);

  if (args.includeWatchlistJson) {
    const watchlist = watchlistTableToJson(tables);
    await writeLocalJson(args.dataDir, "weather_watchlist.json", watchlist);
  }

  console.log("Exported Google Sheet tabular data back into public/data JSON snapshots.");
}

async function verifyRoundtrip(args) {
  const accessToken = await fetchGoogleAccessToken();
  await ensureSheets(accessToken, args.spreadsheetId);

  const tables = {};
  for (const tableKey of Object.keys(TABLE_DEFS)) {
    tables[tableKey] = await readTableRows(accessToken, args.spreadsheetId, tableKey);
  }

  const remoteByFile = {
    [DATA_FILES.weather_latest_report]: latestTablesToJson(tables),
    [DATA_FILES.weather_benchmarks_latest]: benchmarksTablesToJson(tables),
    [DATA_FILES.weather_history_recent]: historyTablesToJson(tables)
  };

  if (args.includeWatchlistJson) {
    remoteByFile["weather_watchlist.json"] = watchlistTableToJson(tables);
  }

  const filenames = [...Object.values(DATA_FILES)];
  if (args.includeWatchlistJson) {
    filenames.push("weather_watchlist.json");
  }

  for (const filename of filenames) {
    const local = await readLocalJson(args.dataDir, filename);
    const remote = remoteByFile[filename];

    const localBody = JSON.stringify(canonicalize(local));
    const remoteBody = JSON.stringify(canonicalize(remote));

    if (localBody !== remoteBody) {
      throw new Error(`Mismatch detected for ${filename} (tabular sheet rows vs local JSON).`);
    }

    console.log(`Verified ${filename} matches tabular Google Sheet representation.`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "import-from-json") {
    await importFromJson(args);
    return;
  }

  if (args.command === "export-to-json") {
    await exportToJson(args);
    return;
  }

  if (args.command === "verify-roundtrip") {
    await verifyRoundtrip(args);
    return;
  }

  throw new Error(
    "Usage: node scripts/google-sheet-weather-db.mjs <import-from-json|export-to-json|verify-roundtrip> [--spreadsheet-id <id>] [--data-dir public/data] [--include-watchlist-json]"
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : `${error}`;
  console.error(message);
  process.exit(1);
});
