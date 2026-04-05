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

## Admin watchlist management
The admin flow is handled by the Node backend in `server.js`.

- Authentication provider: Google Sign-In
- Default admin email: `jancefelix@gmail.com`
- Write target: Google Sheet tab `weather_watchlist`
- Bot pickup: the Pi bot can keep reading the shared watchlist sheet, and the backend can also notify `AIBOT_WATCHLIST_SYNC_URL` after a new location is added

Important:

- GitHub Pages is static-only, so secure Google-login watchlist writes are not available there by themselves
- The admin controls become active only when the site is served through `server.js` (or another trusted backend host running the same API)
- In static Pages mode, the UI shows admin mode as unavailable instead of pretending to save shared watchlist changes locally

## Environment
Copy `.env.example` to `.env` and set credentials if you run Sheet sync locally.

Required for Sheet sync:

- `GOOGLE_SHEETS_SPREADSHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `GOOGLE_SHEETS_ENABLED=1`

Required for admin login:

- `GOOGLE_CLIENT_ID` (Google OAuth web client id for the site/backend origin)
- `ADMIN_ALLOWED_EMAILS` (comma-separated list, defaults to `jancefelix@gmail.com`)

Optional for admin login:

- `ADMIN_SESSION_SECRET`
- `ADMIN_SESSION_TTL_MS`

Alternative credentials:

- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`

Optional provider credentials for full source coverage during refresh:

- `OPENWEATHER_API_KEY`
- `GOOGLE_WEATHER_ACCESS_TOKEN` (preferred)
- `GOOGLE_WEATHER_API_KEY` (fallback)

## Run locally
```bash
cd /Users/felixlee/Documents/YuenYuenWeatherSite
cp .env.example .env
npm run dev
```

Open:

[http://127.0.0.1:4173](http://127.0.0.1:4173)

## Deploy to Cloud Run
This app can be deployed as a single Node service to Cloud Run. That deployment can serve both:

- the website frontend
- the authenticated `/api/*` backend used by admin watchlist management

Recommended env vars for Cloud Run:

- `GOOGLE_SHEETS_ENABLED=1`
- `GOOGLE_SHEETS_SPREADSHEET_ID=1g9_1I1xyt7iO922yNXckPswnqV5ATIzLo3NQ6IJ4O5k`
- `GOOGLE_CLIENT_ID=<google oauth web client id>`
- `ADMIN_ALLOWED_EMAILS=jancefelix@gmail.com`
- `ADMIN_SESSION_SECRET=<random long secret>`
- `AIBOT_WATCHLIST_SYNC_URL=<optional>`

Cloud Run-specific note:

- `server.js` supports using the Cloud Run attached service account via the metadata server for Google Sheets access, so you do not have to bake a private key into the container if the runtime service account has access to the spreadsheet.

Deploy example:

```bash
gcloud run deploy yuen-yuen-weather \
  --source . \
  --project my-cat-detector \
  --region europe-west2 \
  --allow-unauthenticated
```

After deploy, add the Cloud Run service URL origin to the Google OAuth web client as an authorized JavaScript origin. Without that, Google login for the admin UI will stay blocked by OAuth origin checks.

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
- `GET /api/admin/session`
- `POST /api/admin/google-login` with JSON body: `{ "credential": "<google-id-token>" }`
- `POST /api/admin/logout`
- `GET /api/weather?location=<name>`
- `GET /api/weather/daily?location=<name>`
- `GET /api/weather/benchmark?location=<name>`
- `GET /api/weather/history?location=<name>`
- `GET /api/weather/watchlist`
- `POST /api/weather/watchlist` with JSON body: `{ "location": "Tokyo" }` (admin login required)
- `DELETE /api/weather/watchlist` with JSON body: `{ "location": "Tokyo" }` (admin login required)
