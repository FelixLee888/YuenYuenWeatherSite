# Yuen Yuen's Weather

A modern weather dashboard powered by local weather JSON snapshots in `public/data`.

## Local path
This project is intended to live at:

`/Users/felixlee/Documents/YuenYuenWeatherSite`

## Data source (all weather content)
All weather content is loaded from these files:

- `public/data/weather_latest_report.json` (daily by location)
- `public/data/weather_benchmarks_latest.json` (benchmark summary)
- `public/data/weather_history_recent.json` (history + forecasts)
- `public/data/weather_watchlist.json` (custom user-added locations)

The backend API reads these files on each request, so updates to the files are reflected immediately.

## Run locally
```bash
cd /Users/felixlee/Documents/YuenYuenWeatherSite
cp .env.example .env
npm run dev
```

Open:

[http://127.0.0.1:4173](http://127.0.0.1:4173)

## Optional AIBot sync for new watchlist locations
When users add a location from the UI, it is always saved to `public/data/weather_watchlist.json`.

If you also want to forward that location to Yuen Yuen AIBot, set:

- `AIBOT_WATCHLIST_SYNC_URL` in `.env`

## API endpoints
- `GET /health`
- `GET /api/config`
- `GET /api/weather?location=<name>`
- `GET /api/weather/daily?location=<name>`
- `GET /api/weather/benchmark?location=<name>`
- `GET /api/weather/history?location=<name>`
- `GET /api/weather/watchlist`
- `POST /api/weather/watchlist` with JSON body: `{ "location": "Tokyo" }`
