#!/usr/bin/env node

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const LOCAL_SNAPSHOT_FILES = [
  "public/data/weather_latest_report.json",
  "public/data/weather_benchmarks_latest.json",
  "public/data/weather_history_recent.json",
  "public/data/weather_watchlist.json"
];

const LOCATION_COORDINATE_OVERRIDES = {
  "ben nevis": { name: "Ben Nevis", lat: 56.7969, lon: -5.0036 },
  "cairngorms": { name: "Cairngorms", lat: 57.1167, lon: -3.6667 },
  "glencoe": { name: "Glencoe", lat: 56.6833, lon: -5.1000 },
  "glenshee": { name: "Glenshee", lat: 56.8833, lon: -3.4167 },
  "paisley": { name: "Paisley", lat: 55.8473, lon: -4.4401 },
  "passo del tonale": { name: "Passo del Tonale", lat: 46.2583, lon: 10.5819 }
};

function getSheetExportArtifacts(repoRoot) {
  const exportDir = path.join(repoRoot, ".tmp", "sheet-watchlist");
  return {
    exportDir,
    watchlistJsonPath: path.join(exportDir, "weather_watchlist.json"),
    historyJsonPath: path.join(exportDir, "weather_history_recent.json"),
    latestReportJsonPath: path.join(exportDir, "weather_latest_report.json")
  };
}

function normalizeLocationKey(value) {
  return `${value || ""}`
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseArgs(argv) {
  const args = {
    mode: process.env.WEATHER_BRIEFING_MODE || "full",
    aibotScript: process.env.AIBOT_SCRIPT_PATH || "aibot/scripts/weather_mountains_briefing.py",
    sheetDirectWrite: (process.env.WEATHER_GOOGLE_SHEET_DIRECT_WRITE || "0").trim() === "1",
    spreadsheetId:
      process.env.WEATHER_GOOGLE_SHEET_ID ||
      process.env.GOOGLE_SHEETS_SPREADSHEET_ID ||
      ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--mode" && next) {
      args.mode = next;
      index += 1;
      continue;
    }

    if (arg === "--aibot-script" && next) {
      args.aibotScript = next;
      index += 1;
      continue;
    }

    if (arg === "--spreadsheet-id" && next) {
      args.spreadsheetId = next;
      index += 1;
      continue;
    }

    if (arg === "--sheet-direct-write") {
      args.sheetDirectWrite = true;
      continue;
    }
  }

  if (args.mode !== "full" && args.mode !== "compact") {
    throw new Error(`Invalid mode '${args.mode}'. Use 'full' or 'compact'.`);
  }

  return args;
}

async function readJsonOrDefault(filePath, fallback) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function normalizeWatchlist(payload) {
  const rawList = Array.isArray(payload?.locations)
    ? payload.locations
    : Array.isArray(payload)
      ? payload
      : [];

  const out = [];
  const seen = new Set();

  for (const item of rawList) {
    const name = `${item || ""}`.trim();
    if (!name) {
      continue;
    }

    const key = name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    out.push(name);
  }

  return out;
}

async function loadWatchlistFromGoogleSheet(repoRoot, sheetImporterPath, spreadsheetId, env) {
  const artifacts = getSheetExportArtifacts(repoRoot);
  await fs.mkdir(artifacts.exportDir, { recursive: true });

  await runCommand(
    "node",
    [
      sheetImporterPath,
      "export-to-json",
      "--spreadsheet-id",
      spreadsheetId,
      "--data-dir",
      artifacts.exportDir,
      "--include-watchlist-json"
    ],
    {
      cwd: repoRoot,
      env
    }
  );

  const watchlistPayload = await readJsonOrDefault(artifacts.watchlistJsonPath, { locations: [] });
  return {
    locations: normalizeWatchlist(watchlistPayload),
    ...artifacts
  };
}

async function hydrateBenchmarkDbFromSheetHistory(repoRoot, env, artifacts) {
  const hydrationScriptPath = path.resolve(repoRoot, "scripts/hydrate-weather-benchmark-db.py");
  if (!existsSync(hydrationScriptPath)) {
    throw new Error(`Benchmark DB hydration script not found: ${hydrationScriptPath}`);
  }

  if (!existsSync(artifacts.historyJsonPath)) {
    throw new Error(`Expected sheet-exported weather history JSON not found: ${artifacts.historyJsonPath}`);
  }

  if (!existsSync(artifacts.latestReportJsonPath)) {
    throw new Error(`Expected sheet-exported latest report JSON not found: ${artifacts.latestReportJsonPath}`);
  }

  const benchmarkDataDir = env.WEATHER_BENCHMARK_DATA_DIR || path.join(repoRoot, ".weather-benchmark-data");
  const benchmarkDbPath = path.join(benchmarkDataDir, "weather_benchmark.sqlite3");
  await fs.mkdir(benchmarkDataDir, { recursive: true });

  await runCommand(
    "python3",
    [
      hydrationScriptPath,
      "--db",
      benchmarkDbPath,
      "--history-json",
      artifacts.historyJsonPath,
      "--latest-report-json",
      artifacts.latestReportJsonPath,
      "--aibot-script",
      path.resolve(repoRoot, env.AIBOT_SCRIPT_PATH || "aibot/scripts/weather_mountains_briefing.py")
    ],
    {
      cwd: repoRoot,
      env
    }
  );
}

async function removeLocalWeatherSnapshots(repoRoot) {
  for (const relativePath of LOCAL_SNAPSHOT_FILES) {
    const targetPath = path.resolve(repoRoot, relativePath);
    await fs.rm(targetPath, { force: true });
  }
}

function coordinatesClose(actual, expected, tolerance = 0.05) {
  return Math.abs(actual - expected) <= tolerance;
}

async function validateFreshWeatherSnapshots(repoRoot, resolvedLocations) {
  const requiredFiles = LOCAL_SNAPSHOT_FILES.slice(0, 3).map((relativePath) => path.resolve(repoRoot, relativePath));

  for (const filePath of requiredFiles) {
    if (!existsSync(filePath)) {
      throw new Error(`Expected refreshed weather snapshot not found: ${filePath}`);
    }
  }

  const latestReport = await readJsonOrDefault(requiredFiles[0], null);
  if (!latestReport || !Array.isArray(latestReport?.zones) || latestReport.zones.length === 0) {
    throw new Error("Refreshed weather latest report is missing zones.");
  }

  for (const location of resolvedLocations || []) {
    const override = LOCATION_COORDINATE_OVERRIDES[normalizeLocationKey(location?.name)];
    if (!override) {
      continue;
    }

    const zone = latestReport.zones.find((entry) => normalizeLocationKey(entry?.name) === normalizeLocationKey(override.name));
    if (!zone) {
      throw new Error(`Refreshed weather latest report is missing zone '${override.name}'.`);
    }

    const lat = Number(zone.lat);
    const lon = Number(zone.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error(`Refreshed weather latest report has invalid coordinates for '${override.name}'.`);
    }

    if (!coordinatesClose(lat, override.lat) || !coordinatesClose(lon, override.lon)) {
      throw new Error(
        `Refreshed coordinates for '${override.name}' do not match override. Got ${lat}, ${lon}; expected ${override.lat}, ${override.lon}.`
      );
    }
  }
}

async function geocodeLocation(name) {
  const url = new URL(GEOCODE_URL);
  url.searchParams.set("name", name);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const response = await fetch(url, {
    method: "GET"
  });

  if (!response.ok) {
    throw new Error(`geocode HTTP ${response.status}`);
  }

  const body = await response.json();
  const first = Array.isArray(body?.results) ? body.results[0] : null;
  if (!first) {
    return null;
  }

  const lat = Number(first.latitude);
  const lon = Number(first.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  return {
    name,
    lat,
    lon
  };
}

async function resolveWatchlistLocations(names) {
  const resolved = [];
  const seen = new Set();

  for (const name of names) {
    const override = LOCATION_COORDINATE_OVERRIDES[normalizeLocationKey(name)];
    if (override) {
      const key = normalizeLocationKey(override.name);
      if (!seen.has(key)) {
        seen.add(key);
        resolved.push({
          name: override.name,
          lat: override.lat,
          lon: override.lon
        });
      }
      continue;
    }

    try {
      const entry = await geocodeLocation(name);
      if (!entry) {
        console.log(`[warn] No geocode result for '${name}'`);
        continue;
      }

      const key = normalizeLocationKey(entry.name);
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      resolved.push(entry);
    } catch (error) {
      const message = error instanceof Error ? error.message : `${error}`;
      console.log(`[warn] Geocode failed for '${name}': ${message}`);
    }
  }

  return resolved;
}

function toPythonLocationsLiteral(locations) {
  const rows = locations.map((location) => {
    return `    {"name": ${JSON.stringify(location.name)}, "lat": ${location.lat.toFixed(4)}, "lon": ${location.lon.toFixed(4)}},`;
  });

  return `LOCATIONS = [\n${rows.join("\n")}\n]`;
}

function patchAibotScriptLocations(source, locationsLiteral) {
  const pattern = /LOCATIONS = \[[\s\S]*?\]\n\nTZ = ZoneInfo\("Europe\/London"\)/;
  if (!pattern.test(source)) {
    throw new Error("Unable to find LOCATIONS block in weather_mountains_briefing.py");
  }

  return source.replace(pattern, `${locationsLiteral}\n\nTZ = ZoneInfo("Europe/London")`);
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      ...options
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const repoRoot = process.cwd();
  const aibotScriptPath = path.resolve(repoRoot, args.aibotScript);
  const sheetImporterPath = path.resolve(repoRoot, "scripts/google-sheet-weather-db.mjs");

  if (!existsSync(aibotScriptPath)) {
    throw new Error(`AIBot script not found: ${aibotScriptPath}`);
  }

  if (args.sheetDirectWrite && !args.spreadsheetId) {
    throw new Error("Sheet direct write is enabled, but spreadsheet id is missing. Set WEATHER_GOOGLE_SHEET_ID or pass --spreadsheet-id.");
  }

  if (args.sheetDirectWrite && !existsSync(sheetImporterPath)) {
    throw new Error(`Google Sheet importer script not found: ${sheetImporterPath}`);
  }

  const env = {
    ...process.env,
    WEATHER_SITE_SYNC_ENABLED: process.env.WEATHER_SITE_SYNC_ENABLED || "1",
    WEATHER_SITE_REPO_PATH: process.env.WEATHER_SITE_REPO_PATH || repoRoot,
    WEATHER_SITE_DATA_SUBDIR: process.env.WEATHER_SITE_DATA_SUBDIR || "public/data",
    WEATHER_SITE_GIT_REMOTE: process.env.WEATHER_SITE_GIT_REMOTE || "origin",
    WEATHER_SITE_GIT_BRANCH: process.env.WEATHER_SITE_GIT_BRANCH || "main",
    WEATHER_SITE_GIT_PUSH_ENABLED: args.sheetDirectWrite ? "0" : (process.env.WEATHER_SITE_GIT_PUSH_ENABLED || "1"),
    WEATHER_BENCHMARK_DATA_DIR:
      process.env.WEATHER_BENCHMARK_DATA_DIR || path.join(repoRoot, ".weather-benchmark-data")
  };

  let watchlistNames = [];
  let sheetExportArtifacts = null;
  if (args.spreadsheetId && existsSync(sheetImporterPath)) {
    try {
      const sheetExport = await loadWatchlistFromGoogleSheet(repoRoot, sheetImporterPath, args.spreadsheetId, env);
      watchlistNames = sheetExport.locations;
      sheetExportArtifacts = sheetExport;
      console.log(`Loaded ${watchlistNames.length} watchlist locations from Google Sheet.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : `${error}`;
      console.log(`[warn] Unable to load watchlist from Google Sheet: ${message}`);
    }
  } else {
    console.log("[warn] Spreadsheet id is missing; cannot load watchlist from Google Sheet.");
  }

  let scriptToRun = aibotScriptPath;
  let resolvedLocations = [];

  if (watchlistNames.length > 0) {
    resolvedLocations = await resolveWatchlistLocations(watchlistNames);
    if (resolvedLocations.length > 0) {
      console.log(`Resolved ${resolvedLocations.length} watchlist locations for weather crawl.`);

      const originalScript = await fs.readFile(aibotScriptPath, "utf8");
      const patchedScript = patchAibotScriptLocations(originalScript, toPythonLocationsLiteral(resolvedLocations));

      const tmpDir = path.join(repoRoot, ".tmp");
      await fs.mkdir(tmpDir, { recursive: true });
      const tmpScriptPath = path.join(tmpDir, "weather_mountains_briefing_watchlist.py");
      await fs.writeFile(tmpScriptPath, patchedScript, "utf8");
      scriptToRun = tmpScriptPath;
    } else {
      console.log("No watchlist entries could be geocoded. Falling back to AIBot default locations.");
    }
  } else {
    console.log("Google Sheet watchlist is empty. Falling back to AIBot default locations.");
  }

  // Prevent stale snapshots from being imported into Google Sheets if the next run fails to publish fresh JSON.
  if (args.sheetDirectWrite) {
    await removeLocalWeatherSnapshots(repoRoot);
  }

  if (sheetExportArtifacts) {
    await hydrateBenchmarkDbFromSheetHistory(repoRoot, env, sheetExportArtifacts);
    console.log("Hydrated weather benchmark DB from Google Sheet history.");
  }

  await runCommand("python3", [scriptToRun, "--mode", args.mode], {
    cwd: repoRoot,
    env
  });

  if (args.sheetDirectWrite) {
    await validateFreshWeatherSnapshots(repoRoot, resolvedLocations);
    console.log(`Syncing refreshed weather snapshots directly to Google Sheet ${args.spreadsheetId}...`);
    await runCommand("node", [sheetImporterPath, "import-from-json", "--spreadsheet-id", args.spreadsheetId], {
      cwd: repoRoot,
      env
    });
    await removeLocalWeatherSnapshots(repoRoot);
    console.log("Google Sheet direct write completed.");
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : `${error}`;
  console.error(message);
  process.exit(1);
});
