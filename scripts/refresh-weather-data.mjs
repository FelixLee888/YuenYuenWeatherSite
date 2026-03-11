#!/usr/bin/env node

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";

function parseArgs(argv) {
  const args = {
    mode: process.env.WEATHER_BRIEFING_MODE || "full",
    watchlist: process.env.WATCHLIST_PATH || "public/data/weather_watchlist.json",
    aibotScript: process.env.AIBOT_SCRIPT_PATH || "aibot/scripts/weather_mountains_briefing.py"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--mode" && next) {
      args.mode = next;
      index += 1;
      continue;
    }

    if (arg === "--watchlist" && next) {
      args.watchlist = next;
      index += 1;
      continue;
    }

    if (arg === "--aibot-script" && next) {
      args.aibotScript = next;
      index += 1;
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
    try {
      const entry = await geocodeLocation(name);
      if (!entry) {
        console.log(`[warn] No geocode result for '${name}'`);
        continue;
      }

      const key = entry.name.toLowerCase();
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
  const watchlistPath = path.resolve(repoRoot, args.watchlist);
  const aibotScriptPath = path.resolve(repoRoot, args.aibotScript);

  if (!existsSync(aibotScriptPath)) {
    throw new Error(`AIBot script not found: ${aibotScriptPath}`);
  }

  const watchlistPayload = await readJsonOrDefault(watchlistPath, { locations: [] });
  const watchlistNames = normalizeWatchlist(watchlistPayload);
  console.log(`Loaded ${watchlistNames.length} watchlist locations from ${watchlistPath}`);

  let scriptToRun = aibotScriptPath;

  if (watchlistNames.length > 0) {
    const resolvedLocations = await resolveWatchlistLocations(watchlistNames);
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
    console.log("Watchlist is empty. Falling back to AIBot default locations.");
  }

  const env = {
    ...process.env,
    WEATHER_SITE_SYNC_ENABLED: process.env.WEATHER_SITE_SYNC_ENABLED || "1",
    WEATHER_SITE_REPO_PATH: process.env.WEATHER_SITE_REPO_PATH || repoRoot,
    WEATHER_SITE_DATA_SUBDIR: process.env.WEATHER_SITE_DATA_SUBDIR || "public/data",
    WEATHER_SITE_GIT_REMOTE: process.env.WEATHER_SITE_GIT_REMOTE || "origin",
    WEATHER_SITE_GIT_BRANCH: process.env.WEATHER_SITE_GIT_BRANCH || "main",
    WEATHER_SITE_GIT_PUSH_ENABLED: process.env.WEATHER_SITE_GIT_PUSH_ENABLED || "1",
    WEATHER_BENCHMARK_DATA_DIR:
      process.env.WEATHER_BENCHMARK_DATA_DIR || path.join(repoRoot, ".weather-benchmark-data")
  };

  await runCommand("python3", [scriptToRun, "--mode", args.mode], {
    cwd: repoRoot,
    env
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : `${error}`;
  console.error(message);
  process.exit(1);
});
