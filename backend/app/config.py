from __future__ import annotations

import os
from datetime import date, time

DATA_DIR = os.getenv("DATA_DIR", "/app/data/snapshot")
_LOCAL_FALLBACK = os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "snapshot")
)
ACTUALS_FILE = "wind_actuals_hh.csv"
FORECASTS_FILE = "wind_forecasts_hh.csv"
META_FILE = "snapshot_meta.json"

WIND_CAPACITY_MW = float(os.getenv("WIND_CAPACITY_MW", "30000"))
DEFAULT_DECISION_TIME = time(9, 0)
DEFAULT_CONFIDENCE = 0.90
DEFAULT_BALANCING_COST = float(os.getenv("BALANCING_COST_GBP_MWH", "120"))
DEFAULT_DA_COST = float(os.getenv("DA_PRICE_GBP_MWH", "85"))

TYPICAL_DEMAND_SHAPE = [
    0.86, 0.84, 0.82, 0.81, 0.80, 0.80, 0.81, 0.83, 0.87, 0.91, 0.94, 0.96,
    0.97, 0.97, 0.96, 0.95, 0.95, 0.96, 0.98, 1.01, 1.04, 1.07, 1.09, 1.10,
    1.10, 1.09, 1.07, 1.05, 1.03, 1.01, 1.00, 0.99, 0.98, 0.97, 0.96, 0.96,
    0.96, 0.97, 0.98, 1.00, 1.02, 1.03, 1.03, 1.02, 1.00, 0.97, 0.93, 0.89,
]
DEFAULT_BASE_DEMAND_MW = float(os.getenv("BASE_DEMAND_MW", "38000"))

DELIVERY_FROM = date(2026, 1, 1)
DELIVERY_TO = date(2026, 1, 31)
