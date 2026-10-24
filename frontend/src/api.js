const BASE = import.meta.env.VITE_API_BASE || "/api";

async function request(path, params = {}, signal) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
  ).toString();
  const res = await fetch(`${BASE}${path}${qs ? `?${qs}` : ""}`, { signal });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail || detail;
    } catch {
      detail = res.statusText;
    }
    throw new Error(detail);
  }
  return res.json();
}

export const api = {
  meta: (signal) => request("/meta", {}, signal),
  decisionForecast: (date, cutoff, signal) => request("/decision/forecast", { date, cutoff }, signal),
  recommendation: (date, cutoff, baseDemand, confidence, signal) =>
    request(
      "/decision/recommendation",
      { date, cutoff, base_demand_mw: baseDemand, confidence },
      signal
    ),
  revisions: (date, signal) => request("/decision/revisions", { date }, signal),
  accuracySummary: (cutoff, signal) => request("/accuracy/summary", { cutoff }, signal),
  accuracyBias: (cutoff, signal) => request("/accuracy/bias", { cutoff }, signal),
  horizon: (signal) => request("/accuracy/horizon", {}, signal),
  hourly: (signal) => request("/accuracy/hourly", {}, signal),
  daily: (cutoff, signal) => request("/accuracy/daily", { cutoff }, signal),
  distribution: (signal) => request("/accuracy/distribution", {}, signal),
  scatter: (signal) => request("/accuracy/scatter", {}, signal),
  calibration: (signal) => request("/accuracy/calibration", {}, signal),
};

export default api;
