import React from "react";
import { Callout, Panel } from "../components/ui";
import { fmtGW, fmtMW } from "../utils";

export default function Method({ meta }) {
  const m = meta.methodology;
  return (
    <div className="page prose">
      <Panel title="Scope" subtitle="What is in the product, and what is deliberately out of it.">
        <div className="grid-2 tight">
          <div>
            <h3>In scope</h3>
            <ul>
              <li>National wind generation outturn — Elexon <code>FUELHH</code>, <code>fuelType = WIND</code>.</li>
              <li>National wind generation forecasts — Elexon <code>WINDFOR</code>, with the publication timestamp of
                every vintage retained.</li>
              <li>Half-hourly settlement periods for delivery days 1–31 January 2026, plus the December vintages needed
                to make the 1 January decision.</li>
              <li>Quantified forecast error, its drivers, and the risk-adjusted procurement implication.</li>
            </ul>
          </div>
          <div>
            <h3>Out of scope</h3>
            <ul>
              <li>Every other fuel type, interconnector flows and demand — only used as a user-editable placeholder to
                show the thermal top-up arithmetic.</li>
              <li>Actual order-book, auction-clearing prices and imbalance settlement maths.</li>
              <li>Forecast model retraining: WindCast consumes WINDFOR, it does not replace it.</li>
            </ul>
          </div>
        </div>
      </Panel>

      <Panel title="Method & assumptions" subtitle="Every number in the UI traces back to one of these rules.">
        <table className="kv">
          <tbody>
            <tr><th>Error definition</th><td>{m.error_definition}</td></tr>
            <tr><th>Resolution</th><td>{m.resolution}</td></tr>
            <tr><th>Time zone</th><td>{m.timezone}</td></tr>
            <tr><th>Lead time</th><td>{m.lead_time}</td></tr>
            <tr><th>Vintage selection</th><td>For a delivery day D and cut-off t, the newest WINDFOR vintage published at or before (D−1) t is used. This mirrors the day-ahead auction gate closure (~09:15 UK) and avoids look-ahead bias.</td></tr>
            <tr><th>Uncertainty bands</th><td>Empirical quantiles of (forecast − actual) per integer lead hour, computed from January 2026 points only. P10/P90 default, switchable to P05/P95 or P25/P75.</td></tr>
            <tr><th>Capacity normalisation</th><td>Installed wind capacity assumed {fmtGW(meta.installed_capacity_mw, 0)} for the % -of-capacity error metric.</td></tr>
            <tr><th>Demand</th><td>Illustrative national demand shape (48 settlement periods, average {fmtGW(meta.default_base_demand_mw)}), adjustable in the cockpit. It is a framing device for the thermal top-up, not an Elexon feed.</td></tr>
            <tr><th>Prices</th><td>Indicative £{meta.prices.da_gbp_mwh}/MWh day-ahead and £{meta.prices.balancing_gbp_mwh}/MWh balancing, configurable via environment variables.</td></tr>
            <tr><th>Data snapshot</th><td>Generated {meta.generated_at}. {meta.rows_loaded?.actuals?.toLocaleString("en-GB")} actual and {meta.rows_loaded?.forecasts?.toLocaleString("en-GB")} half-hourly forecast rows, {meta.counts?.distinct_vintages} vintages.</td></tr>
          </tbody>
        </table>
      </Panel>

      <Panel title="Architecture" subtitle="Two containers, one API contract, zero runtime dependency on Elexon.">
        <pre className="diagram">{`┌──────────────────────────── Browser ────────────────────────────┐
│  React 18 + Vite SPA (Recharts)                                 │
│   Cockpit │ Accuracy │ Revisions │ Method                       │
└───────────────┬─────────────────────────────────────────────────┘
                │  fetch /api/*  (nginx proxy in prod, vite proxy in dev)
┌───────────────▼─────────────────────────────────────────────────┐
│  FastAPI (Python 3.12) — backend/app                             │
│   main.py       REST layer, validation, OpenAPI docs at /docs     │
│   analytics.py  pure pandas/numpy metrics (unit tested)           │
│   etl.py        Elexon BMRS puller, chunked to the 7-day limit    │
│   config.py     assumptions & tunables                            │
└───────────────┬─────────────────────────────────────────────────┘
                │  CSV snapshot committed to the repo
┌───────────────▼─────────────────────────────────────────────────┐
│  data/snapshot/wind_actuals_hh.csv, wind_forecasts_hh.csv         │
│  data/snapshot/snapshot_meta.json  (lineage + row counts)          │
└───────────────┬─────────────────────────────────────────────────┘
                │  POST /api/admin/refresh  (idempotent, re-runnable)
         Elexon BMRS: FUELHH, WINDFOR`}</pre>
        <Callout tone="info" title="Why a committed snapshot?">
          The client demo must be reproducible on a reviewer's laptop with no API key and no network, and must not
          break because Elexon is slow at 9am. The ETL is a first-class, re-runnable script — the snapshot is just its
          latest output.
        </Callout>
      </Panel>

      <Panel title="API surface" subtitle="Fully typed and self-documenting at /docs (Swagger UI).">
        <table className="kv">
          <tbody>
            <tr><th>GET /api/meta</th><td>Snapshot lineage, scope, assumptions, tunables.</td></tr>
            <tr><th>GET /api/decision/forecast?date=&amp;cutoff=</th><td>The actionable forecast, the matching vintage and the realised actual per settlement period.</td></tr>
            <tr><th>GET /api/decision/recommendation?date=&amp;cutoff=&amp;base_demand_mw=&amp;confidence=</th><td>Risk-adjusted wind range, thermal top-up and indicative exposure.</td></tr>
            <tr><th>GET /api/decision/revisions?date=</th><td>Vintage matrix for one delivery day.</td></tr>
            <tr><th>GET /api/accuracy/summary|bias|horizon|hourly|daily|distribution|scatter|calibration|quantiles</th><td>Every accuracy view on the previous tab, as machine-readable JSON.</td></tr>
            <tr><th>POST /api/admin/refresh</th><td>Re-runs the Elexon ETL and hot-reloads the snapshot.</td></tr>
          </tbody>
        </table>
      </Panel>

      <Panel title="Known limitations / next steps">
        <ul>
          <li>The FUELHH-vs-WINDFOR definitional gap (transmission wind vs national wind) is currently handled
            statistically. The production fix is to reconcile to a consistent boundary using embedded-wind estimates —
            the design keeps this as a single swap in <code>analytics.py</code>.</li>
          <li>Only 31 delivery days exist in scope, so quantiles are estimated from ~1.5k points per lead band. With
            more history the same code produces tighter, season-aware bands.</li>
          <li>Demand and prices are placeholders; both are injected, never hard-coded into the metrics.</li>
          <li>Snapshot-based storage is right for a pilot; the loader is the only thing that changes when moving to a
            time-series store.</li>
        </ul>
      </Panel>
    </div>
  );
}
