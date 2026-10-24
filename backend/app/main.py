from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from datetime import date, datetime, time

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import analytics, config

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("windcast.api")


@asynccontextmanager
async def lifespan(_: FastAPI):
    snap = analytics.load_snapshot()
    logger.info(
        "Snapshot loaded from %s | actuals=%s forecasts=%s vintages=%s",
        snap.data_dir,
        len(snap.actuals),
        len(snap.forecasts),
        snap.forecasts["publishTime"].nunique(),
    )
    yield


app = FastAPI(
    lifespan=lifespan,
    title="WindCast API",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


def _parse_date(value: str) -> date:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as exc:
        raise HTTPException(400, f"Invalid date {value!r}, expected YYYY-MM-DD") from exc


def _parse_time(value: str) -> time:
    try:
        return datetime.strptime(value, "%H:%M").time()
    except ValueError as exc:
        raise HTTPException(400, f"Invalid time {value!r}, expected HH:MM (UTC)") from exc


def _check_day(delivery_date: date) -> None:
    snap = analytics.load_snapshot()
    if delivery_date not in snap.delivery_dates:
        raise HTTPException(
            404,
            f"No delivery data for {delivery_date}. Available: "
            f"{snap.delivery_dates[0]} .. {snap.delivery_dates[-1]}",
        )


@app.get("/api/health", tags=["meta"])
def health() -> dict:
    snap = analytics.load_snapshot()
    return {
        "status": "ok",
        "data_dir": snap.data_dir,
        "actuals_rows": int(len(snap.actuals)),
        "forecast_rows": int(len(snap.forecasts)),
        "vintages": int(snap.forecasts["publishTime"].nunique()),
        "snapshot_generated_at": snap.meta.get("generated_at"),
    }


@app.get("/api/meta", tags=["meta"])
def meta() -> dict:
    snap = analytics.load_snapshot()
    vintages = snap.vintages
    return {
        **snap.meta,
        "delivery_dates": [d.isoformat() for d in snap.delivery_dates],
        "default_decision_time": config.DEFAULT_DECISION_TIME.strftime("%H:%M"),
        "default_confidence": config.DEFAULT_CONFIDENCE,
        "default_base_demand_mw": config.DEFAULT_BASE_DEMAND_MW,
        "prices": {"da_gbp_mwh": config.DEFAULT_DA_COST, "balancing_gbp_mwh": config.DEFAULT_BALANCING_COST},
        "typical_demand_shape": config.TYPICAL_DEMAND_SHAPE,
        "data_window": {
            "actuals_from": snap.actuals.index.min().isoformat(),
            "actuals_to": snap.actuals.index.max().isoformat(),
            "vintages_from": vintages.min().isoformat(),
            "vintages_to": vintages.max().isoformat(),
        },
        "methodology": {
            "error_definition": "error = forecast - actual (positive = over-forecast)",
            "resolution": "30-minute settlement periods; WINDFOR hourly values applied to both half-hours",
            "timezone": "All timestamps UTC. January 2026 is GMT, so settlement day == UTC day.",
            "lead_time": "lead = delivery start - forecast publish time",
            "scope": "National wind only (FUELHH fuelType=WIND + WINDFOR). No other fuel types or demand data.",
        },
    }


@app.get("/api/decision/vintages", tags=["decision"])
def available_vintages(delivery_date: str = Query(alias="date")) -> dict:
    d = _parse_date(delivery_date)
    _check_day(d)
    snap = analytics.load_snapshot()
    lo = pd.Timestamp(datetime.combine(d, time(0, 0)), tz="UTC") - pd.Timedelta(days=2)
    hi = pd.Timestamp(datetime.combine(d, time(0, 0)), tz="UTC")
    v = snap.vintages[(snap.vintages >= lo) & (snap.vintages < hi)]
    return {
        "delivery_date": d.isoformat(),
        "vintages": [
            {
                "publishTime": pd_ts.isoformat(),
                "lead_hours_to_first_sp": round(
                    (pd.Timestamp(datetime.combine(d, time(0, 0)), tz="UTC") - pd_ts).total_seconds() / 3600, 2
                ),
            }
            for pd_ts in v
        ],
    }


@app.get("/api/decision/forecast", tags=["decision"])
def decision_forecast(
    delivery_date: str = Query(alias="date"),
    cutoff: str = Query(default=config.DEFAULT_DECISION_TIME.strftime("%H:%M")),
) -> dict:
    d = _parse_date(delivery_date)
    _check_day(d)
    df = analytics.delivery_frame(d, _parse_time(cutoff))
    if df.empty:
        raise HTTPException(404, "No forecast vintage exists before this cut-off.")
    return {
        "delivery_date": d.isoformat(),
        "cutoff_utc": analytics.decision_cutoff(d, _parse_time(cutoff)).isoformat(),
        "vintage_used": str(df["published_at"].iloc[0]),
        "lead_hours": {
            "min": round(float(df["lead_hours"].min()), 2),
            "max": round(float(df["lead_hours"].max()), 2),
        },
        "metrics": analytics.compute_metrics(df),
        "series": df.assign(startTime=df["startTime"].astype(str)).to_dict(orient="records"),
    }


@app.get("/api/decision/recommendation", tags=["decision"])
def decision_recommendation(
    delivery_date: str = Query(alias="date"),
    cutoff: str = Query(default=config.DEFAULT_DECISION_TIME.strftime("%H:%M")),
    base_demand_mw: float = Query(default=config.DEFAULT_BASE_DEMAND_MW, ge=5000, le=70000),
    confidence: float = Query(default=config.DEFAULT_CONFIDENCE, gt=0.5, lt=1.0),
) -> dict:
    d = _parse_date(delivery_date)
    _check_day(d)
    return analytics.recommendation(d, _parse_time(cutoff), base_demand_mw, confidence)


@app.get("/api/decision/revisions", tags=["decision"])
def forecast_revisions(delivery_date: str = Query(alias="date")) -> dict:
    d = _parse_date(delivery_date)
    _check_day(d)
    mat = analytics.vintage_matrix(d)
    if mat.empty:
        raise HTTPException(404, "No vintages cover this delivery day.")
    snap = analytics.load_snapshot()
    actual = snap.actuals["actual_mw"].reindex(mat.columns)
    return {
        "delivery_date": d.isoformat(),
        "start_times": [c.isoformat() for c in mat.columns],
        "publish_times": [i.isoformat() for i in mat.index],
        "matrix": [[None if np.isnan(v) else round(float(v), 1) for v in row] for row in mat.to_numpy()],
        "actual": [None if np.isnan(v) else round(float(v), 1) for v in actual.to_numpy()],
    }


@app.get("/api/accuracy/summary", tags=["accuracy"])
def accuracy_summary(cutoff: str = Query(default=config.DEFAULT_DECISION_TIME.strftime("%H:%M"))) -> dict:
    snap = analytics.load_snapshot()
    t = _parse_time(cutoff)
    frames = [analytics.delivery_frame(d, t, snap) for d in snap.delivery_dates]
    frames = [f for f in frames if not f.empty]
    if not frames:
        raise HTTPException(404, "No data for this cut-off.")
    combined = pd.concat(frames, ignore_index=True)
    overall = analytics.compute_metrics(combined)
    per_day = analytics.daily_table(cutoff)
    worst = per_day.sort_values("mae_mw", ascending=False).head(1)
    best = per_day.sort_values("mae_mw").head(1)
    naive = analytics.compute_metrics(combined.assign(forecast_mw=combined["actual_mw"].mean()))
    return {
        "cutoff_utc_time": cutoff,
        "delivery_days": len(frames),
        "metrics": overall,
        "mean_actual_mw": round(float(combined["actual_mw"].mean()), 1),
        "mean_forecast_mw": round(float(combined["forecast_mw"].mean()), 1),
        "lead_hours_range": [
            round(float(combined["lead_hours"].min()), 2),
            round(float(combined["lead_hours"].max()), 2),
        ],
        "worst_day": worst.to_dict(orient="records")[0] if not worst.empty else None,
        "best_day": best.to_dict(orient="records")[0] if not best.empty else None,
        "benchmark_mean_forecast": naive,
        "total_abs_error_mwh": round(float(combined["abs_error_mw"].sum()) * 0.5, 0),
    }


@app.get("/api/accuracy/bias", tags=["accuracy"])
def accuracy_bias(cutoff: str = Query(default=config.DEFAULT_DECISION_TIME.strftime("%H:%M"))) -> dict:
    return analytics.bias_diagnosis(_parse_time(cutoff))


@app.get("/api/accuracy/horizon", tags=["accuracy"])
def accuracy_horizon(
    max_lead_h: int = Query(default=60, ge=6, le=72),
    bin_h: int = Query(default=3, ge=1, le=12),
) -> dict:
    df = analytics.horizon_profile(1.0, float(max_lead_h), bin_h)
    return {"bin_hours": bin_h, "rows": df.round(1).to_dict(orient="records")}


@app.get("/api/accuracy/hourly", tags=["accuracy"])
def accuracy_hourly() -> dict:
    return {"rows": analytics.hourly_profile().to_dict(orient="records")}


@app.get("/api/accuracy/daily", tags=["accuracy"])
def accuracy_daily(cutoff: str = Query(default=config.DEFAULT_DECISION_TIME.strftime("%H:%M"))) -> dict:
    return {"cutoff_utc_time": cutoff, "rows": analytics.daily_table(cutoff).to_dict(orient="records")}


@app.get("/api/accuracy/distribution", tags=["accuracy"])
def accuracy_distribution(bin_mw: int = Query(default=500, ge=100, le=2000)) -> dict:
    df = analytics.error_histogram(bin_mw)
    return {"bin_mw": bin_mw, "rows": df.to_dict(orient="records")}


@app.get("/api/accuracy/scatter", tags=["accuracy"])
def accuracy_scatter() -> dict:
    return {"rows": analytics.scatter_points().to_dict(orient="records")}


@app.get("/api/accuracy/calibration", tags=["accuracy"])
def accuracy_calibration() -> dict:
    return {"rows": analytics.calibration().to_dict(orient="records")}


@app.get("/api/accuracy/quantiles", tags=["accuracy"])
def accuracy_quantiles() -> dict:
    return {"rows": analytics.error_quantiles_by_lead().round(1).to_dict(orient="records")}


@app.post("/api/admin/refresh", tags=["admin"])
def refresh_data() -> dict:
    from . import etl

    root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    try:
        meta = etl.build_snapshot(
            raw_dir=os.path.join(root, "data", "raw"),
            out_dir=os.path.join(root, "data", "snapshot"),
        )
    except Exception as exc:
        raise HTTPException(502, f"Elexon refresh failed: {exc}") from exc
    analytics.reload_snapshot()
    return {"status": "refreshed", "meta": meta}


@app.exception_handler(Exception)
def _unhandled(request, exc):
    logger.exception("Unhandled error on %s", request.url)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


STATIC_DIR = os.getenv("STATIC_DIR", "")
if STATIC_DIR and os.path.isdir(STATIC_DIR):
    from fastapi.responses import FileResponse

    app.mount("/assets", StaticFiles(directory=os.path.join(STATIC_DIR, "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        candidate = os.path.join(STATIC_DIR, full_path)
        if full_path and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))
