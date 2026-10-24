import React from "react";

export function Panel({ title, subtitle, right, children, className = "" }) {
  return (
    <section className={`panel ${className}`}>
      {(title || right) && (
        <header className="panel-head">
          <div className="panel-titles">
            {title && <h2>{title}</h2>}
            {subtitle && <p className="panel-sub">{subtitle}</p>}
          </div>
          {right && <div className="panel-right">{right}</div>}
        </header>
      )}
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function Kpi({ label, value, sub, tone = "default", hint, badge }) {
  return (
    <div className={`kpi tone-${tone}`} title={hint || undefined}>
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        {badge && <span className="kpi-badge">{badge}</span>}
      </div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export function SegmentedControl({ options, value, onChange, size = "md" }) {
  return (
    <div className={`segmented-control size-${size}`}>
      {options.map((opt) => {
        const val = typeof opt === "object" ? opt.value : opt;
        const label = typeof opt === "object" ? opt.label : opt;
        const isSelected = value === val;
        return (
          <button
            key={String(val)}
            type="button"
            className={`segment-btn ${isSelected ? "selected" : ""}`}
            onClick={() => onChange(val)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function Loading({ label = "Loading data" }) {
  return (
    <div className="state">
      <div className="spinner-wrap">
        <span className="spinner" />
      </div>
      <span>{label}…</span>
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="state error">
      <div className="error-icon">✕</div>
      <strong>Unable to load data</strong>
      <span className="error-detail">{String(error)}</span>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          Try Again
        </button>
      )}
    </div>
  );
}

export function Callout({ tone = "info", title, children }) {
  return (
    <div className={`callout tone-${tone}`}>
      {title && <div className="callout-title">{title}</div>}
      <div className="callout-content">{children}</div>
    </div>
  );
}

export function Badge({ children, tone = "neutral" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function TooltipBox({ active, payload, label, unit = "MW", labelFormatter }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="tooltip">
      <div className="tooltip-label">{labelFormatter ? labelFormatter(label) : label}</div>
      <div className="tooltip-items">
        {payload
          .filter((p) => p.value !== null && p.value !== undefined)
          .map((p) => (
            <div key={p.dataKey || p.name} className="tooltip-row">
              <span className="dot" style={{ backgroundColor: p.color || p.fill }} />
              <span className="tooltip-name">{p.name}:</span>
              <span className="tooltip-val">
                {typeof p.value === "number" ? Math.round(p.value).toLocaleString("en-GB") : p.value} {unit}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}

export function DataTable({ columns, rows, empty = "No records available", maxHeight }) {
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
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="empty">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={r.key ?? i} className={r.__className || ""} onClick={r.__onClick || undefined}>
                {columns.map((c) => (
                  <td key={c.key} className={c.align || "left"}>
                    {c.render ? c.render(r) : r[c.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
