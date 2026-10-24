import React, { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import api from "../api";
import useAsync from "../useAsync";
import { C, dayLabel, fmtMW, hhmm } from "../utils";
import { Callout, DataTable, ErrorState, Kpi, Loading, Panel } from "../components/ui";

const VINTAGE_RAMP = ["#cbd5e1", "#94a3b8", "#64748b", "#475569", "#334155", "#0f172a"];

const QUICK_DAYS = [
  { date: "2026-01-15", label: "15 Jan (Mid Month)" },
  { date: "2026-01-19", label: "19 Jan (Stable)" },
  { date: "2026-01-28", label: "28 Jan (Volatile)" },
];

export default function Revisions({ meta }) {
  const days = meta.delivery_dates;
  const [day, setDay] = useState(days.includes("2026-01-15") ? "2026-01-15" : days[0]);
  const { data, error, loading, retry } = useAsync((s) => api.revisions(day, s), [day]);

  const chart = useMemo(() => {
    if (!data) return [];
    return data.start_times.map((t, i) => {
      const row = { label: hhmm(t), actual: data.actual[i] };
      data.publish_times.forEach((p, j) => {
        row[`v${j}`] = data.matrix[j][i];
      });
      return row;
    });
  }, [data]);

  const stats = useMemo(() => {
    if (!data) return null;
    const leads = data.publish_times.map(
      (p) => (new Date(data.start_times[0]) - new Date(p)) / 36e5
    );
    const last = data.matrix[data.matrix.length - 1] || [];
    const first = data.matrix[0] || [];
    const mean = (a) => (a.length ? a.reduce((s, v) => s + (v || 0), 0) / a.length : 0);
    return {
      vintages: data.publish_times.length,
      earliest_lead: Math.round(Math.max(...leads)),
      first_mean: mean(first),
      last_mean: mean(last),
      actual_mean: mean(data.actual),
      swing: Math.max(...first.filter((v) => v != null)) - Math.min(...first.filter((v) => v != null)),
    };
  }, [data]);

  return (
    <div className="page-container">
      <div className="control-deck">
        <div className="control-group">
          <div className="control-label-row">
            <span className="control-label">Inspect Delivery Day Convergence</span>
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
      </div>

      {loading && !data ? (
        <Loading label="Reconstructing Forecast Convergence Timeline" />
      ) : error ? (
        <ErrorState error={error} onRetry={retry} />
      ) : (
        <>
          <div className="kpi-grid">
            <Kpi
              label="Earliest Vintage (D-2)"
              value={fmtMW(stats.first_mean)}
              sub="Initial published outlook"
              tone="default"
              badge="48h Ahead"
            />
            <Kpi
              label="Actionable Vintage (D-1 09:00)"
              value={fmtMW(stats.last_mean)}
              sub="Pre-auction decision number"
              tone="blue"
              badge="Gate Closure"
            />
            <Kpi
              label="Actual Outturn (FUELHH)"
              value={fmtMW(stats.actual_mean)}
              sub={`${dayLabel(day)} realized mean`}
              tone="emerald"
              badge="Settled Power"
            />
            <Kpi
              label="Level Over-Prediction"
              value={`+${fmtMW(stats.last_mean - stats.actual_mean)}`}
              sub="Residual bias at gate closure"
              tone="amber"
              badge="Systematic Gap"
            />
          </div>

          <Panel
            title={`Forecast Convergence Trajectory (${dayLabel(day)})`}
            subtitle="Evolution of published vintages across the 48h lead window. Darker curves denote older vintages; electric blue indicates latest pre-gate vintage; green represents actual outturn."
          >
            <ResponsiveContainer width="100%" height={360}>
              <LineChart data={chart} margin={{ top: 12, right: 16, bottom: 0, left: 4 }}>
                <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" interval={3} stroke={C.text} tick={{ fontSize: 11 }} />
                <YAxis stroke={C.text} tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(1)} GW`} />
                <Tooltip
                  contentStyle={{ background: "#0e1526", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "#94a3b8" }}
                  formatter={(v, n) => [fmtMW(v), n === "actual" ? "Actual Outturn (FUELHH)" : `Vintage ${n.slice(1)}`]}
                />
                {data.publish_times.map((p, j) => (
                  <Line
                    key={p}
                    type="monotone"
                    dataKey={`v${j}`}
                    name={`v${j}`}
                    stroke={VINTAGE_RAMP[Math.round((j / Math.max(data.publish_times.length - 1, 1)) * (VINTAGE_RAMP.length - 1))]}
                    strokeWidth={1.4}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                ))}
                <Line type="monotone" dataKey="actual" name="actual" stroke="#10b981" strokeWidth={3} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title="Historical Vintage Audit Log" subtitle="Timestamp, lead hours to first settlement period, and summary generation stats.">
            <DataTable
              maxHeight={320}
              columns={[
                { key: "publish", label: "Published Timestamp (UTC)" },
                { key: "lead", label: "Lead to SP1", align: "right" },
                { key: "mean", label: "Day Mean MW", align: "right" },
                { key: "min", label: "Min Period MW", align: "right" },
                { key: "max", label: "Peak Period MW", align: "right" },
              ]}
              rows={data.publish_times.map((p, j) => {
                const row = data.matrix[j].filter((v) => v != null);
                return {
                  key: p,
                  publish: p.slice(0, 16).replace("T", " ") + "Z",
                  lead: `${Math.round((new Date(data.start_times[0]) - new Date(p)) / 36e5)} h`,
                  mean: fmtMW(row.reduce((s, v) => s + v, 0) / row.length),
                  min: fmtMW(Math.min(...row)),
                  max: fmtMW(Math.max(...row)),
                };
              })}
            />
          </Panel>
        </>
      )}
    </div>
  );
}
