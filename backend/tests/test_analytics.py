from __future__ import annotations

from datetime import date, time

import numpy as np
import pandas as pd
import pytest

from backend.app import analytics, config


@pytest.fixture(scope="module")
def snap():
    return analytics.load_snapshot()


def test_snapshot_covers_every_settlement_period_of_january(snap):
    expected = pd.date_range("2026-01-01", "2026-01-31 23:30", freq="30min", tz="UTC")
    assert len(expected) == 1488
    assert snap.actuals.index.equals(pd.DatetimeIndex(expected)), "January must be gap-free at 30-min resolution"


def test_actuals_are_positive_and_within_capacity(snap):
    a = snap.actuals["actual_mw"]
    assert (a > 0).all()
    assert (a < config.WIND_CAPACITY_MW).all()


def test_each_vintage_covers_the_expected_horizon(snap):
    vintages = snap.vintages
    assert len(vintages) >= 200
    sample = snap.forecasts[snap.forecasts["publishTime"] == vintages[100]]
    assert 100 <= len(sample) <= 170


def test_vintage_is_strictly_before_cutoff(snap):
    day = date(2026, 1, 15)
    df = analytics.delivery_frame(day, time(9, 0), snap)
    cutoff = analytics.decision_cutoff(day, time(9, 0))
    assert pd.Timestamp(df["published_at"].iloc[0]) <= cutoff
    assert df["startTime"].dt.date.unique().tolist() == [day]
    assert len(df) == 48


def test_later_cutoff_uses_equal_or_newer_vintage(snap):
    day = date(2026, 1, 20)
    early = analytics.delivery_frame(day, time(4, 0), snap)["published_at"].iloc[0]
    late = analytics.delivery_frame(day, time(18, 0), snap)["published_at"].iloc[0]
    assert pd.Timestamp(late) >= pd.Timestamp(early)


def test_no_vintage_available_returns_empty(snap):
    df = analytics.delivery_frame(date(2025, 12, 26), time(9, 0), snap)
    assert df.empty


def test_metrics_on_hand_built_frame():
    df = pd.DataFrame(
        {
            "forecast_mw": [1000.0, 2000.0, 3000.0, 4000.0],
            "actual_mw": [900.0, 2100.0, 3000.0, 4600.0],
        }
    )
    df["error_mw"] = df["forecast_mw"] - df["actual_mw"]
    m = analytics.compute_metrics(df, capacity_mw=4000)
    assert m["count"] == 4
    assert m["mae_mw"] == pytest.approx(200.0)
    assert m["mbe_mw"] == pytest.approx(-150.0)
    assert m["rmse_mw"] == pytest.approx(np.sqrt((100**2 + 100**2 + 0 + 600**2) / 4), rel=1e-3)
    assert m["bias_direction"] == "under-forecast"
    assert m["nmae_pct_of_capacity"] == pytest.approx(5.0, abs=0.01)
    assert m["max_abs_error_mw"] == pytest.approx(600.0)


def test_metrics_ignore_missing_actuals():
    df = pd.DataFrame({"forecast_mw": [1000.0, 2000.0], "actual_mw": [1000.0, np.nan]})
    df["error_mw"] = df["forecast_mw"] - df["actual_mw"]
    m = analytics.compute_metrics(df)
    assert m["count"] == 1
    assert m["mae_mw"] == pytest.approx(0.0)


def test_overall_scorecard_is_sane(snap):
    total = pd.concat(
        [analytics.delivery_frame(d, time(9, 0), snap) for d in snap.delivery_dates], ignore_index=True
    )
    m = analytics.compute_metrics(total)
    assert m["count"] == 1488
    assert 0 < m["mae_mw"] < config.WIND_CAPACITY_MW
    assert m["rmse_mw"] >= m["mae_mw"], "RMSE must bound MAE"


def test_debias_improves_and_reports_improvement():
    out = analytics.bias_diagnosis(time(9, 0))
    assert set(out) >= {"raw", "debiased", "mae_improvement_pct"}
    assert out["debiased"]["mae_mw"] < out["raw"]["mae_mw"]
    assert abs(out["debiased"]["mbe_mw"]) < abs(out["raw"]["mbe_mw"])


def test_recommendation_arithmetic():
    rec = analytics.recommendation(date(2026, 1, 15), time(9, 0), base_demand_mw=38000, confidence=0.9)
    assert rec["available"] is True
    s = pd.DataFrame(rec["series"])
    assert ((s["demand_mw"] - s["wind_low_mw"]).clip(lower=0) - s["thermal_secure_mw"]).abs().max() < 0.6
    assert (s["buffer_mw"] >= -0.01).all()
    assert rec["totals"]["buffer_mwh"] == pytest.approx(s["buffer_mw"].sum() * 0.5, rel=1e-3)


def test_higher_confidence_requires_more_cover():
    d = date(2026, 1, 15)
    loose = analytics.recommendation(d, time(9, 0), 38000, 0.8)["totals"]["thermal_secure_mwh"]
    tight = analytics.recommendation(d, time(9, 0), 38000, 0.95)["totals"]["thermal_secure_mwh"]
    assert tight >= loose


def test_demand_shape_validation():
    assert len(analytics.demand_profile(30000)) == 48
    with pytest.raises(ValueError):
        analytics.demand_profile(30000, shape=[1.0, 1.0])


def test_horizon_profile_bins_are_ordered():
    df = analytics.horizon_profile(1.0, 60.0, 3)
    assert len(df) >= 10
    assert df["lead_from_h"].is_monotonic_increasing
    assert (df["rmse_mw"] >= df["mae_mw"]).all()


def test_vintage_matrix_shape(snap):
    mat = analytics.vintage_matrix(date(2026, 1, 15))
    assert mat.shape[1] == 48
    assert mat.shape[0] > 4
    assert mat.index.is_monotonic_increasing
