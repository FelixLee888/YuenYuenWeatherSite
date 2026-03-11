# Yuen Yuen's Weather

A modern weather dashboard with Google Sheets as the external weather data database.

## Local path
This project is intended to live at:

`/Users/felixlee/Documents/YuenYuenWeatherSite`

## Data architecture
Primary storage is Google Sheets with tabular (column) storage, not raw JSON chunks:

- Spreadsheet: `1g9_1I1xyt7iO922yNXckPswnqV5ATIzLo3NQ6IJ4O5k`
- Tabs used by this project (column-based schema):
  - `weather_latest_report`
  - `weather_latest_report_sources`
  - `weather_latest_report_zones`
  - `weather_latest_report_zone_sources`
  - `weather_latest_report_next7`
  - `weather_latest_report_mwis_links`
  - `weather_benchmarks_latest`
  - `weather_benchmarks_latest_sources`
  - `weather_history_recent`
  - `weather_history_recent_source_scores`
  - `weather_history_recent_source_weights`
  - `weather_history_recent_actuals`
  - `weather_history_recent_forecasts`
  - `weather_watchlist`

Persistent weather storage is Google Sheets only. Local `public/data/weather_*.json` files are not source-of-truth and are removed after refresh runs.
Watchlist source-of-truth is Google Sheet tab `weather_watchlist`.

When running `server.js` with Google Sheets credentials configured, API reads come directly from Google Sheets tabular data, and `POST /api/weather/watchlist` writes updates directly to the `weather_watchlist` sheet tab.

## Environment
Copy `.env.example` to `.env` and set credentials if you run Sheet sync locally.

Required for Sheet sync:

- `GOOGLE_SHEETS_SPREADSHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `GOOGLE_SHEETS_ENABLED=1`

Alternative credentials:

- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`

## Run locally
```bash
cd /Users/felixlee/Documents/YuenYuenWeatherSite
cp .env.example .env
npm run dev
```

Open:

[http://127.0.0.1:4173](http://127.0.0.1:4173)

## Google Sheet sync commands
```bash
# Import latest crawler JSON outputs into Google Sheets
npm run sheet:import

# Optional debug export (write to custom dir)
node scripts/google-sheet-weather-db.mjs export-to-json --data-dir /tmp/yuen-sheet-debug --include-watchlist-json
```

## Daily automation
Workflows:

- `.github/workflows/daily-weather-refresh.yml`
  - Runs every morning 8:00 (Europe/London)
  - Crawls weather via AIBot script
  - Syncs refreshed weather snapshots directly into Google Sheets DB
  - Manual run supports selecting AIBot ref (`aibot_ref`) for testing branch/tag updates
- `.github/workflows/auto-deploy-gh-pages.yml`
  - Deploys site to GitHub Pages when `main` changes
  - Also deploys after daily refresh completes (exports fresh Sheet snapshots to `public/data/` during deploy job)
- `.github/workflows/migrate-weather-data-to-google-sheet.yml`
  - Manual one-time migration of existing JSON snapshots into Google Sheets

## API endpoints
- `GET /health`
- `GET /api/config`
- `GET /api/weather?location=<name>`
- `GET /api/weather/daily?location=<name>`
- `GET /api/weather/benchmark?location=<name>`
- `GET /api/weather/history?location=<name>`
- `GET /api/weather/watchlist`
- `POST /api/weather/watchlist` with JSON body: `{ "location": "Tokyo" }`
