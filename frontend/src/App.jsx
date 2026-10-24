import React, { useState } from "react";
import api from "./api";
import useAsync from "./useAsync";
import Cockpit from "./pages/Cockpit";
import Accuracy from "./pages/Accuracy";
import Revisions from "./pages/Revisions";
import Method from "./pages/Method";
import { ErrorState, Loading } from "./components/ui";

const TABS = [
  {
    id: "cockpit",
    label: "Decision Cockpit",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
    desc: "Procurement sizing & risk bands",
  },
  {
    id: "accuracy",
    label: "Forecast Accuracy",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
    desc: "Error benchmarks & de-biasing",
  },
  {
    id: "revisions",
    label: "Forecast Revisions",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
    desc: "Vintage convergence over time",
  },
  {
    id: "method",
    label: "Method & Data",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
    desc: "Formulations, specs & architecture",
  },
];

const HEADINGS = {
  cockpit: [
    "Day-Ahead Decision Cockpit",
    "Latest actionable wind forecast prior to gate closure and the implied risk-adjusted thermal requirements.",
  ],
  accuracy: [
    "Forecast Accuracy Scorecard",
    "Quantified evaluation of WINDFOR against FUELHH actuals across January 2026.",
  ],
  revisions: [
    "Forecast Revisions & Evolution",
    "Convergence trajectory of successive forecast vintages published across the 48h pre-auction window.",
  ],
  method: [
    "System Methodology & Specifications",
    "Settlement period mechanics, empirical quantile formulations, and data lineage.",
  ],
};

export default function App() {
  const [tab, setTab] = useState("cockpit");
  const [cutoff, setCutoff] = useState("09:00");
  const [forcedDay, setForcedDay] = useState(null);
  const { data: meta, error, loading, retry } = useAsync((s) => api.meta(s), []);

  const openDay = (day) => {
    setForcedDay(day);
    setTab("cockpit");
  };

  return (
    <div className="app-layout">
      <aside className="app-sidebar">
        <div className="brand-header">
          <div className="brand-badge">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" />
            </svg>
          </div>
          <div className="brand-text">
            <div className="brand-title">WindCast</div>
            <div className="brand-subtitle">GB Day-Ahead Desk</div>
          </div>
        </div>

        <nav className="nav-menu">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`nav-button ${tab === t.id ? "active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              <span className="nav-icon-wrap">{t.icon}</span>
              <span className="nav-content">
                <span className="nav-label">{t.label}</span>
                <span className="nav-desc">{t.desc}</span>
              </span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          {meta && (
            <div className="meta-card">
              <div className="meta-card-title">Dataset Status</div>
              <div className="meta-row">
                <span>Scope</span>
                <strong>FUELHH + WINDFOR</strong>
              </div>
              <div className="meta-row">
                <span>Window</span>
                <strong>Jan 2026 (31 Days)</strong>
              </div>
              <div className="meta-row">
                <span>Vintages</span>
                <strong>{meta.counts?.distinct_vintages} snapshots</strong>
              </div>
              <a
                className="api-link"
                href={`${import.meta.env.VITE_API_BASE || "/api"}/docs`.replace("/api/docs", "/docs")}
                target="_blank"
                rel="noreferrer"
              >
                Swagger API Docs ↗
              </a>
            </div>
          )}
        </div>
      </aside>

      <main className="app-main">
        <header className="app-topbar">
          <div className="topbar-titles">
            <h1>{HEADINGS[tab][0]}</h1>
            <p>{HEADINGS[tab][1]}</p>
          </div>
          <div className="topbar-badges">
            <div className="status-pill status-live">
              <span className="pulse-dot" />
              <span>Elexon Live Snapshot</span>
            </div>
            <div className="status-pill status-neutral">UTC / GMT (30-min SP)</div>
            <div className="status-pill status-accent">January 2026</div>
          </div>
        </header>

        <div className="app-content">
          {loading && !meta ? (
            <Loading label="Initializing WindCast Intelligence Core" />
          ) : error ? (
            <ErrorState error={error} onRetry={retry} />
          ) : (
            <>
              {tab === "cockpit" && (
                <Cockpit
                  key={forcedDay || "default"}
                  meta={meta}
                  cutoff={cutoff}
                  setCutoff={setCutoff}
                  initialDay={forcedDay}
                />
              )}
              {tab === "accuracy" && <Accuracy cutoff={cutoff} onPickDay={openDay} />}
              {tab === "revisions" && <Revisions meta={meta} />}
              {tab === "method" && <Method meta={meta} />}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
