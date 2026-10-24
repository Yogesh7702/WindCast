import React, { useState } from "react";
import api from "./api";
import useAsync from "./useAsync";
import Cockpit from "./pages/Cockpit";
import Accuracy from "./pages/Accuracy";
import Revisions from "./pages/Revisions";
import Method from "./pages/Method";
import { ErrorState, Loading } from "./components/ui";

const TABS = [
  { id: "cockpit", label: "Decision cockpit", icon: "◎", blurb: "Buy with quantified risk" },
  { id: "accuracy", label: "Forecast accuracy", icon: "▤", blurb: "Score every vintage" },
  { id: "revisions", label: "Forecast revisions", icon: "∿", blurb: "How the view moved" },
  { id: "method", label: "Method & data", icon: "⚙", blurb: "Scope, assumptions, API" },
];

const HEADINGS = {
  cockpit: ["Decision cockpit", "The latest wind forecast before the auction cut-off, and the thermal capacity it implies."],
  accuracy: ["Forecast accuracy", "How good is WINDFOR, where does it fail, and how much of the error is correctable?"],
  revisions: ["Forecast revisions", "How each published vintage converged on the delivery day — and onto the wrong level."],
  method: ["Method & data", "Scope, assumptions, architecture and the API surface."],
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
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">W</div>
          <div>
            <div className="brand-name">WindCast</div>
            <div className="brand-sub">day-ahead wind intelligence</div>
          </div>
        </div>

        <nav>
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? "nav-item active" : "nav-item"} onClick={() => setTab(t.id)}>
              <span className="nav-icon">{t.icon}</span>
              <span>
                <span className="nav-label">{t.label}</span>
                <span className="nav-blurb">{t.blurb}</span>
              </span>
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          {meta && (
            <>
              <div className="fact">
                <span>Data scope</span>
                <strong>Elexon FUELHH + WINDFOR</strong>
              </div>
              <div className="fact">
                <span>Delivery window</span>
                <strong>
                  {meta.delivery_dates?.[0]} → {meta.delivery_dates?.[meta.delivery_dates.length - 1]}
                </strong>
              </div>
              <div className="fact">
                <span>Snapshot</span>
                <strong>{meta.generated_at?.slice(0, 16).replace("T", " ")}Z</strong>
              </div>
              <div className="fact">
                <span>Vintages</span>
                <strong>{meta.counts?.distinct_vintages}</strong>
              </div>
              <a className="doc-link" href={`${import.meta.env.VITE_API_BASE || "/api"}/docs`.replace("/api/docs", "/docs")} target="_blank" rel="noreferrer">
                API docs ↗
              </a>
            </>
          )}
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <h1>{HEADINGS[tab][0]}</h1>
            <p>{HEADINGS[tab][1]}</p>
          </div>
          <div className="topbar-right">
            <span className="pill live">● live snapshot</span>
            <span className="pill">UTC / GMT</span>
            <span className="pill">Jan 2026</span>
          </div>
        </header>

        {loading && !meta ? (
          <Loading label="Connecting to WindCast API" />
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
      </main>
    </div>
  );
}
