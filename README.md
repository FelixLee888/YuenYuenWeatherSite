# Yuen Yuen's Weather

A modern weather dashboard that connects to **Yuen Yuen AIBot** for:
- Daily weather
- Benchmark data
- Historical weather data
- Weather watchlist management (including adding new locations)

## Local path
This project is intended to live at:

`/Users/felixlee/Documents/YuenYuenWeatherSite`

## Run locally
```bash
cd /Users/felixlee/Documents/YuenYuenWeatherSite
cp .env.example .env
npm run dev
```

Open:

[http://127.0.0.1:4173](http://127.0.0.1:4173)

## Configure AIBot API
Set `.env` values to match your AIBot weather API.

- `AIBOT_BASE_URL`: Base URL of Yuen Yuen AIBot
- `AIBOT_*_PATHS`: Comma-separated endpoint candidates

The server tries each path in order and uses the first successful response.

## API endpoints in this site
- `GET /health`
- `GET /api/config`
- `GET /api/weather?location=<name>`
- `GET /api/weather/daily?location=<name>`
- `GET /api/weather/benchmark?location=<name>`
- `GET /api/weather/history?location=<name>`
- `GET /api/weather/watchlist`
- `POST /api/weather/watchlist` with JSON body: `{ "location": "Tokyo" }`

`POST /api/weather/watchlist` forwards the new location to Yuen Yuen AIBot so the forecast watchlist can be updated upstream.
