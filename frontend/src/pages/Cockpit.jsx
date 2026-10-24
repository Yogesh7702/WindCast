import React, { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Bar,
} from "recharts";
import api from "../api";
import useAsync from "../useAsync";
import { C, fmtGbp, fmtGwh, fmtGW, fmtMW, fmtPct, hhmm, dayLabel } from "../utils";
import { Badge, Callout, DataTable, ErrorState, Kpi, Loading, Panel, TooltipBox, SegmentedControl } from "../components/ui";

const CUTOFF_OPTIONS = [
  { value: "02:30", label: "02:30 UTC" },
  { value: "04:30", label: "04:30 UTC" },
  { value: "07:30", label: "07:30 UTC" },
  { value: "09:00", label: "09:00 UTC (Auction Gate)" },
  { value: "11:30", label: "11:30 UTC" },
  { value: "15:30", label: "15:30 UTC" },
  { value: "18:30", label: "18:30 UTC" },
  { value: "22:30", label: "22:30 UTC" },
];

const CONFIDENCE_OPTIONS = [
  { value: 0.8, label: "80% Confidence (P20)" },
  { value: 0.9, label: "90% Confidence (P10 Default)" },
  { value: 0.95, label: "95% Confidence (P05 Safe)" },
];

const QUICK_DAYS = [
  { date: "2026-01-15", label: "15 Jan (Mid)" },
  { date: "2026-01-19", label: "19 Jan (Lowest Error)" },
  { date: "2026-01-28", label: "28 Jan (High Volatility)" },
];

export default function Cockpit({ meta, cutoff, setCutoff, initialDay }) {
  const days = meta.delivery_dates;
  const [day, setDay] = useState(
    initialDay && days.includes(initialDay) ? initialDay : days.includes("2026-01-15") ? "2026-01-15" : days[0]
  );
  const [baseDemand, setBaseDemand] = useState(meta.default_base_demand_mw);
  const [confidence, setConfidence] = useState(meta.default_confidence);

  const forecast = useAsync((signal) => api.decisionForecast(day, cutoff, signal), [day, cutoff]);
  const rec = useAsync(
    (signal) => api.recommendation(day, cutoff, baseDemand, confidence, signal),
    [day, cutoff, baseDemand, confidence]
  );

  const series = useMemo(() => {
    if (!rec.data?.available) return [];
    const fmap = new Map((forecast.data?.series || []).map((r) => [r.startTime, r]));
    return rec.data.series.map((r) => ({
      ...r,
      ...fmap.get(r.startTime),
      label: hhmm(r.startTime),
      band: [r.wind_low_mw, r.wind_high_mw],
    }));
  }, [rec.data, forecast.data]);

  const m = forecast.data?.metrics;
  const t = rec.data?.totals;
  const ex = rec.data?.exposure;

  return (
    <div className="page-container">
      <div className="control-deck">
        <div className="control-grid">
          <div className="control-group">
            <div className="control-label-row">
              <span className="control-label">Target Delivery Day</span>
              <div className="preset-pills">
                {QUICK_DAYS.map((qd) => (
                  <button
                    key={qd.date}
                    type="button"
                    className={`pill-btn ${day === qd.date ? "active" : ""}`}
                    onClick={() => setDay(qd.date)}
                  >
                    {qd.label}
                  </button>
                ))}
              </div>
            </div>
            <select className="custom-select" value={day} onChange={(e) => setDay(e.target.value)}>
              {days.map((d) => (
                <option key={d} value={d}>
                  {dayLabel(d)} ({d})
                </option>
              ))}
            </select>
          </div>

          <div className="control-group">
            <span className="control-label">Decision Cut-off (D-1 Vintage Selection)</span>
            <SegmentedControl
              options={CUTOFF_OPTIONS}
              value={cutoff}
              onChange={setCutoff}
              size="sm"
            />
          </div>

          <div className="control-group">
            <span className="control-label">Risk Appetite / Downside Quantile</span>
            <SegmentedControl
              options={CONFIDENCE_OPTIONS}
              value={confidence}
              onChange={setConfidence}
              size="sm"
            />
          </div>

          <div className="control-group">
            <div className="control-label-row">
              <span className="control-label">Base Demand Calibration</span>
              <span className="control-val-badge">{fmtGW(baseDemand, 1)} avg</span>
            </div>
            <div className="slider-wrapper">
              <input
                type="range"
                className="custom-range"
                min={25000}
                max={55000}
                step={500}
                value={baseDemand}
                onChange={(e) => setBaseDemand(Number(e.target.value))}
              />
              <div className="slider-ticks">
                <span onClick={() => setBaseDemand(30000)}>30 GW (Low)</span>
                <span onClick={() => setBaseDemand(38000)}>38 GW (Typical)</span>
                <span onClick={() => setBaseDemand(48000)}>48 GW (Peak)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {(forecast.loading && !forecast.data) || (rec.loading && !rec.data) ? (
        <Loading label="Computing Risk-Adjusted Sizing Profile" />
      ) : forecast.error || rec.error ? (
        <ErrorState error={forecast.error || rec.error} onRetry={() => { forecast.retry(); rec.retry(); }} />
      ) : (
        <>
          <div className="kpi-grid">
            <Kpi
              label="Wind Point Forecast"
              value={fmtGwh(t.wind_expected_mwh)}
              sub={`Daily avg ${fmtGW(t.wind_expected_mwh / 24)}`}
              tone="blue"
              badge="Point Forecast"
            />
            <Kpi
              label={`Conservative Wind (P${Math.round((1 - confidence) * 100)})`}
              value={fmtGwh(t.wind_low_mwh)}
              sub={`${fmtGwh(t.wind_expected_mwh - t.wind_low_mwh)} downside cushion`}
              tone="amber"
              badge={`${confidence * 100}% Protected`}
            />
            <Kpi
              label="Base Thermal / DA Required"
              value={fmtGwh(t.thermal_expected_mwh)}
              sub={`Peak ${fmtMW(t.peak_thermal_expected_mw)} needed`}
              tone="default"
              badge="Unadjusted"
            />
            <Kpi
              label="Secured Procurement Target"
              value={fmtGwh(t.thermal_secure_mwh)}
              sub={`Includes +${fmtGwh(t.buffer_mwh)} risk buffer`}
              tone="emerald"
              badge="Actionable Target"
            />
            <Kpi
              label="Imbalance Cost Avoidance"
              value={fmtGbp(ex.avoided_shortfall_gbp - ex.buffer_cost_gbp)}
              sub={`Buffer cost ${fmtGbp(ex.buffer_cost_gbp)}`}
              tone="indigo"
              badge="Net Value"
            />
          </div>

          <div className="status-banner">
            <div className="status-item">
              <span className="status-label">Active Forecast Vintage:</span>
              <span className="status-val">{forecast.data.vintage_used} UTC</span>
            </div>
            <div className="status-item">
              <span className="status-label">Forecast Lead Window:</span>
              <span className="status-val">{forecast.data.lead_hours.min}h → {forecast.data.lead_hours.max}h</span>
            </div>
            <div className="status-item">
              <span className="status-label">Realized Day Error:</span>
              <span className="status-val">MAE {fmtMW(m.mae_mw)} ({fmtPct(m.mape_pct)} MAPE)</span>
            </div>
          </div>

          <div className="charts-split">
            <Panel
              title="Wind Generation Profile & Uncertainty Corridor"
              subtitle="Latest pre-cutoff forecast vintage vs empirical uncertainty band (P10–P90) and actual outturn."
              right={
                <div className="chart-legend-custom">
                  <span className="legend-chip"><span className="chip-color chip-blue" /> WINDFOR Forecast</span>
                  <span className="legend-chip"><span className="chip-color chip-band" /> P10–P90 Band</span>
                  <span className="legend-chip"><span className="chip-color chip-teal" /> Realized Actual</span>
                </div>
              }
            >
              <ResponsiveContainer width="100%" height={340}>
                <ComposedChart data={series} margin={{ top: 12, right: 16, bottom: 0, left: 4 }}>
                  <defs>
                    <linearGradient id="bandGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#64748b" stopOpacity={0.15} />
                      <stop offset="100%" stopColor="#64748b" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" interval={5} stroke={C.text} tick={{ fontSize: 11 }} />
                  <YAxis stroke={C.text} tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)} GW`} />
                  <Tooltip content={<TooltipBox unit="MW" />} />
                  <Area dataKey="wind_high_mw" name="P90 Ceiling" stroke="transparent" fill="transparent" />
                  <Area
                    dataKey="wind_low_mw"
                    name="Uncertainty Range"
                    stroke="#94a3b8"
                    strokeDasharray="3 3"
                    fill="url(#bandGrad)"
                  />
                  <Line
                    type="monotone"
                    dataKey="forecast_mw"
                    name="WINDFOR Forecast"
                    stroke="#0f172a"
                    strokeWidth={2.4}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="actual_mw"
                    name="Actual Outturn (FUELHH)"
                    stroke="#059669"
                    strokeWidth={2.4}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </Panel>

            <Panel
              title="Thermal Top-Up & Consumer Demand Coverage"
              subtitle="Required thermal dispatch to cover national demand after accounting for conservative wind generation."
            >
              <ResponsiveContainer width="100%" height={340}>
                <ComposedChart data={series} margin={{ top: 12, right: 16, bottom: 0, left: 4 }}>
                  <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" interval={5} stroke={C.text} tick={{ fontSize: 11 }} />
                  <YAxis stroke={C.text} tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)} GW`} />
                  <Tooltip content={<TooltipBox unit="MW" />} />
                  <Bar
                    dataKey="thermal_secure_mw"
                    name="Thermal Required"
                    stackId="p"
                    fill="#dc2626"
                    fillOpacity={0.85}
                    radius={[2, 2, 0, 0]}
                  />
                  <Bar
                    dataKey="wind_low_mw"
                    name="Wind (P10 Bound)"
                    stackId="p"
                    fill="#0f172a"
                    fillOpacity={0.75}
                    radius={[2, 2, 0, 0]}
                  />
                  <Line
                    dataKey="demand_mw"
                    name="Target Demand"
                    stroke="#475569"
                    strokeDasharray="4 4"
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </Panel>
          </div>

          <div className="grid-2">
            <Panel
              title="Settlement Period Breakdown"
              subtitle="Half-hourly data matching Elexon settlement periods (UTC)."
            >
              <DataTable
                maxHeight={320}
                columns={[
                  { key: "settlementPeriod", label: "SP", align: "right" },
                  { key: "label", label: "Time", align: "right" },
                  { key: "forecast_mw", label: "Forecast", align: "right", render: (r) => fmtMW(r.forecast_mw) },
                  { key: "wind_low_mw", label: "P10 Wind", align: "right", render: (r) => fmtMW(r.wind_low_mw) },
                  { key: "thermal_secure_mw", label: "Procure Target", align: "right", render: (r) => fmtMW(r.thermal_secure_mw) },
                  { key: "actual_mw", label: "Actual", align: "right", render: (r) => fmtMW(r.actual_mw) },
                  {
                    key: "error_mw",
                    label: "Delta",
                    align: "right",
                    render: (r) => (
                      <span className={r.error_mw > 0 ? "text-amber" : "text-emerald"}>
                        {r.error_mw > 0 ? "+" : ""}
                        {fmtMW(r.error_mw)}
                      </span>
                    ),
                  },
                ]}
                rows={series}
              />
            </Panel>

            <Panel title="Commercial Analysis & Trade Strategy" subtitle="Economic translation of forecast uncertainty.">
              <div className="commercial-card">
                <div className="commercial-headline">
                  To achieve <strong>{confidence * 100}% delivery assurance</strong>, procure{" "}
                  <strong className="text-emerald">{fmtGwh(t.thermal_secure_mwh)}</strong> of thermal energy ahead of gate closure.
                </div>
                <div className="commercial-body">
                  <div className="commercial-metric">
                    <span className="metric-tag">Point Forecast Implication:</span>
                    <span className="metric-num">{fmtGwh(t.thermal_expected_mwh)}</span>
                  </div>
                  <div className="commercial-metric">
                    <span className="metric-tag">Recommended Downside Buffer:</span>
                    <span className="metric-num">+{fmtGwh(t.buffer_mwh)}</span>
                  </div>
                  <div className="commercial-metric">
                    <span className="metric-tag">Day-Ahead Buffer Cost:</span>
                    <span className="metric-num">{fmtGbp(ex.buffer_cost_gbp)} (@ £{ex.da_price_gbp_mwh}/MWh)</span>
                  </div>
                  <div className="commercial-metric">
                    <span className="metric-tag">Balancing Penalty Exposure:</span>
                    <span className="metric-num text-rose">{fmtGbp(ex.avoided_shortfall_gbp)} (@ £{ex.balancing_price_gbp_mwh}/MWh)</span>
                  </div>
                </div>
                <div className="commercial-footer">
                  Net Expected Savings vs Emergency Balancing Purchase:{" "}
                  <strong>{fmtGbp(ex.avoided_shortfall_gbp - ex.buffer_cost_gbp)}</strong>
                </div>
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
