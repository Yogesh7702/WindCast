import React, { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
  ReferenceLine,
  Legend,
} from "recharts";
import api from "../api";
import useAsync from "../useAsync";
import { C, dayLabel, fmtGW, fmtMW, fmtPct, maeBadgeClass } from "../utils";
import { Badge, Callout, DataTable, ErrorState, Kpi, Loading, Panel, TooltipBox, SegmentedControl } from "../components/ui";

const METRIC_OPTIONS = [
  { value: "mae_mw", label: "MAE (Mean Absolute)" },
  { value: "rmse_mw", label: "RMSE (Penalty Squared)" },
  { value: "bias_mw", label: "Mean Signed Bias" },
];

export default function Accuracy({ cutoff, onPickDay }) {
  const summary = useAsync((s) => api.accuracySummary(cutoff, s), [cutoff]);
  const bias = useAsync((s) => api.accuracyBias(cutoff, s), [cutoff]);
  const horizon = useAsync((s) => api.horizon(s), []);
  const hourly = useAsync((s) => api.hourly(s), []);
  const daily = useAsync((s) => api.daily(cutoff, s), [cutoff]);
  const dist = useAsync((s) => api.distribution(s), []);
  const scatter = useAsync((s) => api.scatter(s), []);
  const calib = useAsync((s) => api.calibration(s), []);
  const [metric, setMetric] = useState("mae_mw");

  if (summary.loading && !summary.data) return <Loading label="Evaluating Model Accuracy Over January 2026" />;
  if (summary.error) return <ErrorState error={summary.error} onRetry={summary.retry} />;

  const m = summary.data.metrics;
  const b = bias.data;

  return (
    <div className="page-container">
      <div className="kpi-grid">
        <Kpi
          label="Headline MAE"
          value={fmtMW(m.mae_mw)}
          sub={`${fmtPct(m.nmae_pct_of_capacity)} of GB wind capacity`}
          tone="blue"
          badge="1,488 Half-Hours"
        />
        <Kpi
          label="RMSE Dispersion"
          value={fmtMW(m.rmse_mw)}
          sub={`P90 abs error ${fmtMW(m.p90_abs_error_mw)}`}
          tone="default"
          badge="High-Variance Risk"
        />
        <Kpi
          label="Systematic Bias"
          value={`+${fmtMW(m.mbe_mw)}`}
          sub="Persistent over-prediction"
          tone="amber"
          badge="Upward Bias"
        />
        <Kpi
          label="Forecast Correlation (R²)"
          value={m.r2?.toFixed(2)}
          sub={`${summary.data.delivery_days} trading days scored`}
          tone="default"
          badge="Directional Signal"
        />
        <Kpi
          label="De-Biasing Error Reduction"
          value={b ? fmtPct(b.mae_improvement_pct, 0) : "–"}
          sub={b ? `MAE drops to ${fmtMW(b.debiased.mae_mw)}` : ""}
          tone="emerald"
          badge="Actionable Gain"
        />
      </div>

      <div className="callout-grid">
        <Callout tone="info" title="Baseline Performance Comparison">
          A flat baseline model ("always predict monthly mean") records an MAE of{" "}
          <strong>{fmtMW(summary.data.benchmark_mean_forecast.mae_mw)}</strong>. WINDFOR scores{" "}
          <strong>{fmtMW(m.mae_mw)}</strong> raw and <strong>{b ? fmtMW(b.debiased.mae_mw) : "–"}</strong> once de-biased — a{" "}
          <strong>{Math.round((1 - (b?.debiased.mae_mw ?? m.mae_mw) / summary.data.benchmark_mean_forecast.mae_mw) * 100)}% outperformance</strong> over naive persistence driven by intra-day shape tracking.
        </Callout>

        {b && (
          <Callout tone="warn" title="Structural Bias Quantification">
            Across January 2026, raw WINDFOR averages <strong>{fmtGW(b.raw.mbe_mw)} above</strong> FUELHH actuals ({fmtGW(summary.data.mean_forecast_mw, 2)} forecast vs {fmtGW(summary.data.mean_actual_mw, 2)} actual). This stems partly from a boundary discrepancy (transmission wind vs embedded generation) and weather model drift. Applying out-of-sample de-biasing cuts error by <strong>{fmtPct(b.mae_improvement_pct)}</strong> and raises R² to <strong>{b.debiased.r2}</strong>.
          </Callout>
        )}
      </div>

      <div className="charts-split">
        <Panel
          title="Accuracy Decay vs Forecast Lead Time"
          subtitle="MAE/RMSE by hours elapsed between forecast publication and delivery. Horizon stability confirms level bias dominates over forecast age."
          right={
            <SegmentedControl
              options={METRIC_OPTIONS}
              value={metric}
              onChange={setMetric}
              size="sm"
            />
          }
        >
          {horizon.data && (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={horizon.data.rows} margin={{ top: 12, right: 16, bottom: 0, left: 4 }}>
                <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" stroke={C.text} tick={{ fontSize: 11 }} />
                <YAxis stroke={C.text} tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(1)} GW`} />
                <Tooltip content={<TooltipBox unit="MW" />} />
                <Bar dataKey={metric} fill="#0f172a" radius={[3, 3, 0, 0]} name={metric.toUpperCase()} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel
          title="Error Distribution & Frequency"
          subtitle="Histogram of forecast minus actual generation (500 MW bins). Rightward shift visualizes positive bias."
        >
          {dist.data && (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={dist.data.rows} margin={{ top: 12, right: 16, bottom: 0, left: 4 }}>
                <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="bin_center_mw" stroke={C.text} tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)} GW`} />
                <YAxis stroke={C.text} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                <Tooltip content={<TooltipBox unit="%" />} />
                <ReferenceLine x={0} stroke="#94a3b8" strokeDasharray="3 3" />
                <Bar dataKey="share_pct" fill="#475569" radius={[3, 3, 0, 0]} name="Share of Settlement Periods" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>
      </div>

      <div className="charts-split">
        <Panel
          title="Forecast vs Actual Scatter (Correlation)"
          subtitle="Sampled settlement periods with 1:1 parity line. Clustering above the diagonal illustrates systematic over-prediction."
        >
          {scatter.data && (
            <ResponsiveContainer width="100%" height={320}>
              <ScatterChart margin={{ top: 12, right: 16, bottom: 0, left: 4 }}>
                <CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="forecast_mw"
                  name="Forecast"
                  stroke={C.text}
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)} GW`}
                  domain={[0, 22000]}
                />
                <YAxis
                  type="number"
                  dataKey="actual_mw"
                  name="Actual"
                  stroke={C.text}
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)} GW`}
                  domain={[0, 22000]}
                />
                <ZAxis range={[20, 20]} />
                <Tooltip content={<TooltipBox unit="MW" />} />
                <Scatter data={scatter.data.rows} fill="#0f172a" fillOpacity={0.4} name="Settlement Period" />
                <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 22000, y: 22000 }]} stroke="#94a3b8" strokeDasharray="4 4" />
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel
          title="Model Calibration Curve"
          subtitle="Forecast deciles compared against mean actual outturn. Distance from diagonal reflects correctable error."
        >
          {calib.data && (
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={calib.data.rows} margin={{ top: 12, right: 16, bottom: 0, left: 4 }}>
                <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="mean_forecast_mw" stroke={C.text} tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)} GW`} />
                <YAxis stroke={C.text} tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)} GW`} />
                <Tooltip content={<TooltipBox unit="MW" />} />
                <Line type="linear" dataKey="mean_forecast_mw" name="Mean Forecast" stroke="#0f172a" strokeWidth={2.4} dot={{ r: 3 }} />
                <Line type="linear" dataKey="mean_actual_mw" name="Mean Actual" stroke="#059669" strokeWidth={2.4} dot={{ r: 3 }} />
                <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 22000, y: 22000 }]} stroke="#94a3b8" strokeDasharray="4 4" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Panel>
      </div>

      <Panel
        title="Delivery-Day Scorecard (All January 2026)"
        subtitle={`Evaluated with forecasts actionable at the ${cutoff} UTC cutoff on D-1. Click any row to load that day directly in the Decision Cockpit.`}
      >
        {daily.data && (
          <DataTable
            maxHeight={420}
            columns={[
              { key: "date", label: "Delivery Date", render: (r) => <strong>{dayLabel(r.date)} ({r.date})</strong> },
              { key: "mae_mw", label: "MAE", align: "right", render: (r) => <span className={`badge ${maeBadgeClass(r.mae_mw)}`}>{fmtMW(r.mae_mw)}</span> },
              { key: "rmse_mw", label: "RMSE", align: "right", render: (r) => fmtMW(r.rmse_mw) },
              { key: "bias_mw", label: "Signed Bias", align: "right", render: (r) => `${r.bias_mw > 0 ? "+" : ""}${fmtMW(r.bias_mw)}` },
              { key: "mape_pct", label: "MAPE %", align: "right", render: (r) => fmtPct(r.mape_pct) },
              { key: "mean_actual_mw", label: "Mean Actual", align: "right", render: (r) => fmtGW(r.mean_actual_mw) },
              { key: "worst_abs_error_mw", label: "Peak Error", align: "right", render: (r) => fmtMW(r.worst_abs_error_mw) },
            ]}
            rows={daily.data.rows.map((r) => ({
              ...r,
              key: r.date,
              __className: "clickable-row",
              __onClick: () => onPickDay(r.date),
            }))}
          />
        )}
      </Panel>
    </div>
  );
}
