#!/usr/bin/env python3
"""Rehydrate the crawler benchmark SQLite DB from Google Sheet-exported history JSON.

This lets ephemeral runners rebuild enough forecast/history state to compute the
latest benchmark rows before the daily crawl writes fresh data back to Sheets.
"""

from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import json
import sqlite3
from pathlib import Path
from typing import Dict, Iterable, Optional, Tuple


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Hydrate weather benchmark DB from exported sheet JSON.")
    parser.add_argument("--db", required=True, help="Target SQLite database path.")
    parser.add_argument("--history-json", required=True, help="Path to weather_history_recent.json.")
    parser.add_argument("--latest-report-json", required=True, help="Path to weather_latest_report.json.")
    parser.add_argument("--aibot-script", default="", help="Optional path to weather_mountains_briefing.py for benchmark backfill.")
    return parser.parse_args()


def read_json(path_str: str) -> dict:
    path = Path(path_str)
    return json.loads(path.read_text(encoding="utf-8"))


def to_number(value) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, str) and not value.strip():
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    return numeric


def to_text(value) -> str:
    return str(value or "").strip()


def first_present(*values):
    for value in values:
        if value is not None:
            return value
    return None


def build_location_coords(history: dict, latest_report: dict) -> Dict[str, Tuple[float, float]]:
    coords: Dict[str, Tuple[float, float]] = {}

    for row in history.get("actuals", []):
        location = to_text(row.get("location"))
        lat = to_number(row.get("lat"))
        lon = to_number(row.get("lon"))
        if location and lat is not None and lon is not None:
            coords[location.lower()] = (lat, lon)

    for zone in latest_report.get("zones", []):
        location = to_text(zone.get("name"))
        lat = to_number(zone.get("lat"))
        lon = to_number(zone.get("lon"))
        if location and lat is not None and lon is not None:
            coords[location.lower()] = (lat, lon)

    return coords


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS forecasts (
            run_date TEXT NOT NULL,
            target_date TEXT NOT NULL,
            source TEXT NOT NULL,
            location TEXT NOT NULL,
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            temp_max REAL,
            temp_min REAL,
            wind_max REAL,
            rainfall_chance REAL,
            wind_direction TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (run_date, target_date, source, location)
        );

        CREATE INDEX IF NOT EXISTS idx_forecasts_target_source
            ON forecasts(target_date, source, location, run_date);

        CREATE TABLE IF NOT EXISTS actuals (
            date TEXT NOT NULL,
            location TEXT NOT NULL,
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            temp_max REAL,
            temp_min REAL,
            wind_max REAL,
            rainfall_chance REAL,
            wind_direction TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (date, location)
        );

        CREATE TABLE IF NOT EXISTS source_scores (
            date TEXT NOT NULL,
            source TEXT NOT NULL,
            mae_temp_max REAL,
            mae_temp_min REAL,
            mae_wind_max REAL,
            composite_error REAL,
            confidence REAL,
            sample_count INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (date, source)
        );

        CREATE TABLE IF NOT EXISTS source_weights (
            date TEXT NOT NULL,
            source TEXT NOT NULL,
            weight REAL NOT NULL,
            rolling_confidence REAL NOT NULL,
            lookback_days INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (date, source)
        );
        """
    )


def ensure_column(conn: sqlite3.Connection, table: str, column: str, sql_type: str) -> None:
    existing = {
        str(row[1]).strip().lower()
        for row in conn.execute(f"PRAGMA table_info({table})").fetchall()
    }
    if column.lower() in existing:
        return
    conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {sql_type}")


def ensure_compatible_schema(conn: sqlite3.Connection) -> None:
    ensure_column(conn, "forecasts", "rainfall_chance", "REAL")
    ensure_column(conn, "forecasts", "wind_direction", "TEXT")
    ensure_column(conn, "actuals", "rainfall_chance", "REAL")
    ensure_column(conn, "actuals", "wind_direction", "TEXT")


def load_aibot_module(script_path: str):
    module_path = Path(script_path)
    if not module_path.exists():
        raise FileNotFoundError(f"AIBot script not found: {module_path}")
    spec = importlib.util.spec_from_file_location("weather_mountains_briefing_runtime", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load AIBot script: {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def iso_date_offset(date_str: str, days: int) -> str:
    return (dt.date.fromisoformat(date_str) + dt.timedelta(days=days)).isoformat()


def table_count(conn: sqlite3.Connection, table: str) -> int:
    return int(conn.execute(f"SELECT COUNT(1) FROM {table}").fetchone()[0])


def backfill_benchmark_rows(conn: sqlite3.Connection, aibot_script: str) -> Dict[str, int]:
    module = load_aibot_module(aibot_script)
    required = [
        "configured_sources",
        "available_sources_for_target",
        "evaluate_and_store",
        "rolling_confidence",
        "compute_weights",
        "store_weights",
        "init_db",
    ]
    missing = [name for name in required if not hasattr(module, name)]
    if missing:
        raise RuntimeError(f"AIBot script is missing required backfill helpers: {', '.join(missing)}")

    module.init_db(conn)
    purge_retired = getattr(module, "purge_retired_sources", None)
    retired_sources = list(getattr(module, "RETIRED_SOURCES", []) or [])
    if purge_retired and retired_sources:
        purge_retired(conn, retired_sources)

    source_rows = conn.execute("SELECT DISTINCT source FROM forecasts ORDER BY source").fetchall()
    history_score_sources = conn.execute("SELECT DISTINCT source FROM source_scores ORDER BY source").fetchall()
    history_weight_sources = conn.execute("SELECT DISTINCT source FROM source_weights ORDER BY source").fetchall()
    active_sources = sorted(
        {
            *list(module.configured_sources()),
            *(str(row[0]) for row in source_rows if row and row[0]),
            *(str(row[0]) for row in history_score_sources if row and row[0]),
            *(str(row[0]) for row in history_weight_sources if row and row[0]),
        }
    )
    lookback_days = int(getattr(module, "LOOKBACK_DAYS", 14) or 14)

    before_scores = table_count(conn, "source_scores")
    before_weights = table_count(conn, "source_weights")

    actual_dates = [str(row[0]) for row in conn.execute("SELECT DISTINCT date FROM actuals ORDER BY date").fetchall() if row and row[0]]
    for eval_date in actual_dates:
        module.evaluate_and_store(conn, target_date=eval_date, sources=active_sources)

    run_dates = [str(row[0]) for row in conn.execute("SELECT DISTINCT run_date FROM forecasts ORDER BY run_date").fetchall() if row and row[0]]
    for run_date in run_dates:
        eval_date = iso_date_offset(run_date, -1)
        target_date = iso_date_offset(run_date, 1)
        rolling = module.rolling_confidence(conn, as_of_date=eval_date, sources=active_sources, lookback_days=lookback_days)
        weight_sources = module.available_sources_for_target(conn, target_date=target_date, sources=active_sources)
        if not weight_sources:
            weight_sources = active_sources
        weights = module.compute_weights(rolling, weight_sources)
        module.store_weights(conn, date_str=run_date, weights=weights, rolling=rolling, lookback_days=lookback_days)

    after_scores = table_count(conn, "source_scores")
    after_weights = table_count(conn, "source_weights")
    return {
        "source_scores_added": max(0, after_scores - before_scores),
        "source_weights_added": max(0, after_weights - before_weights),
    }


def upsert_actuals(conn: sqlite3.Connection, rows: Iterable[dict]) -> int:
    count = 0
    for row in rows:
        location = to_text(row.get("location"))
        date = to_text(row.get("date"))
        lat = to_number(row.get("lat"))
        lon = to_number(row.get("lon"))
        if not location or not date or lat is None or lon is None:
            continue
        conn.execute(
            """
            INSERT INTO actuals (
                date, location, lat, lon, temp_max, temp_min, wind_max, rainfall_chance, wind_direction
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(date, location)
            DO UPDATE SET
                lat=excluded.lat,
                lon=excluded.lon,
                temp_max=excluded.temp_max,
                temp_min=excluded.temp_min,
                wind_max=excluded.wind_max,
                rainfall_chance=excluded.rainfall_chance,
                wind_direction=excluded.wind_direction
            """,
            (
                date,
                location,
                lat,
                lon,
                to_number(row.get("temp_max")),
                to_number(row.get("temp_min")),
                to_number(row.get("wind_max")),
                to_number(first_present(row.get("rainfall_chance"), row.get("rain_chance"))),
                to_text(row.get("wind_direction") or row.get("wind_dir")) or None,
            ),
        )
        count += 1
    return count


def upsert_forecasts(conn: sqlite3.Connection, rows: Iterable[dict], coords: Dict[str, Tuple[float, float]]) -> Tuple[int, int]:
    inserted = 0
    skipped = 0
    for row in rows:
        location = to_text(row.get("location"))
        run_date = to_text(row.get("run_date"))
        target_date = to_text(row.get("target_date"))
        source = to_text(row.get("source"))
        lat_lon = coords.get(location.lower())
        if not location or not run_date or not target_date or not source or lat_lon is None:
            skipped += 1
            continue
        lat, lon = lat_lon
        conn.execute(
            """
            INSERT INTO forecasts (
                run_date, target_date, source, location, lat, lon, temp_max, temp_min, wind_max, rainfall_chance, wind_direction
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(run_date, target_date, source, location)
            DO UPDATE SET
                lat=excluded.lat,
                lon=excluded.lon,
                temp_max=excluded.temp_max,
                temp_min=excluded.temp_min,
                wind_max=excluded.wind_max,
                rainfall_chance=excluded.rainfall_chance,
                wind_direction=excluded.wind_direction
            """,
            (
                run_date,
                target_date,
                source,
                location,
                lat,
                lon,
                to_number(row.get("temp_max")),
                to_number(row.get("temp_min")),
                to_number(row.get("wind_max")),
                to_number(first_present(row.get("rainfall_chance"), row.get("rain_chance"))),
                to_text(row.get("wind_direction") or row.get("wind_dir")) or None,
            ),
        )
        inserted += 1
    return inserted, skipped


def upsert_source_scores(conn: sqlite3.Connection, rows: Iterable[dict]) -> int:
    count = 0
    for row in rows:
        date = to_text(row.get("date"))
        source = to_text(row.get("source"))
        if not date or not source:
            continue
        conn.execute(
            """
            INSERT INTO source_scores (
                date, source, mae_temp_max, mae_temp_min, mae_wind_max, composite_error, confidence, sample_count
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(date, source)
            DO UPDATE SET
                mae_temp_max=excluded.mae_temp_max,
                mae_temp_min=excluded.mae_temp_min,
                mae_wind_max=excluded.mae_wind_max,
                composite_error=excluded.composite_error,
                confidence=excluded.confidence,
                sample_count=excluded.sample_count
            """,
            (
                date,
                source,
                to_number(row.get("mae_temp_max")),
                to_number(row.get("mae_temp_min")),
                to_number(row.get("mae_wind_max")),
                to_number(row.get("composite_error")),
                to_number(row.get("confidence")),
                int(to_number(row.get("sample_count")) or 0),
            ),
        )
        count += 1
    return count


def upsert_source_weights(conn: sqlite3.Connection, rows: Iterable[dict]) -> int:
    count = 0
    for row in rows:
        date = to_text(row.get("date"))
        source = to_text(row.get("source"))
        weight = to_number(row.get("weight"))
        rolling_confidence = to_number(row.get("rolling_confidence"))
        lookback_days = int(to_number(row.get("lookback_days")) or 0)
        if not date or not source or weight is None or rolling_confidence is None:
            continue
        conn.execute(
            """
            INSERT INTO source_weights (date, source, weight, rolling_confidence, lookback_days)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(date, source)
            DO UPDATE SET
                weight=excluded.weight,
                rolling_confidence=excluded.rolling_confidence,
                lookback_days=excluded.lookback_days
            """,
            (
                date,
                source,
                weight,
                rolling_confidence,
                lookback_days,
            ),
        )
        count += 1
    return count


def main() -> None:
    args = parse_args()
    history = read_json(args.history_json)
    latest_report = read_json(args.latest_report_json)
    coords = build_location_coords(history, latest_report)

    db_path = Path(args.db)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(str(db_path)) as conn:
        conn.row_factory = sqlite3.Row
        init_db(conn)
        ensure_compatible_schema(conn)

        actual_count = upsert_actuals(conn, history.get("actuals", []))
        forecast_count, forecast_skipped = upsert_forecasts(conn, history.get("forecasts", []), coords)
        score_count = upsert_source_scores(conn, history.get("source_scores", []))
        weight_count = upsert_source_weights(conn, history.get("source_weights", []))
        backfill_counts = {"source_scores_added": 0, "source_weights_added": 0}
        if args.aibot_script:
            backfill_counts = backfill_benchmark_rows(conn, args.aibot_script)
        conn.commit()

    print(
        "Hydrated benchmark DB from sheet history:",
        f"actuals={actual_count}",
        f"forecasts={forecast_count}",
        f"forecast_skipped={forecast_skipped}",
        f"source_scores={score_count}",
        f"source_weights={weight_count}",
        f"backfill_source_scores_added={backfill_counts['source_scores_added']}",
        f"backfill_source_weights_added={backfill_counts['source_weights_added']}",
    )


if __name__ == "__main__":
    main()
