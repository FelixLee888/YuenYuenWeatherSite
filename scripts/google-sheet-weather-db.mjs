#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const DEFAULT_CHUNK_SIZE = 40000;

const DATA_FILES = {
  weather_latest_report: "weather_latest_report.json",
  weather_benchmarks_latest: "weather_benchmarks_latest.json",
  weather_history_recent: "weather_history_recent.json",
  weather_watchlist: "weather_watchlist.json"
};

const SHEET_TABS = {
  weather_latest_report: "weather_latest_report",
  weather_benchmarks_latest: "weather_benchmarks_latest",
  weather_history_recent: "weather_history_recent",
  weather_watchlist: "weather_watchlist"
};

function parseArgs(argv) {
  const args = {
    command: "",
    spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID || "",
    dataDir: process.env.WEATHER_DATA_DIR || "public/data",
    chunkSize: Number(process.env.GOOGLE_SHEETS_CHUNK_SIZE || DEFAULT_CHUNK_SIZE)
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

    if (arg === "--chunk-size" && next) {
      args.chunkSize = Number(next);
      i += 1;
      continue;
    }

    positional.push(arg);
  }

  args.command = positional[0] || "";

  if (!args.spreadsheetId) {
    throw new Error("Missing spreadsheet id. Set GOOGLE_SHEETS_SPREADSHEET_ID or pass --spreadsheet-id.");
  }

  if (!Number.isFinite(args.chunkSize) || args.chunkSize < 5000) {
    throw new Error("Invalid chunk size. Use a number >= 5000.");
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

function splitIntoChunks(text, chunkSize) {
  if (!text) {
    return [""];
  }

  const chunks = [];
  for (let index = 0; index < text.length; index += chunkSize) {
    chunks.push(text.slice(index, index + chunkSize));
  }
  return chunks;
}

function buildChunkRows(jsonValue, chunkSize) {
  const body = JSON.stringify(jsonValue);
  const chunks = splitIntoChunks(body, chunkSize);

  const rows = [["chunk_index", "json_chunk"]];
  for (let i = 0; i < chunks.length; i += 1) {
    rows.push([`${i}`, chunks[i]]);
  }
  return rows;
}

function parseChunkRows(values) {
  if (!Array.isArray(values) || values.length < 2) {
    return {};
  }

  const chunkRows = values.slice(1).map((row) => {
    const index = Number(row?.[0]);
    const chunk = `${row?.[1] || ""}`;
    return { index, chunk };
  });

  chunkRows.sort((a, b) => a.index - b.index);
  const joined = chunkRows.map((row) => row.chunk).join("");
  if (!joined.trim()) {
    return {};
  }

  return JSON.parse(joined);
}

function quoteSheetTitle(title) {
  return `'${title.replace(/'/g, "''")}'`;
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
  for (const title of Object.values(SHEET_TABS)) {
    if (existing.has(title)) {
      continue;
    }

    requests.push({
      addSheet: {
        properties: {
          title
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

async function writeTabJson(accessToken, spreadsheetId, tabName, jsonValue, chunkSize) {
  const range = `${quoteSheetTitle(tabName)}!A:B`;
  await sheetsRequest(accessToken, spreadsheetId, `/values/${encodeURIComponent(range)}:clear`, {
    method: "POST",
    body: {}
  });

  const values = buildChunkRows(jsonValue, chunkSize);
  await sheetsRequest(accessToken, spreadsheetId, `/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: "PUT",
    body: { values }
  });
}

async function readTabJson(accessToken, spreadsheetId, tabName) {
  const range = `${quoteSheetTitle(tabName)}!A:B`;
  const payload = await sheetsRequest(accessToken, spreadsheetId, `/values/${encodeURIComponent(range)}`);
  return parseChunkRows(payload?.values || []);
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

async function importFromJson(args) {
  const accessToken = await fetchGoogleAccessToken();
  await ensureSheets(accessToken, args.spreadsheetId);

  for (const [key, filename] of Object.entries(DATA_FILES)) {
    const tabName = SHEET_TABS[key];
    const payload = await readLocalJson(args.dataDir, filename);
    await writeTabJson(accessToken, args.spreadsheetId, tabName, payload, args.chunkSize);
    console.log(`Imported ${filename} -> sheet tab '${tabName}'`);
  }
}

async function exportToJson(args) {
  const accessToken = await fetchGoogleAccessToken();

  for (const [key, filename] of Object.entries(DATA_FILES)) {
    const tabName = SHEET_TABS[key];
    const payload = await readTabJson(accessToken, args.spreadsheetId, tabName);
    await writeLocalJson(args.dataDir, filename, payload);
    console.log(`Exported sheet tab '${tabName}' -> ${filename}`);
  }
}

async function verifyRoundtrip(args) {
  const accessToken = await fetchGoogleAccessToken();

  for (const [key, filename] of Object.entries(DATA_FILES)) {
    const tabName = SHEET_TABS[key];
    const local = await readLocalJson(args.dataDir, filename);
    const remote = await readTabJson(accessToken, args.spreadsheetId, tabName);
    const localBody = JSON.stringify(local);
    const remoteBody = JSON.stringify(remote);
    if (localBody !== remoteBody) {
      throw new Error(`Mismatch detected for ${filename} <-> ${tabName}`);
    }
    console.log(`Verified ${filename} matches sheet tab '${tabName}'`);
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
    "Usage: node scripts/google-sheet-weather-db.mjs <import-from-json|export-to-json|verify-roundtrip> [--spreadsheet-id <id>] [--data-dir public/data]"
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : `${error}`;
  console.error(message);
  process.exit(1);
});
