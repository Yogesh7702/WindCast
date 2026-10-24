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
  Cell,
  Legend,
} from "recharts";
import api from "../api";
import useAsync from "../useAsync";
import { C, dayLabel, fmtGW, fmtMW, fmtPct, maeBadgeClass } from "../utils";
import { Badge, Callout, DataTable, ErrorState, Kpi, Loading, Panel, TooltipBox } from "../components/ui";

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

  if (summary.loading && !summary.data) return <Loading label="Scoring January 2026" />;
  if (summary.error) return <ErrorState error={summary.error} onRetry={summary.retry} />;

  const m = summary.data.metrics;
  const b = bias.data;

  return (
    <div className="page">
      <div className="kpi-row">
        <Kpi label="MAE (all Jan-2026 delivery periods)" value={fmtMW(m.mae_mw)} sub={`${fmtPct(m.nmae_pct_of_capacity)} of installed wind capacity`} tone="blue" />
        <Kpi label="RMSE" value={fmtMW(m.rmse_mw)} sub={`P90 abs error ${fmtMW(m.p90_abs_error_mw)}`} />
        <Kpi label="Mean bias" value={fmtMW(m.mbe_mw)} sub={`${m.bias_direction} · MAPE ${fmtPct(m.mape_pct)}`} tone="red" />
        <Kpi label="Correlation R²" value={m.r2?.toFixed(2)} sub={`${summary.data.delivery_days} delivery days scored`} tone="default" />
        <Kpi
          label="Value add vs naive forecast"
          value={`${Math.round((1 - (b?.debiased.mae_mw ?? m.mae_mw) / summary.data.benchmark_mean_forecast.mae_mw) * 100)}%`}
          sub={`vs ${fmtMW(summary.data.benchmark_mean_forecast.mae_mw)} MAE for “always predict the mean”`}
          tone="blue"
        />
        <Kpi
          label="Error correctable by de-biasing"
          value={b ? fmtPct(b.mae_improvement_pct, 0) : "–"}
          sub={b ? `${fmtMW(b.raw.mae_mw - b.debiased.mae_mw)} of MAE removed out-of-sample` : ""}
          tone="teal"
        />
      </div>

      <Callout tone="info" title="Why the raw forecast still earns its place">
        A flat “always use the monthly mean” forecast scores {fmtMW(summary.data.benchmark_mean_forecast.mae_mw)} MAE;
        WINDFOR scores {fmtMW(m.mae_mw)} raw and {b ? fmtMW(b.debiased.mae_mw) : "–"} once de-biased — roughly{" "}
        {Math.round((1 - (b?.debiased.mae_mw ?? m.mae_mw) / summary.data.benchmark_mean_forecast.mae_mw) * 100)}%
        better than the naive benchmark, and the win comes from intra-day shape, not from the average level.
      </Callout>

      {b && (
        <Callout tone="warn" title="Key finding — the forecast is systematically high">
          Over January 2026 the WINDFOR series runs <strong>{fmtGW(b.raw.mbe_mw)} above</strong> the FUELHH WIND
          outturn on average ({fmtGW(summary.data.mean_forecast_mw, 2)} forecast vs{" "}
          {fmtGW(summary.data.mean_actual_mw, 2)} actual). Part is definitional — FUELHH WIND is
          transmission-connected wind while WINDFOR is a national forecast that also reflects embedded wind — and
          part is model bias. Removing the bias <em>out-of-sample</em> ({b.debias_method}) cuts MAE from{" "}
          {fmtMW(b.raw.mae_mw)} to <strong>{fmtMW(b.debiased.mae_mw)}</strong>, a{" "}
          <strong>{fmtPct(b.mae_improvement_pct)}</strong> reduction, and lifts R² from {b.raw.r2} to{" "}
          {b.debiased.r2}. WindCast applies these empirical corrections before sizing the thermal top-up.
        </Callout>
      )}

      <div className="grid-2">
        <Panel
          title="How accuracy decays with lead time"
          subtitle="Every forward-looking forecast in January 2026, pooled and binned by hours between publication and delivery."
          right={
            <div className="seg">
              {[
                ["mae_mw", "MAE"],
                ["rmse_mw", "RMSE"],
                ["bias_mw", "Bias"],
              ].map(([k, l]) => (
                <button key={k} className={metric === k ? "on" : ""} onClick={() => setMetric(k)}>
                  {l}
                </button>
              ))}
            </div>
          }
        >
          {horizon.data && (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={horizon.data.rows} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" stroke={C.text} tick={{ fontSize: 11 }} />
                <YAxis
                  stroke={C.text}
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `${(v / 1000).toFixed(1)} GW`}
                  yAxisId="left"
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="#44506b"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => `${v / 1000}k`}
                />
                <Tooltip content={<TooltipBox />} />
                <Bar yAxisId="right" dataKey="count" name="Forecast points" fill="#26334d" radius={[2, 2, 0, 0]} />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey={metric}
                  name={metric === "bias_mw" ? "Bias" : metric === "mae_mw" ? "MAE" : "RMSE"}
                  stroke={C.forecast}
                  strokeWidth={2.6}
                  dot={{ r: 3 }}
                />
                <ReferenceLine yAxisId="left" y={0} stroke="#4a5a7a" />
              </ComposedChart>
            </ResponsiveContainer>
          )}
          <p className="footnote">
            Lead time only mildly erodes accuracy inside the day-ahead window — the dominant error source is bias,
            not horizon. That is why de-biasing is the highest-value correction for procurement.
          </p>
        </Panel>

        <Panel title="Error shape — how wide is the risk?" subtitle="Distribution of forecast − actual across January 2026.">
          {dist.data && (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={dist.data.rows} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="bin_center_mw"
                  stroke={C.text}
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}`}
                  label={{ value: "Forecast − actual (GW)", position: "insideBottom", offset: -2, fill: C.text, fontSize: 11 }}
                />
                <YAxis stroke={C.text} tick={{ fontSize: 11 }} />
                <Tooltip
                  content={<TooltipBox unit="points" labelFormatter={(v) => `${(v / 1000).toFixed(2)} GW`} />}
                />
                <ReferenceLine x={0} stroke="#4a5a7a" />
                <Bar dataKey="count" name="Forecast points">
                  {dist.data.rows.map((r) => (
                    <Cell key={r.bin_center_mw} fill={r.bin_center_mw > 0 ? C.low : C.actual} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          <p className="footnote">
            The mass sits clearly to the right of zero: the desk would have systematically over-assumed wind and
            therefore under-procured thermal cover.
          </p>
        </Panel>
      </div>

      <div className="grid-2">
        <Panel title="Forecast vs actual" subtitle="1,200 sampled points; the diagonal is a perfect forecast.">
          {scatter.data && (
            <ResponsiveContainer width="100%" height={320}>
              <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
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
                <ZAxis range={[18, 18]} />
                <Tooltip content={<TooltipBox />} />
                <Scatter data={scatter.data.rows} fill={C.forecast} fillOpacity={0.45} line={false} name="Forecast point" />
                <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 22000, y: 22000 }]} stroke="#4a5a7a" strokeDasharray="4 4" />
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title="Calibration" subtitle="Mean forecast vs mean actual by forecast decile — the gap is the bias to remove.">
          {calib.data && (
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={calib.data.rows} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="mean_forecast_mw"
                  stroke={C.text}
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)} GW`}
                />
                <YAxis stroke={C.text} tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)} GW`} />
                <Tooltip content={<TooltipBox />} />
                <Legend />
                <Line type="linear" dataKey="mean_forecast_mw" name="Mean forecast" stroke={C.forecast} strokeWidth={2.4} dot={{ r: 3 }} />
                <Line type="linear" dataKey="mean_actual_mw" name="Mean actual" stroke={C.actual} strokeWidth={2.4} dot={{ r: 3 }} />
                <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 22000, y: 22000 }]} stroke="#4a5a7a" strokeDasharray="4 4" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Panel>
      </div>

      <Panel title="Error by time of day" subtitle="Does the model struggle at particular hours? Bars = MAE, line = mean actual wind.">
        {hourly.data && (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={hourly.data.rows} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" stroke={C.text} tick={{ fontSize: 11 }} />
              <YAxis yAxisId="l" stroke={C.text} tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(1)} GW`} />
              <YAxis yAxisId="r" orientation="right" stroke="#44506b" tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}`} />
              <Tooltip content={<TooltipBox />} />
              <Bar yAxisId="l" dataKey="mae_mw" name="MAE" fill={C.low} radius={[3, 3, 0, 0]} />
              <Line yAxisId="r" type="monotone" dataKey="mean_actual_mw" name="Mean actual" stroke={C.actual} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Panel>

      <Panel
        title="Delivery-day scorecard"
        subtitle={`Each day scored with the forecast that was available at the ${cutoff}Z cut-off on D-1. Click a row to open it in the cockpit.`}
      >
        {daily.data && (
          <DataTable
            maxHeight={420}
            columns={[
              { key: "date", label: "Delivery day", render: (r) => dayLabel(r.date) },
              { key: "mae_mw", label: "MAE", align: "right", render: (r) => <span className={maeBadgeClass(r.mae_mw)}>{fmtMW(r.mae_mw)}</span> },
              { key: "rmse_mw", label: "RMSE", align: "right", render: (r) => fmtMW(r.rmse_mw) },
              { key: "bias_mw", label: "Bias", align: "right", render: (r) => `${r.bias_mw > 0 ? "+" : ""}${fmtMW(r.bias_mw)}` },
              { key: "mape_pct", label: "MAPE", align: "right", render: (r) => fmtPct(r.mape_pct) },
              { key: "mean_actual_mw", label: "Mean actual", align: "right", render: (r) => fmtGW(r.mean_actual_mw) },
              { key: "worst_abs_error_mw", label: "Worst period", align: "right", render: (r) => fmtMW(r.worst_abs_error_mw) },
            ]}
            rows={daily.data.rows.map((r) => ({
              ...r,
              key: r.date,
              __className: "clickable",
              __onClick: () => onPickDay(r.date),
            }))}
          />
        )}
      </Panel>
    </div>
  );
}
