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
  Legend,
} from "recharts";
import api from "../api";
import useAsync from "../useAsync";
import { C, fmtGbp, fmtGwh, fmtGW, fmtMW, fmtPct, hhmm, dayLabel } from "../utils";
import { Badge, Callout, DataTable, ErrorState, Kpi, Loading, Panel, TooltipBox } from "../components/ui";

const CUTOFFS = ["02:30", "04:30", "07:30", "09:00", "11:30", "15:30", "18:30", "22:30"];

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
    <div className="page">
      <div className="controls">
        <label>
          <span>Delivery day</span>
          <select value={day} onChange={(e) => setDay(e.target.value)}>
            {days.map((d) => (
              <option key={d} value={d}>
                {dayLabel(d)} · {d}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Decision cut-off (UTC)</span>
          <select value={cutoff} onChange={(e) => setCutoff(e.target.value)}>
            {CUTOFFS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Base demand</span>
          <input
            type="range"
            min={25000}
            max={55000}
            step={500}
            value={baseDemand}
            onChange={(e) => setBaseDemand(Number(e.target.value))}
          />
          <b>{fmtGW(baseDemand, 1)} avg</b>
        </label>
        <label>
          <span>Risk confidence</span>
          <select value={confidence} onChange={(e) => setConfidence(Number(e.target.value))}>
            <option value={0.8}>80% (P05 wind)</option>
            <option value={0.9}>90% (P10 wind)</option>
            <option value={0.95}>95% (P05 wind)</option>
          </select>
        </label>
      </div>

      {(forecast.loading && !forecast.data) || (rec.loading && !rec.data) ? (
        <Loading label="Building the day-ahead picture" />
      ) : forecast.error || rec.error ? (
        <ErrorState error={forecast.error || rec.error} onRetry={() => { forecast.retry(); rec.retry(); }} />
      ) : (
        <>
          <div className="kpi-row">
            <Kpi
              label="Wind forecast · delivery day"
              value={fmtGwh(t.wind_expected_mwh)}
              sub={`avg ${fmtGW(t.wind_expected_mwh / 24)} · ${dayLabel(day)}`}
              tone="blue"
            />
            <Kpi
              label={`Risk-adjusted wind (P${Math.round((1 - confidence) * 100)})`}
              value={fmtGwh(t.wind_low_mwh)}
              sub={`${fmtGwh(t.wind_expected_mwh - t.wind_low_mwh)} downside cover`}
              tone="amber"
            />
            <Kpi
              label="Thermal / DA purchase required"
              value={fmtGwh(t.thermal_expected_mwh)}
              sub={`peak ${fmtMW(t.peak_thermal_expected_mw)}`}
              tone="default"
            />
            <Kpi
              label="Risk buffer to secure"
              value={fmtGwh(t.buffer_mwh)}
              sub={`peak ${fmtMW(t.peak_thermal_secure_mw)} · cost ${fmtGbp(ex.buffer_cost_gbp)}`}
              tone="red"
            />
            <Kpi
              label="Forecast error · this day"
              value={fmtMW(m.mae_mw)}
              sub={`MAE · bias ${fmtMW(m.mbe_mw)} · ${fmtPct(m.mape_pct)} MAPE`}
              tone="default"
            />
          </div>

          <div className="meta-strip">
            <span>
              <strong>Forecast vintage in use:</strong> published{" "}
              {new Date(forecast.data.vintage_used).toISOString().slice(0, 16).replace("T", " ")}Z
            </span>
            <span>
              <strong>Lead time:</strong> {forecast.data.lead_hours.min}–{forecast.data.lead_hours.max} h before
              delivery
            </span>
            <span>
              <strong>Cut-off:</strong> {forecast.data.cutoff_utc.slice(0, 16).replace("T", " ")}Z
            </span>
            <Badge tone="info">Latest vintage before cut-off automatically selected</Badge>
          </div>

          <Panel
            title="Wind generation vs the forecast the desk would have seen"
            subtitle="Blue band = P10–P90 empirical error range at the actual lead time of each settlement period. Teal = realised outturn."
            right={<Legend />}
          >
            <ResponsiveContainer width="100%" height={340}>
              <ComposedChart data={series} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="bandFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.band} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={C.band} stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" interval={3} stroke={C.text} tick={{ fontSize: 11 }} />
                <YAxis
                  stroke={C.text}
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)} GW`}
                  domain={[0, "dataMax + 1500"]}
                />
                <Tooltip content={<TooltipBox />} />
                <Area
                  dataKey="band"
                  name="P10–P90 wind range"
                  stroke="none"
                  fill="url(#bandFill)"
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="forecast_mw"
                  name="Forecast (point)"
                  stroke={C.forecast}
                  strokeWidth={2.4}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="actual_mw"
                  name="Actual outturn"
                  stroke={C.actual}
                  strokeWidth={2.4}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </Panel>

          <div className="grid-2">
            <Panel
              title="Procurement plan by settlement period"
              subtitle="Demand (illustrative shape) split into wind output and the thermal/DA top-up that must be secured."
            >
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={series} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" interval={5} stroke={C.text} tick={{ fontSize: 11 }} />
                  <YAxis
                    stroke={C.text}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)} GW`}
                  />
                  <Tooltip content={<TooltipBox />} />
                  <Area
                    dataKey="thermal_expected_mw"
                    name="Thermal top-up (expected wind)"
                    stackId="p"
                    stroke={C.thermal}
                    fill={C.thermal}
                    fillOpacity={0.35}
                  />
                  <Area
                    dataKey="wind_low_mw"
                    name="Wind (risk-adjusted)"
                    stackId="p"
                    stroke={C.forecast}
                    fill={C.forecast}
                    fillOpacity={0.35}
                  />
                  <Line
                    dataKey="demand_mw"
                    name="Demand"
                    stroke="#dbe4f5"
                    strokeDasharray="5 4"
                    strokeWidth={1.6}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </Panel>

            <Panel
              title="Error profile of this day"
              subtitle="Forecast minus actual per settlement period. Positive = the forecast was too high, so thermal cover is under-bought."
            >
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={series} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" interval={5} stroke={C.text} tick={{ fontSize: 11 }} />
                  <YAxis
                    stroke={C.text}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => `${(v / 1000).toFixed(1)} GW`}
                  />
                  <Tooltip content={<TooltipBox />} />
                  <ReferenceLine y={0} stroke="#4a5a7a" />
                  <Bar dataKey="error_mw" name="Forecast − actual" fill={C.low} radius={[2, 2, 0, 0]} />
                </ComposedChart>
              </ResponsiveContainer>
            </Panel>
          </div>

          <div className="grid-2">
            <Panel title="What this means commercially" subtitle="Indicative exposure at the current assumptions.">
              <ul className="insight-list">
                <li>
                  Secure <strong>{fmtGwh(t.thermal_secure_mwh)}</strong> of thermal / day-ahead energy (vs{" "}
                  {fmtGwh(t.thermal_expected_mwh)} on the point forecast) to keep wind shortfall risk at or below{" "}
                  {fmtPct((1 - confidence) * 100, 0)}.
                </li>
                <li>
                  The buffer of <strong>{fmtGwh(t.buffer_mwh)}</strong> costs about{" "}
                  <strong>{fmtGbp(ex.buffer_cost_gbp)}</strong> at £{ex.da_price_gbp_mwh}/MWh; the same volume
                  bought in balancing would cost about {fmtGbp(ex.avoided_shortfall_gbp)}.
                </li>
                <li>
                  Largest single-period exposure: <strong>{fmtMW(t.peak_thermal_secure_mw - t.peak_thermal_expected_mw)}</strong>{" "}
                  of additional cover at the tightest period.
                </li>
                <li className="muted">{rec.data.assumptions.demand}</li>
              </ul>
            </Panel>

            <Panel
              title="Settlement period detail"
              subtitle="48 periods, UTC. Exportable values match the API payload 1:1."
            >
              <DataTable
                maxHeight={300}
                columns={[
                  { key: "settlementPeriod", label: "SP", align: "right" },
                  { key: "label", label: "Time", align: "right" },
                  { key: "forecast_mw", label: "Forecast MW", align: "right", render: (r) => fmtMW(r.forecast_mw) },
                  { key: "wind_low_mw", label: "P10 wind", align: "right", render: (r) => fmtMW(r.wind_low_mw) },
                  { key: "thermal_secure_mw", label: "Thermal req.", align: "right", render: (r) => fmtMW(r.thermal_secure_mw) },
                  { key: "actual_mw", label: "Actual", align: "right", render: (r) => fmtMW(r.actual_mw) },
                  {
                    key: "error_mw",
                    label: "Error",
                    align: "right",
                    render: (r) => (
                      <span className={r.error_mw > 0 ? "neg" : "pos"}>
                        {r.error_mw > 0 ? "+" : ""}
                        {fmtMW(r.error_mw)}
                      </span>
                    ),
                  },
                ]}
                rows={series}
              />
            </Panel>
          </div>

          <Callout tone="info" title="How the number is produced">
            Latest WINDFOR vintage published before {cutoff}Z on the day before delivery → hourly values mapped
            onto the 48 settlement periods → empirical P10–P90 error quantiles for that exact lead time subtracted
            from the point forecast → wind range → demand minus wind = thermal requirement. All quantiles come from
            January 2026 data only and are recalculated on refresh.
          </Callout>
        </>
      )}
    </div>
  );
}
