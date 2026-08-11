// Simple JSON file store — no native deps needed
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.VERCEL ? "/tmp/trading.json" : join(__dirname, "trading.json");

const DEFAULT = {
  portfolio: { balance: 1000000, initial_balance: 1000000 },
  trades: [], signals: [], alerts: [], alertRules: [],
  nextTradeId: 1, nextSignalId: 1, nextAlertId: 1, nextRuleId: 1,
};

function load() {
  if (!existsSync(DB_PATH)) return structuredClone(DEFAULT);
  try { return { ...structuredClone(DEFAULT), ...JSON.parse(readFileSync(DB_PATH, "utf8")) }; }
  catch { return structuredClone(DEFAULT); }
}
function save(db) { writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }

export function getPortfolio() {
  const db = load();
  const openTrades = db.trades.filter(t => t.status === "OPEN");
  return { ...db.portfolio, openTrades };
}

export function openTrade({ symbol, side, quantity, entryPrice, strategy, reason }) {
  const db = load();
  const cost = quantity * entryPrice;
  if (db.portfolio.balance < cost) throw new Error("Insufficient balance");
  db.portfolio.balance -= cost;
  const trade = { id: db.nextTradeId++, symbol, side, quantity, entry_price: entryPrice,
    exit_price: null, pnl: null, status: "OPEN", strategy: strategy || null,
    signal_reason: reason || null, opened_at: new Date().toISOString(), closed_at: null };
  db.trades.push(trade); save(db);
  return { tradeId: trade.id, balance: db.portfolio.balance };
}

export function closeTrade(tradeId, exitPrice) {
  const db = load();
  const trade = db.trades.find(t => t.id === tradeId && t.status === "OPEN");
  if (!trade) throw new Error("Trade not found or already closed");
  const pnl = trade.side === "BUY" ? (exitPrice - trade.entry_price) * trade.quantity
    : (trade.entry_price - exitPrice) * trade.quantity;
  trade.exit_price = exitPrice; trade.pnl = pnl; trade.status = "CLOSED"; trade.closed_at = new Date().toISOString();
  db.portfolio.balance += trade.quantity * trade.entry_price + pnl;
  save(db);
  return { tradeId, pnl, exitPrice };
}

export function getTradeHistory(limit = 50) { return load().trades.slice(-limit).reverse(); }

export function logSignal({ symbol, signal, reason, price, strategy }) {
  const db = load();
  db.signals.push({ id: db.nextSignalId++, symbol, signal, reason, price, strategy, created_at: new Date().toISOString() });
  if (db.signals.length > 200) db.signals = db.signals.slice(-200);
  save(db);
}
export function getSignalHistory(limit = 30) { return load().signals.slice(-limit).reverse(); }

// ---- ALERTS ----
// Auto-generated alert; dedups identical (symbol+signal+strategy) within 5 min
export function pushAlert({ symbol, signal, reason, price, strategy, kind }) {
  const db = load();
  const now = Date.now();
  const dup = db.alerts.find(a => a.symbol === symbol && a.signal === signal && a.strategy === strategy
    && (now - new Date(a.created_at).getTime()) < 5 * 60 * 1000);
  if (dup) return null;
  const alert = { id: db.nextAlertId++, symbol, signal, reason, price, strategy, kind: kind || "signal",
    read: false, created_at: new Date().toISOString() };
  db.alerts.push(alert);
  if (db.alerts.length > 200) db.alerts = db.alerts.slice(-200);
  save(db);
  return alert;
}
export function getAlerts(limit = 50) { return load().alerts.slice(-limit).reverse(); }
export function markAlertsRead() { const db = load(); db.alerts.forEach(a => a.read = true); save(db); return { ok: true }; }
export function clearAlerts() { const db = load(); db.alerts = []; save(db); return { ok: true }; }

// ---- USER PRICE ALERT RULES ----
export function addAlertRule({ symbol, condition, price }) {
  const db = load();
  const rule = { id: db.nextRuleId++, symbol, condition, price: +price, active: true, created_at: new Date().toISOString() };
  db.alertRules.push(rule); save(db);
  return rule;
}
export function getAlertRules() { return load().alertRules.filter(r => r.active); }
export function deleteAlertRule(id) { const db = load(); db.alertRules = db.alertRules.filter(r => r.id !== id); save(db); return { ok: true }; }
// Evaluate price rules against a live price; fires matching ones (deactivates after fire)
export function checkPriceRules(symbol, price) {
  const db = load();
  const fired = [];
  for (const r of db.alertRules) {
    if (!r.active || r.symbol !== symbol) continue;
    if ((r.condition === "above" && price >= r.price) || (r.condition === "below" && price <= r.price)) {
      r.active = false;
      const alert = { id: db.nextAlertId++, symbol, signal: r.condition === "above" ? "BUY" : "SELL",
        reason: `Price ${r.condition} ${r.price} (now ${price.toFixed(2)})`, price, strategy: "price_alert",
        kind: "price", read: false, created_at: new Date().toISOString() };
      db.alerts.push(alert); fired.push(alert);
    }
  }
  if (fired.length) save(db);
  return fired;
}

export function resetPortfolio() {
  const db = load();
  db.trades = []; db.portfolio.balance = db.portfolio.initial_balance;
  save(db);
  return getPortfolio();
}

// ---- PERFORMANCE STATISTICS ----
// Computes overall + per-strategy metrics from CLOSED trades.
function computeMetrics(trades) {
  const closed = trades.filter(t => t.status === "CLOSED" && t.pnl != null);
  const wins = closed.filter(t => t.pnl > 0);
  const losses = closed.filter(t => t.pnl < 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const netPnl = closed.reduce((s, t) => s + t.pnl, 0);
  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  return {
    totalTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? (wins.length / closed.length) * 100 : 0,
    grossProfit, grossLoss, netPnl,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0),
    avgWin, avgLoss,
    plRatio: avgLoss > 0 ? avgWin / avgLoss : (avgWin > 0 ? Infinity : 0),
    bestTrade: closed.length ? Math.max(...closed.map(t => t.pnl)) : 0,
    worstTrade: closed.length ? Math.min(...closed.map(t => t.pnl)) : 0,
    expectancy: closed.length ? netPnl / closed.length : 0,
  };
}

export function getStats() {
  const db = load();
  const overall = computeMetrics(db.trades);
  const byStrategy = {};
  for (const t of db.trades) {
    if (t.status !== "CLOSED" || t.pnl == null) continue;
    const k = t.strategy || "manual";
    (byStrategy[k] = byStrategy[k] || []).push(t);
  }
  const strategies = Object.entries(byStrategy)
    .map(([strategy, ts]) => ({ strategy, ...computeMetrics(ts) }))
    .sort((a, b) => b.netPnl - a.netPnl);
  // Cumulative equity curve from closed trades (chronological)
  const closedChron = db.trades.filter(t => t.status === "CLOSED" && t.pnl != null)
    .sort((a, b) => new Date(a.closed_at) - new Date(b.closed_at));
  let cum = 0;
  const equityCurve = closedChron.map(t => ({ t: t.closed_at, pnl: t.pnl, cum: (cum += t.pnl) }));
  return { overall, strategies, equityCurve };
}
