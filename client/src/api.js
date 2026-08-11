const BASE = import.meta.env.DEV ? "http://localhost:3500/api" : "/api";
export const API_BASE = BASE;
async function get(p) { const r = await fetch(`${BASE}${p}`); if (!r.ok) throw new Error((await r.json().catch(()=>({}))).error || r.statusText); return r.json(); }
async function post(p, b) { const r = await fetch(`${BASE}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b||{}) }); if (!r.ok) throw new Error((await r.json().catch(()=>({}))).error || r.statusText); return r.json(); }
async function del(p) { const r = await fetch(`${BASE}${p}`, { method: "DELETE" }); if (!r.ok) throw new Error(r.statusText); return r.json(); }

export const api = {
  instruments: () => get("/instruments"),
  quotes: (symbols) => get(`/quotes?symbols=${encodeURIComponent(symbols.join(","))}`),
  analyze: (params) => get(`/analyze?${new URLSearchParams(params)}`),
  portfolio: () => get("/portfolio"),
  openTrade: (b) => post("/trades", b),
  closeTrade: (id, exitPrice) => post(`/trades/${id}/close`, { exitPrice }),
  trades: (l=50) => get(`/trades?limit=${l}`),
  signals: (l=30) => get(`/signals?limit=${l}`),
  stats: () => get("/stats"),
  backtest: (b) => post("/backtest", b),
  optimize: (b) => post("/optimize", b),
  optimizeMeta: () => get("/optimize-meta"),
  robustness: (b) => post("/robustness", b),
  portfolioBacktest: (b) => post("/portfolio-backtest", b),
  forwardTests: (refresh = true) => get(`/forward?refresh=${refresh}`),
  createForward: (b) => post("/forward", b),
  refreshForward: (id) => post(`/forward/${id}/refresh`),
  setForwardStatus: (id, status) => post(`/forward/${id}/status`, { status }),
  deleteForward: (id) => del(`/forward/${id}`),
  brokerStatus: () => get("/broker/status"),
  brokerTicks: () => get("/broker/ticks"),
  brokerConnect: (b) => post("/broker/connect", b),
  brokerDisconnect: () => post("/broker/disconnect"),
  aiStatus: () => get("/ai-status"),
  aiSignal: (b) => post("/ai-signal", b),
  resetPortfolio: () => post("/portfolio/reset"),
  alerts: (l=50) => get(`/alerts?limit=${l}`),
  markAlertsRead: () => post("/alerts/read"),
  clearAlerts: () => post("/alerts/clear"),
  alertRules: () => get("/alert-rules"),
  addAlertRule: (b) => post("/alert-rules", b),
  deleteAlertRule: (id) => del(`/alert-rules/${id}`),
};
