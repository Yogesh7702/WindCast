export const fmtGW = (mw, dp) => {
  if (mw === null || mw === undefined || Number.isNaN(mw)) return "–";
  const gw = mw / 1000;
  const digits = dp ?? (Math.abs(gw) >= 10 ? 1 : 2);
  return `${gw.toFixed(digits)} GW`;
};

export const fmtMW = (mw) =>
  mw === null || mw === undefined || Number.isNaN(mw)
    ? "–"
    : `${Math.round(mw).toLocaleString("en-GB")} MW`;

export const fmtGwh = (mwh) =>
  mwh === null || mwh === undefined || Number.isNaN(mwh)
    ? "–"
    : `${(mwh / 1000).toFixed(1)} GWh`;

export const fmtGbp = (gbp) => {
  if (gbp === null || gbp === undefined || Number.isNaN(gbp)) return "–";
  const abs = Math.abs(gbp);
  if (abs >= 1_000_000) return `£${(gbp / 1_000_000).toFixed(2)}m`;
  if (abs >= 1_000) return `£${(gbp / 1_000).toFixed(1)}k`;
  return `£${Math.round(gbp)}`;
};

export const fmtPct = (v, dp = 1) => (v === null || v === undefined || Number.isNaN(v) ? "–" : `${v.toFixed(dp)}%`);

export const hhmm = (iso) => {
  if (!iso) return "–";
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

export const dayLabel = (isoDate) =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });

export const settlementLabel = (sp) => {
  const n = Number(sp);
  const h = Math.floor((n - 1) / 2);
  const m = (n - 1) % 2 === 0 ? "00" : "30";
  return `${String(h).padStart(2, "0")}:${m}`;
};

const CLASSES = { good: "badge good", warn: "badge warn", bad: "badge bad" };
export const maeBadgeClass = (maeMw) => {
  const pct = (maeMw / 30000) * 100;
  if (pct < 5) return CLASSES.good;
  if (pct < 8) return CLASSES.warn;
  return CLASSES.bad;
};

export const C = {
  forecast: "#0f172a",
  actual: "#059669",
  band: "#cbd5e1",
  low: "#d97706",
  thermal: "#dc2626",
  grid: "#e2e8f0",
  text: "#64748b",
};
