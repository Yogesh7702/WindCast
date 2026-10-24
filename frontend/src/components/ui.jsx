import React from "react";

export function Panel({ title, subtitle, right, children, className = "" }) {
  return (
    <section className={`panel ${className}`}>
      {(title || right) && (
        <header className="panel-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p className="panel-sub">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function Kpi({ label, value, sub, tone = "default", hint }) {
  return (
    <div className={`kpi tone-${tone}`} title={hint || undefined}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  );
}

export function Loading({ label = "Loading" }) {
  return (
    <div className="state">
      <span className="spinner" /> {label}…
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="state error">
      <strong>Could not load data.</strong>
      <span>{String(error)}</span>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Callout({ tone = "info", title, children }) {
  return (
    <div className={`callout ${tone}`}>
      {title && <strong>{title}</strong>}
      <div>{children}</div>
    </div>
  );
}

export function Badge({ children, tone = "neutral" }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function TooltipBox({ active, payload, label, unit = "MW", labelFormatter }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="tooltip">
      <div className="tooltip-label">{labelFormatter ? labelFormatter(label) : label}</div>
      {payload
        .filter((p) => p.value !== null && p.value !== undefined)
        .map((p) => (
          <div key={p.dataKey} className="tooltip-row">
            <span className="dot" style={{ background: p.color || p.fill }} />
            <span>{p.name}</span>
            <strong>
              {typeof p.value === "number" ? Math.round(p.value).toLocaleString("en-GB") : p.value} {unit}
            </strong>
          </div>
        ))}
    </div>
  );
}

export function DataTable({ columns, rows, empty = "No rows", maxHeight }) {
  return (
    <div className="table-wrap" style={maxHeight ? { maxHeight } : undefined}>
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align || "left"}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="empty">
                {empty}
              </td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={r.key ?? i} className={r.__className || ""} onClick={r.__onClick || undefined}>
              {columns.map((c) => (
                <td key={c.key} className={c.align || "left"}>
                  {c.render ? c.render(r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
