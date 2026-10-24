import React, { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
  ReferenceLine,
} from "recharts";
import api from "../api";
import useAsync from "../useAsync";
import { C, dayLabel, fmtMW, hhmm } from "../utils";
import { Callout, DataTable, ErrorState, Kpi, Loading, Panel } from "../components/ui";

const VINTAGE_RAMP = ["#28324a", "#3a4c72", "#4d6ba0", "#6191d6", "#7fb6ff", "#a9d1ff"];

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
        {stats && (
          <div className="controls-note">
            {stats.vintages} vintages · earliest lead {stats.earliest_lead} h · day-1 swing {fmtMW(stats.swing)}
          </div>
        )}
      </div>

      {loading && !data ? (
        <Loading label="Loading forecast vintages" />
      ) : error ? (
        <ErrorState error={error} onRetry={retry} />
      ) : (
        <>
          <div className="kpi-row">
            <Kpi label="Earlier vintages (2 days out)" value={fmtMW(stats.first_mean)} sub="mean across all 48 periods" />
            <Kpi label="Latest vintage (D-1)" value={fmtMW(stats.last_mean)} sub="the number actually used for procurement" tone="blue" />
            <Kpi label="Realised outturn" value={fmtMW(stats.actual_mean)} sub={`${dayLabel(day)} actual mean`} tone="teal" />
            <Kpi
              label="Residual over-forecast at D-1"
              value={fmtMW(stats.last_mean - stats.actual_mean)}
              sub="what the desk would have needed to correct for"
              tone="red"
            />
          </div>

          <Panel
            title={`Forecast revisions towards ${dayLabel(day)}`}
            subtitle="Each thin line is one published vintage; the bold line is the realised outturn. Forecasts converge, but often converge onto the wrong level."
          >
            <ResponsiveContainer width="100%" height={360}>
              <LineChart data={chart} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" interval={3} stroke={C.text} tick={{ fontSize: 11 }} />
                <YAxis stroke={C.text} tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(1)} GW`} />
                <Tooltip
                  contentStyle={{ background: "#0f1729", border: "1px solid #24304a", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "#93a4c4" }}
                  formatter={(v, n) => [fmtMW(v), n === "actual" ? "Actual outturn" : `Vintage ${n.slice(1)}`]}
                />
                {data.publish_times.map((p, j) => (
                  <Line
                    key={p}
                    type="monotone"
                    dataKey={`v${j}`}
                    name={`v${j}`}
                    stroke={VINTAGE_RAMP[Math.round((j / Math.max(data.publish_times.length - 1, 1)) * (VINTAGE_RAMP.length - 1))]}
                    strokeWidth={1.3}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                ))}
                <Line type="monotone" dataKey="actual" name="actual" stroke={C.actual} strokeWidth={3} dot={false} />
              </LineChart>
            </ResponsiveContainer>
            <p className="footnote">
              Vintage order runs dark → light. Because the day-ahead auction closes around 09:15 UK time, only the
              vintages up to that cut-off are actionable.
            </p>
          </Panel>

          <Panel title="Vintage log" subtitle="Publish time, lead time to the first settlement period and the day mean.">
            <DataTable
              maxHeight={320}
              columns={[
                { key: "publish", label: "Published (UTC)" },
                { key: "lead", label: "Lead to SP1", align: "right" },
                { key: "mean", label: "Day mean forecast", align: "right" },
                { key: "min", label: "Min period", align: "right" },
                { key: "max", label: "Max period", align: "right" },
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

          <Callout tone="info" title="Why revisions matter for the desk">
            The gap between the earliest and the D-1 vintage shows how much the procurement decision could move:
            here the day mean shifted by {fmtMW(stats.last_mean - stats.first_mean)} between the D-2 and D-1 views,
            while the outturn landed {fmtMW(stats.actual_mean - stats.last_mean)} away from the D-1 view. In January
            2026 the intra-day <em>shape</em> was revised materially but the <em>level</em> was not — so waiting for the
            latest vintage before the 09:15 auction is the right operating policy, and the residual gap is bias to
            correct for, not noise to chase.
          </Callout>
        </>
      )}
    </div>
  );
}
