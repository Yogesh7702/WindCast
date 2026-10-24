from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from functools import lru_cache
from typing import Iterable, Sequence

import numpy as np
import pandas as pd

from . import config


def _resolve_data_dir() -> str:
    if os.path.isdir(config.DATA_DIR):
        return config.DATA_DIR
    if os.path.isdir(_LOCAL_FALLBACK := config._LOCAL_FALLBACK):
        return _LOCAL_FALLBACK
    raise RuntimeError(
        f"Snapshot data not found. Looked in {config.DATA_DIR!r} and "
        f"{config._LOCAL_FALLBACK!r}. Run `python -m backend.app.etl` first."
    )


@dataclass(frozen=True)
class Snapshot:
    actuals: pd.DataFrame
    forecasts: pd.DataFrame
    meta: dict
    data_dir: str

    @property
    def vintages(self) -> pd.DatetimeIndex:
        return pd.DatetimeIndex(sorted(self.forecasts["publishTime"].unique()))

    @property
    def delivery_dates(self) -> list[date]:
        days = sorted(set(self.actuals.index.date))
        return [d for d in days if config.DELIVERY_FROM <= d <= config.DELIVERY_TO]

    def latest_vintage_before(self, ts: pd.Timestamp) -> pd.Timestamp | None:
        candidates = self.vintages[self.vintages <= ts]
        return candidates[-1] if len(candidates) else None


@lru_cache(maxsize=1)
def load_snapshot() -> Snapshot:
    data_dir = _resolve_data_dir()
    act = pd.read_csv(
        os.path.join(data_dir, config.ACTUALS_FILE),
        parse_dates=["startTime", "publishTime"],
    )
    act["startTime"] = pd.to_datetime(act["startTime"], utc=True)
    act = act.rename(columns={"generation": "actual_mw"}).set_index("startTime").sort_index()

    fc = pd.read_csv(os.path.join(data_dir, config.FORECASTS_FILE), parse_dates=["publishTime", "startTime"])
    fc["publishTime"] = pd.to_datetime(fc["publishTime"], utc=True)
    fc["startTime"] = pd.to_datetime(fc["startTime"], utc=True)
    fc = fc.rename(columns={"generation": "forecast_mw"}).sort_values(["publishTime", "startTime"])

    meta_path = os.path.join(data_dir, config.META_FILE)
    meta = json.load(open(meta_path, encoding="utf-8")) if os.path.exists(meta_path) else {}
    meta["available_delivery_days"] = sorted({d.isoformat() for d in act.index.date})
    meta["installed_capacity_mw"] = config.WIND_CAPACITY_MW
    meta["rows_loaded"] = {"actuals": int(len(act)), "forecasts": int(len(fc))}
    return Snapshot(actuals=act, forecasts=fc, meta=meta, data_dir=data_dir)


def reload_snapshot() -> Snapshot:
    load_snapshot.cache_clear()
    return load_snapshot()


def decision_cutoff(delivery_date: date, cutoff_time: time) -> pd.Timestamp:
    return pd.Timestamp(datetime.combine(delivery_date - timedelta(days=1), cutoff_time), tz="UTC")


def delivery_frame(
    delivery_date: date,
    cutoff_time: time = config.DEFAULT_DECISION_TIME,
    snapshot: Snapshot | None = None,
) -> pd.DataFrame:
    snap = snapshot or load_snapshot()
    cutoff = decision_cutoff(delivery_date, cutoff_time)
    vintage = snap.latest_vintage_before(cutoff)
    if vintage is None:
        return pd.DataFrame(
            columns=[
                "startTime", "settlementDate", "settlementPeriod", "forecast_mw",
                "actual_mw", "error_mw", "abs_error_mw", "lead_hours", "published_at",
            ]
        )

    day = snap.forecasts[
        (snap.forecasts["publishTime"] == vintage)
        & (snap.forecasts["startTime"].dt.date == delivery_date)
    ].copy()
    day = day.set_index("startTime").sort_index()
    day["actual_mw"] = snap.actuals["actual_mw"].reindex(day.index)
    day["error_mw"] = day["forecast_mw"] - day["actual_mw"]
    day["abs_error_mw"] = day["error_mw"].abs()
    day["lead_hours"] = (day.index - vintage).total_seconds() / 3600.0
    day["published_at"] = vintage
    day["settlementDate"] = delivery_date
    day["settlementPeriod"] = [
        int(ts.hour * 2 + (1 if ts.minute >= 30 else 0)) + 1 for ts in day.index
    ]
    return day.reset_index()[
        [
            "startTime", "settlementDate", "settlementPeriod", "forecast_mw",
            "actual_mw", "error_mw", "abs_error_mw", "lead_hours", "published_at",
        ]
    ].sort_values("startTime").reset_index(drop=True)


def _safe_div(a: float, b: float) -> float:
    return float(a) / float(b) if b not in (0, None) and not math.isnan(b) else float("nan")


def compute_metrics(df: pd.DataFrame, capacity_mw: float = config.WIND_CAPACITY_MW) -> dict:
    d = df.dropna(subset=["forecast_mw", "actual_mw"]).copy()
    if d.empty:
        return {"count": 0}

    d["error_mw"] = d["forecast_mw"] - d["actual_mw"]
    err = d["error_mw"].to_numpy(dtype=float)
    fc = d["forecast_mw"].to_numpy(dtype=float)
    act = d["actual_mw"].to_numpy(dtype=float)

    mae = float(np.mean(np.abs(err)))
    rmse = float(np.sqrt(np.mean(err**2)))
    mbe = float(np.mean(err))
    nonzero = np.abs(act) > 100.0
    mape = float(np.mean(np.abs(err[nonzero]) / np.abs(act[nonzero]))) * 100 if nonzero.any() else float("nan")
    ss_res = float(np.sum(err**2))
    ss_tot = float(np.sum((act - act.mean()) ** 2)) if len(act) > 1 else float("nan")
    r2 = 1.0 - ss_res / ss_tot if ss_tot and not math.isnan(ss_tot) else float("nan")

    return {
        "count": int(len(d)),
        "mae_mw": round(mae, 1),
        "rmse_mw": round(rmse, 1),
        "mbe_mw": round(mbe, 1),
        "mape_pct": round(mape, 1) if not math.isnan(mape) else None,
        "nmae_pct_of_capacity": round(_safe_div(mae, capacity_mw) * 100, 2),
        "nmae_pct_of_mean_actual": round(_safe_div(mae, float(np.mean(act))) * 100, 2),
        "r2": round(r2, 3) if not math.isnan(r2) else None,
        "p90_abs_error_mw": round(float(np.percentile(np.abs(err), 90)), 1),
        "max_abs_error_mw": round(float(np.max(np.abs(err))), 1),
        "share_within_1gw_pct": round(float(np.mean(np.abs(err) <= 1000)) * 100, 1),
        "energy_mae_mwh": round(mae * 0.5, 1),
        "bias_direction": "over-forecast" if mbe > 0 else "under-forecast",
    }


@lru_cache(maxsize=4)
def horizon_profile(min_lead_h: float = 1.0, max_lead_h: float = 60.0, bin_h: int = 3) -> pd.DataFrame:
    snap = load_snapshot()
    f = snap.forecasts.copy()
    f["actual_mw"] = snap.actuals["actual_mw"].reindex(f["startTime"]).to_numpy()
    f["lead_hours"] = (f["startTime"] - f["publishTime"]).dt.total_seconds() / 3600.0
    f = f.dropna(subset=["actual_mw"])
    f = f[(f["lead_hours"] >= min_lead_h) & (f["lead_hours"] <= max_lead_h)]
    f = f[f["startTime"].dt.date >= config.DELIVERY_FROM]
    f = f[f["startTime"].dt.date <= config.DELIVERY_TO]
    f["error_mw"] = f["forecast_mw"] - f["actual_mw"]

    edges = np.arange(math.floor(min_lead_h), max_lead_h + bin_h, bin_h)
    f["bucket"] = pd.cut(f["lead_hours"], bins=edges, right=False)
    rows = []
    for bucket, g in f.groupby("bucket", observed=True):
        err = g["error_mw"].to_numpy(dtype=float)
        rows.append(
            {
                "lead_from_h": round(float(bucket.left), 1),
                "lead_to_h": round(float(bucket.right), 1),
                "label": f"{int(bucket.left)}-{int(bucket.right)}h",
                "count": int(len(g)),
                "mae_mw": round(float(np.mean(np.abs(err))), 1),
                "rmse_mw": round(float(np.sqrt(np.mean(err**2))), 1),
                "bias_mw": round(float(np.mean(err)), 1),
                "p10_error_mw": round(float(np.percentile(err, 10)), 1),
                "p90_error_mw": round(float(np.percentile(err, 90)), 1),
            }
        )
    return pd.DataFrame(rows)


@lru_cache(maxsize=2)
def error_quantiles_by_lead(min_lead_h: int = 1, max_lead_h: int = 60) -> pd.DataFrame:
    snap = load_snapshot()
    f = snap.forecasts.copy()
    f["actual_mw"] = snap.actuals["actual_mw"].reindex(f["startTime"]).to_numpy()
    f["lead_hours"] = (f["startTime"] - f["publishTime"]).dt.total_seconds() / 3600.0
    f = f.dropna(subset=["actual_mw"])
    f = f[(f["lead_hours"] >= 0.5) & (f["lead_hours"] <= max_lead_h)]
    f = f[(f["startTime"].dt.date >= config.DELIVERY_FROM) & (f["startTime"].dt.date <= config.DELIVERY_TO)]
    f["lead_int"] = f["lead_hours"].round().astype(int)
    f["error_mw"] = f["forecast_mw"] - f["actual_mw"]

    rows = []
    for lead, g in f.groupby("lead_int"):
        err = g["error_mw"].to_numpy(dtype=float)
        rows.append(
            {
                "lead_hours": int(lead),
                "count": int(len(g)),
                "q05": float(np.percentile(err, 5)),
                "q10": float(np.percentile(err, 10)),
                "q25": float(np.percentile(err, 25)),
                "q50": float(np.percentile(err, 50)),
                "q75": float(np.percentile(err, 75)),
                "q90": float(np.percentile(err, 90)),
                "q95": float(np.percentile(err, 95)),
                "mae": float(np.mean(np.abs(err))),
            }
        )
    return pd.DataFrame(rows).sort_values("lead_hours").reset_index(drop=True)


def quantiles_for_leads(leads: Sequence[float]) -> pd.DataFrame:
    table = error_quantiles_by_lead()
    if table.empty:
        return pd.DataFrame()
    idx = table.set_index("lead_hours")
    out = []
    for lead in leads:
        key = int(min(max(round(lead), int(idx.index.min())), int(idx.index.max())))
        row = idx.loc[key].to_dict()
        row["requested_lead_hours"] = round(float(lead), 2)
        row["lead_hours"] = key
        out.append(row)
    return pd.DataFrame(out)


def _all_forward_points() -> pd.DataFrame:
    snap = load_snapshot()
    f = snap.forecasts.copy()
    f["actual_mw"] = snap.actuals["actual_mw"].reindex(f["startTime"]).to_numpy()
    f["lead_hours"] = (f["startTime"] - f["publishTime"]).dt.total_seconds() / 3600.0
    f = f.dropna(subset=["actual_mw"])
    f = f[(f["lead_hours"] >= 1.0) & (f["lead_hours"] <= 60.0)]
    f = f[(f["startTime"].dt.date >= config.DELIVERY_FROM) & (f["startTime"].dt.date <= config.DELIVERY_TO)]
    f["error_mw"] = f["forecast_mw"] - f["actual_mw"]
    f["abs_error_mw"] = f["error_mw"].abs()
    f["hour"] = f["startTime"].dt.hour
    f["day"] = f["startTime"].dt.date
    return f


@lru_cache(maxsize=1)
def hourly_profile() -> pd.DataFrame:
    f = _all_forward_points()
    rows = []
    for hour, g in f.groupby("hour"):
        err = g["error_mw"].to_numpy(dtype=float)
        rows.append(
            {
                "hour": int(hour),
                "label": f"{int(hour):02d}:00",
                "count": int(len(g)),
                "mae_mw": round(float(np.mean(np.abs(err))), 1),
                "bias_mw": round(float(np.mean(err)), 1),
                "mean_actual_mw": round(float(g["actual_mw"].mean()), 1),
                "mean_forecast_mw": round(float(g["forecast_mw"].mean()), 1),
            }
        )
    return pd.DataFrame(rows)


@lru_cache(maxsize=8)
def daily_table(cutoff: str = "09:00") -> pd.DataFrame:
    snap = load_snapshot()
    t = datetime.strptime(cutoff, "%H:%M").time()
    rows = []
    for day in snap.delivery_dates:
        df = delivery_frame(day, t, snap)
        if df.empty:
            continue
        metrics = compute_metrics(df)
        rows.append(
            {
                "date": day.isoformat(),
                "vintage_used": pd.Timestamp(df["published_at"].iloc[0]).isoformat(),
                "count": metrics["count"],
                "mae_mw": metrics["mae_mw"],
                "rmse_mw": metrics["rmse_mw"],
                "bias_mw": metrics["mbe_mw"],
                "mape_pct": metrics["mape_pct"],
                "mean_actual_mw": round(float(df["actual_mw"].mean()), 1),
                "mean_forecast_mw": round(float(df["forecast_mw"].mean()), 1),
                "worst_abs_error_mw": metrics["max_abs_error_mw"],
            }
        )
    return pd.DataFrame(rows).sort_values("date").reset_index(drop=True)


@lru_cache(maxsize=2)
def error_histogram(bin_mw: int = 500, limit_mw: int = 6000) -> pd.DataFrame:
    f = _all_forward_points()
    err = f["error_mw"].clip(-limit_mw, limit_mw)
    edges = np.arange(-limit_mw, limit_mw + bin_mw, bin_mw)
    counts, _ = np.histogram(err, bins=edges)
    mid = (edges[:-1] + edges[1:]) / 2
    return pd.DataFrame(
        {
            "bin_center_mw": mid,
            "bin_from_mw": edges[:-1],
            "bin_to_mw": edges[1:],
            "count": counts,
            "share_pct": np.round(counts / max(len(err), 1) * 100, 2),
        }
    )


@lru_cache(maxsize=2)
def scatter_points(max_points: int = 1200, seed: int = 7) -> pd.DataFrame:
    f = _all_forward_points()
    if len(f) > max_points:
        f = f.sample(n=max_points, random_state=seed)
    return f[["forecast_mw", "actual_mw", "lead_hours"]].round(1).reset_index(drop=True)


@lru_cache(maxsize=2)
def calibration(bins: int = 10) -> pd.DataFrame:
    f = _all_forward_points().copy()
    f["bucket"] = pd.qcut(f["forecast_mw"], q=bins, duplicates="drop")
    rows = []
    for b, g in f.groupby("bucket", observed=True):
        rows.append(
            {
                "bucket": str(b),
                "bin_from_mw": round(float(g["forecast_mw"].min()), 0),
                "bin_to_mw": round(float(g["forecast_mw"].max()), 0),
                "mean_forecast_mw": round(float(g["forecast_mw"].mean()), 1),
                "mean_actual_mw": round(float(g["actual_mw"].mean()), 1),
                "bias_mw": round(float((g["forecast_mw"] - g["actual_mw"]).mean()), 1),
                "count": int(len(g)),
            }
        )
    return pd.DataFrame(rows)


def vintage_matrix(delivery_date: date) -> pd.DataFrame:
    snap = load_snapshot()
    lo = pd.Timestamp(datetime.combine(delivery_date - timedelta(days=2), time(0, 0)), tz="UTC")
    hi = pd.Timestamp(datetime.combine(delivery_date, time(0, 0)), tz="UTC")
    f = snap.forecasts[
        (snap.forecasts["startTime"].dt.date == delivery_date)
        & (snap.forecasts["publishTime"] >= lo)
        & (snap.forecasts["publishTime"] < hi)
    ]
    if f.empty:
        return pd.DataFrame()
    mat = f.pivot_table(index="publishTime", columns="startTime", values="forecast_mw")
    return mat.sort_index()


def demand_profile(base_demand_mw: float, shape: Sequence[float] | None = None) -> np.ndarray:
    shape = list(shape) if shape else config.TYPICAL_DEMAND_SHAPE
    if len(shape) != 48:
        raise ValueError("Demand shape must have 48 settlement period multipliers")
    return np.array([base_demand_mw * m for m in shape], dtype=float)


def recommendation(
    delivery_date: date,
    cutoff_time: time = config.DEFAULT_DECISION_TIME,
    base_demand_mw: float = config.DEFAULT_BASE_DEMAND_MW,
    confidence: float = config.DEFAULT_CONFIDENCE,
    demand_shape: Sequence[float] | None = None,
) -> dict:
    df = delivery_frame(delivery_date, cutoff_time)
    if df.empty:
        return {"available": False, "reason": "No forecast vintage available before the cut-off."}

    q = quantiles_for_leads(df["lead_hours"].tolist())
    alpha = (1.0 - confidence)
    qcol = "q10" if alpha <= 0.10 else ("q25" if alpha <= 0.25 else "q05")
    p_hi_col = {"q10": "q90", "q25": "q75", "q05": "q95"}[qcol]

    shape = list(demand_shape) if demand_shape else config.TYPICAL_DEMAND_SHAPE
    demand = demand_profile(base_demand_mw, shape)

    d = df.copy().reset_index(drop=True)
    d["demand_mw"] = np.round(demand[: len(d)], 1)
    d["error_low_mw"] = q[qcol].to_numpy()
    d["error_high_mw"] = q[p_hi_col].to_numpy()
    d["wind_low_mw"] = (d["forecast_mw"] + d["error_low_mw"]).clip(lower=0).round(1)
    d["wind_high_mw"] = (d["forecast_mw"] + d["error_high_mw"]).clip(lower=0, upper=config.WIND_CAPACITY_MW).round(1)
    d["wind_expected_mw"] = d["forecast_mw"].round(1)
    d["thermal_expected_mw"] = (d["demand_mw"] - d["wind_expected_mw"]).clip(lower=0).round(1)
    d["thermal_secure_mw"] = (d["demand_mw"] - d["wind_low_mw"]).clip(lower=0).round(1)
    d["buffer_mw"] = (d["thermal_secure_mw"] - d["thermal_expected_mw"]).round(1)

    hours = 0.5
    totals = {
        "wind_expected_mwh": round(float(d["wind_expected_mw"].sum()) * hours, 0),
        "wind_low_mwh": round(float(d["wind_low_mw"].sum()) * hours, 0),
        "thermal_expected_mwh": round(float(d["thermal_expected_mw"].sum()) * hours, 0),
        "thermal_secure_mwh": round(float(d["thermal_secure_mw"].sum()) * hours, 0),
        "buffer_mwh": round(float(d["buffer_mw"].sum()) * hours, 0),
        "peak_thermal_expected_mw": round(float(d["thermal_expected_mw"].max()), 0),
        "peak_thermal_secure_mw": round(float(d["thermal_secure_mw"].max()), 0),
    }
    exposure = {
        "buffer_cost_gbp": round(totals["buffer_mwh"] * config.DEFAULT_DA_COST, 0),
        "avoided_shortfall_gbp": round(totals["buffer_mwh"] * config.DEFAULT_BALANCING_COST, 0),
        "da_price_gbp_mwh": config.DEFAULT_DA_COST,
        "balancing_price_gbp_mwh": config.DEFAULT_BALANCING_COST,
    }

    return {
        "available": True,
        "delivery_date": delivery_date.isoformat(),
        "cutoff_utc": decision_cutoff(delivery_date, cutoff_time).isoformat(),
        "vintage_used": pd.Timestamp(df["published_at"].iloc[0]).isoformat(),
        "confidence": confidence,
        "quantile_used": qcol,
        "base_demand_mw": base_demand_mw,
        "lead_hours_range": [round(float(d["lead_hours"].min()), 2), round(float(d["lead_hours"].max()), 2)],
        "totals": totals,
        "exposure": exposure,
        "assumptions": {
            "demand": "Illustrative national demand shape (user editable). Demand is outside the "
                      "agreed Elexon data scope; replace with the client's own demand forecast.",
            "error_quantiles": "Empirical Jan-2026 WINDFOR error quantiles by lead hour, pooled across all vintages.",
            "prices": "DA 85 GBP/MWh and balancing 120 GBP/MWh are indicative placeholders.",
        },
        "series": d[
            [
                "startTime", "settlementPeriod", "lead_hours", "forecast_mw", "wind_low_mw", "wind_high_mw",
                "wind_expected_mw", "demand_mw", "thermal_expected_mw", "thermal_secure_mw", "buffer_mw",
                "actual_mw", "error_mw",
            ]
        ].assign(startTime=lambda x: x["startTime"].astype(str)).to_dict(orient="records"),
    }


def bias_diagnosis(cutoff_time: time = config.DEFAULT_DECISION_TIME) -> dict:
    snap = load_snapshot()
    frames = []
    for d in snap.delivery_dates:
        df = delivery_frame(d, cutoff_time, snap)
        if not df.empty:
            frames.append(df.assign(day=d))
    if not frames:
        return {}
    allp = pd.concat(frames, ignore_index=True)
    allp["lead_bucket"] = allp["lead_hours"].round().astype(int)

    corrected = []
    for day, g in allp.groupby("day"):
        other = allp[allp["day"] != day]
        med = other.groupby("lead_bucket")["error_mw"].median()
        g = g.copy()
        g["correction_mw"] = g["lead_bucket"].map(med).fillna(other["error_mw"].median())
        g["debiased_forecast_mw"] = g["forecast_mw"] - g["correction_mw"]
        corrected.append(g)
    corr = pd.concat(corrected, ignore_index=True)
    corr["forecast_mw"] = corr["debiased_forecast_mw"]
    corr["error_mw"] = corr["forecast_mw"] - corr["actual_mw"]

    raw = compute_metrics(allp)
    fixed = compute_metrics(corr)
    mae_improvement = (1 - fixed["mae_mw"] / raw["mae_mw"]) * 100 if raw["mae_mw"] else 0.0
    return {
        "cutoff_utc_time": cutoff_time.strftime("%H:%M"),
        "raw": raw,
        "debias_method": "leave-one-day-out median error per lead hour",
        "debiased": fixed,
        "mae_improvement_pct": round(mae_improvement, 1),
        "mean_correction_mw": round(float(corr["correction_mw"].mean()), 1),
        "diagnosis": (
            "The forecast is biased high against FUELHH WIND actuals. Part of this is a "
            "definitional gap (FUELHH WIND is transmission-connected wind, WINDFOR is a "
            "national wind forecast that also reflects embedded wind), part is model bias. "
            "Removing the bias out-of-sample cuts MAE by "
            f"{mae_improvement:.0f}% and is the recommended step before using the forecast "
            "for procurement sizing."
        ),
    }
