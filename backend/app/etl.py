from __future__ import annotations

import io
import json
import logging
import os
from datetime import date, datetime, timedelta, timezone
from typing import Iterable

import pandas as pd
import requests

logger = logging.getLogger(__name__)

BMRS_BASE = "https://data.elexon.co.uk/bmrs/api/v1"
CHUNK_DAYS = 5
TIMEOUT = 90
RETRIES = 3

DELIVERY_FROM = date(2026, 1, 1)
DELIVERY_TO = date(2026, 1, 31)
FORECAST_PUBLISH_FROM = date(2025, 12, 24)
FORECAST_PUBLISH_TO = date(2026, 2, 2)


def _get(path: str, params: dict) -> list[dict]:
    url = f"{BMRS_BASE}{path}"
    last_err: Exception | None = None
    for attempt in range(1, RETRIES + 1):
        try:
            resp = requests.get(url, params=params, timeout=TIMEOUT)
            resp.raise_for_status()
            return resp.json().get("data", [])
        except Exception as exc:
            last_err = exc
            logger.warning("Elexon request failed (%s/%s) %s %s: %s", attempt, RETRIES, path, params, exc)
    raise RuntimeError(f"Elexon request failed after {RETRIES} attempts: {url} {params}") from last_err


def _date_chunks(start: date, end: date, step: int = CHUNK_DAYS) -> Iterable[tuple[date, date]]:
    cur = start
    while cur <= end:
        nxt = min(cur + timedelta(days=step - 1), end)
        yield cur, nxt
        cur = nxt + timedelta(days=1)


def fetch_actuals(start: date, end: date) -> pd.DataFrame:
    frames: list[pd.DataFrame] = []
    for a, b in _date_chunks(start, end):
        rows = _get(
            "/datasets/FUELHH",
            {
                "settlementDateFrom": a.isoformat(),
                "settlementDateTo": b.isoformat(),
                "format": "json",
            },
        )
        if rows:
            frames.append(pd.DataFrame(rows))
        logger.info("FUELHH %s..%s -> %s rows", a, b, len(rows))

    if not frames:
        return pd.DataFrame(columns=["startTime", "settlementDate", "settlementPeriod", "generation"])

    df = pd.concat(frames, ignore_index=True)
    df = df[df["fuelType"] == "WIND"].copy()
    df["startTime"] = pd.to_datetime(df["startTime"], utc=True)
    df["settlementDate"] = pd.to_datetime(df["settlementDate"]).dt.date
    df["settlementPeriod"] = df["settlementPeriod"].astype(int)
    df["generation"] = pd.to_numeric(df["generation"], errors="coerce")
    df = (
        df.sort_values(["startTime", "publishTime"])
        .drop_duplicates(subset=["startTime"], keep="last")
        .reset_index(drop=True)
    )
    return df[["startTime", "settlementDate", "settlementPeriod", "generation", "publishTime"]]


def fetch_forecasts(start: date, end: date) -> pd.DataFrame:
    frames: list[pd.DataFrame] = []
    for a, b in _date_chunks(start, end):
        rows = _get(
            "/datasets/WINDFOR",
            {
                "publishDateTimeFrom": f"{a.isoformat()}T00:00:00Z",
                "publishDateTimeTo": f"{b.isoformat()}T23:59:59Z",
                "format": "json",
            },
        )
        if rows:
            frames.append(pd.DataFrame(rows))
        logger.info("WINDFOR %s..%s -> %s rows", a, b, len(rows))

    if not frames:
        return pd.DataFrame(columns=["publishTime", "startTime", "generation"])

    df = pd.concat(frames, ignore_index=True)
    df["publishTime"] = pd.to_datetime(df["publishTime"], utc=True)
    df["startTime"] = pd.to_datetime(df["startTime"], utc=True)
    df["generation"] = pd.to_numeric(df["generation"], errors="coerce")
    df = df.drop_duplicates(subset=["publishTime", "startTime"], keep="last")
    return df[["publishTime", "startTime", "generation"]].sort_values(
        ["publishTime", "startTime"]
    ).reset_index(drop=True)


def to_half_hourly(forecast_hourly: pd.DataFrame) -> pd.DataFrame:
    if forecast_hourly.empty:
        return forecast_hourly.assign(startTime=pd.Series(dtype="datetime64[ns, UTC]"))
    out = pd.concat(
        [
            forecast_hourly.assign(startTime=forecast_hourly["startTime"]),
            forecast_hourly.assign(startTime=forecast_hourly["startTime"] + pd.Timedelta(minutes=30)),
        ],
        ignore_index=True,
    )
    return out.sort_values(["publishTime", "startTime"]).reset_index(drop=True)


def build_snapshot(raw_dir: str, out_dir: str) -> dict:
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(raw_dir, exist_ok=True)

    actuals = fetch_actuals(DELIVERY_FROM, DELIVERY_TO)
    fcasts_raw = fetch_forecasts(FORECAST_PUBLISH_FROM, FORECAST_PUBLISH_TO)
    fcasts = to_half_hourly(fcasts_raw)

    fcasts = fcasts[
        (fcasts["startTime"].dt.date >= DELIVERY_FROM - timedelta(days=1))
        & (fcasts["startTime"].dt.date <= DELIVERY_TO + timedelta(days=1))
    ].copy()

    actuals_path = os.path.join(out_dir, "wind_actuals_hh.csv")
    fcasts_path = os.path.join(out_dir, "wind_forecasts_hh.csv")
    actuals.to_csv(actuals_path, index=False)
    fcasts.to_csv(fcasts_path, index=False)

    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": {
            "actuals": f"{BMRS_BASE}/datasets/FUELHH",
            "forecasts": f"{BMRS_BASE}/datasets/WINDFOR",
        },
        "delivery_period": {"from": DELIVERY_FROM.isoformat(), "to": DELIVERY_TO.isoformat()},
        "forecast_publish_pull_window": {
            "from": FORECAST_PUBLISH_FROM.isoformat(),
            "to": FORECAST_PUBLISH_TO.isoformat(),
        },
        "counts": {
            "actual_rows": int(len(actuals)),
            "forecast_rows_halfhourly": int(len(fcasts)),
            "forecast_rows_hourly": int(len(fcasts_raw)),
            "distinct_vintages": int(fcasts["publishTime"].nunique()),
        },
        "notes": [
            "FUELHH fuelType == WIND only; national aggregation as published by Elexon.",
            "WINDFOR hourly forecast applied to both half-hours of the hour.",
            "All timestamps stored in UTC. January 2026 is GMT, so settlement day == UTC day.",
        ],
    }
    with open(os.path.join(out_dir, "snapshot_meta.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2)
    logger.info("Snapshot written: %s", meta["counts"])
    return meta


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.abspath(os.path.join(here, "..", ".."))
    build_snapshot(
        raw_dir=os.path.join(root, "data", "raw"),
        out_dir=os.path.join(root, "data", "snapshot"),
    )
