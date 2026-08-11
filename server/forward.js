// ─────────────────────────────────────────────────────────────────────────────
// Forward test logger
//
// A forward test is the SAME deterministic engine as the backtest, restricted to
// bars that closed after you pressed Start. That is deliberate: a separate live
// engine would slowly drift out of sync with the backtest engine and then you
// could never tell whether a difference was the market or the code. Here the only
// difference between "baseline" and "forward" is which bars are counted.
//
// What this is NOT: tick-by-tick execution. Fills still use the configured bar
// assumptions (next-bar-open by default) and intrabar order is still pessimistic.
// So treat forward numbers as an honest paper record, not a broker statement.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { runBacktest, loadCandles } from "./backtest.js";
import { INSTRUMENTS } from "./data.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FWD_PATH = process.env.VERCEL ? "/tmp/forward.json" : join(__dirname, "forward.json");

const DEFAULT = { tests: [], nextId: 1 };
const load = () => {
  if (!existsSync(FWD_PATH)) return structuredClone(DEFAULT);
  try { return { ...structuredClone(DEFAULT), ...JSON.parse(readFileSync(FWD_PATH, "utf8")) }; }
  catch { return structuredClone(DEFAULT); }
};
const save = (d) => writeFileSync(FWD_PATH, JSON.stringify(d, null, 2));

// ── stats over an arbitrary slice of trades ─────────────────────────────────
// Self-contained on purpose: the backtest's computeMetrics needs a full sim
// object (equity curve, exposure, bar count), and a forward slice has none of
// that. Everything here is derivable from the trade list alone.
export function sliceStats(trades, initialCapital) {
  const n = trades.length;
  const base = {
    trades: 0, wins: 0, losses: 0, winRate: 0, netPnl: 0, netPnlPct: 0,
    profitFactor: 0, expectancy: 0, expectancyR: null, avgBars: 0,
    maxDrawdown: 0, maxDrawdownPct: 0, avgWin: 0, avgLoss: 0, plRatio: 0,
    grossProfit: 0, grossLoss: 0, charges: 0, maxWinStreak: 0, maxLossStreak: 0,
    firstTime: null, lastTime: null,
  };
  if (!n) return base;

  const sorted = [...trades].sort((a, b) => a.exitTime - b.exitTime);
  let gp = 0, gl = 0, wins = 0, losses = 0, charges = 0, bars = 0;
  let equity = initialCapital, peak = initialCapital, maxDD = 0;
  let ws = 0, ls = 0, maxWs = 0, maxLs = 0;
  const rs = [];

  for (const t of sorted) {
    if (t.pnl >= 0) { gp += t.pnl; wins++; ws++; ls = 0; maxWs = Math.max(maxWs, ws); }
    else { gl += -t.pnl; losses++; ls++; ws = 0; maxLs = Math.max(maxLs, ls); }
    charges += t.charges || 0;
    bars += t.bars || 0;
    if (t.rMultiple != null && isFinite(t.rMultiple)) rs.push(t.rMultiple);
    equity += t.pnl;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, peak - equity);
  }

  const net = gp - gl;
  return {
    trades: n, wins, losses,
    winRate: (wins / n) * 100,
    netPnl: net,
    netPnlPct: (net / initialCapital) * 100,
    profitFactor: gl > 0 ? gp / gl : (gp > 0 ? Infinity : 0),
    expectancy: net / n,
    expectancyR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
    avgBars: bars / n,
    maxDrawdown: maxDD,
    maxDrawdownPct: (maxDD / initialCapital) * 100,
    avgWin: wins ? gp / wins : 0,
    avgLoss: losses ? gl / losses : 0,
    plRatio: (wins && losses) ? (gp / wins) / (gl / losses) : 0,
    grossProfit: gp, grossLoss: gl, charges,
    maxWinStreak: maxWs, maxLossStreak: maxLs,
    firstTime: sorted[0].entryTime, lastTime: sorted[n - 1].exitTime,
  };
}

// Equity curve from a trade slice, stamped at each exit (realised only).
function realisedCurve(trades, initialCapital) {
  const sorted = [...trades].sort((a, b) => a.exitTime - b.exitTime);
  let eq = initialCapital;
  const out = [{ time: sorted.length ? sorted[0].entryTime : Math.floor(Date.now() / 1000), equity: eq }];
  for (const t of sorted) { eq += t.pnl; out.push({ time: t.exitTime, equity: eq }); }
  return out;
}

// ── verdict: is live behaving like history? ─────────────────────────────────
function compare(baseline, fwd) {
  if (!fwd.trades) {
    return { tone: "warn", title: "No forward trades yet",
      detail: "The strategy has not fired since this test started. Give it more bars, or the entry conditions are rarer than the backtest suggested." };
  }
  if (fwd.trades < 10) {
    return { tone: "warn", title: `Too early to judge — ${fwd.trades} forward trade${fwd.trades === 1 ? "" : "s"}`,
      detail: "Below about 10 trades the numbers are noise. They are shown so you can watch them accumulate, not so you can act on them." };
  }
  const wrDrop = baseline.winRate - fwd.winRate;
  const expBase = baseline.expectancyR ?? (baseline.expectancy / Math.max(1, Math.abs(baseline.avgLoss)));
  const expFwd = fwd.expectancyR ?? (fwd.expectancy / Math.max(1, Math.abs(fwd.avgLoss)));
  const ddWorse = fwd.maxDrawdownPct > baseline.maxDrawdownPct * 1.5 && fwd.maxDrawdownPct > 1;

  if (fwd.netPnl <= 0 && baseline.netPnl > 0) {
    return { tone: "bad", title: "Forward performance has broken down",
      detail: `History made ${baseline.netPnlPct.toFixed(2)}% but the live period is at ${fwd.netPnlPct.toFixed(2)}%. Either the edge was curve-fit or the regime changed. Do not scale this up.` };
  }
  if (ddWorse) {
    return { tone: "bad", title: "Drawdown is deeper than backtested",
      detail: `Forward max drawdown ${fwd.maxDrawdownPct.toFixed(2)}% against ${baseline.maxDrawdownPct.toFixed(2)}% in history. Your risk model is under-stating the pain.` };
  }
  if (wrDrop > 15 || (expBase > 0 && expFwd < expBase * 0.4)) {
    return { tone: "warn", title: "Degrading, but still positive",
      detail: `Win rate ${fwd.winRate.toFixed(1)}% vs ${baseline.winRate.toFixed(1)}% in history. It still makes money, but the margin is thinner than you planned for.` };
  }
  return { tone: "good", title: "Forward results are consistent with history",
    detail: `${fwd.trades} trades, ${fwd.winRate.toFixed(1)}% win rate, PF ${fwd.profitFactor === Infinity ? "∞" : fwd.profitFactor.toFixed(2)}. Live behaviour matches the backtest closely enough to keep going.` };
}

// ── refresh one test against fresh candles ──────────────────────────────────
async function refreshTest(t) {
  const cfg = { ...t.cfg, symbol: t.symbol, interval: t.interval, range: t.range,
    strategy: t.strategy, mode: t.mode, formula: t.formula, pineScript: t.pine,
    pineInputs: t.pineInputs, wantAllTrades: true };
  const res = await runBacktest(cfg);
  const all = res.allTrades || res.trades || [];
  const cap = res.meta.initialCapital;

  // Split on ENTRY time, not exit time. A trade opened before you pressed Start
  // belongs entirely to history even if it closed afterwards, because you were
  // never going to be in it. The two sets are therefore disjoint by construction
  // and together they are the full trade list — no trade is counted twice or lost.
  const hist = all.filter(x => x.entryTime < t.startTime);
  const fwd = all.filter(x => x.entryTime >= t.startTime);

  // Both sides express return as a percentage of the ORIGINAL capital, not of
  // equity-at-start. That keeps the two columns directly comparable, which is the
  // whole point of the panel. The consequence, stated so it cannot surprise you:
  // with risk-based sizing the forward trades were sized off equity that already
  // carried the historical P&L, exactly as a real account would be.

  const last = res.equityCurve?.[res.equityCurve.length - 1];
  return {
    updatedAt: new Date().toISOString(),
    bars: res.meta.bars ?? null,
    lastBarTime: last?.time ?? null,
    initialCapital: cap,
    baseline: sliceStats(hist, cap),
    forward: sliceStats(fwd, cap),
    forwardTrades: fwd.slice(-200),
    forwardCurve: realisedCurve(fwd, cap),
    fillMode: res.meta.fillMode,
    chargeLabel: res.meta.chargeLabel,
    sizing: res.meta.sizing,
    error: null,
  };
}

// ── public API ──────────────────────────────────────────────────────────────
export async function createForwardTest(body) {
  const { name, symbol = "^NSEI", interval = "15m", range = "1mo",
    mode = "builtin", strategy = "combined", formula = "", pine = "", pineInputs = {},
    cfg = {} } = body;

  const data = await loadCandles(symbol, interval, range);
  const candles = data.candles || [];
  if (candles.length < 30) throw new Error(`Not enough candles for ${symbol} ${interval}/${range}`);
  const lastBar = candles[candles.length - 1];
  const startTime = lastBar.time;   // only bars that close after this instant count

  const db = load();
  if (db.tests.length >= 25) throw new Error("Forward test limit reached (25) — delete one first");
  const inst = INSTRUMENTS.find(i => i.symbol === symbol);

  const test = {
    id: db.nextId++,
    name: name || `${inst?.name || symbol} · ${mode === "pine" ? "Pine" : strategy} · ${interval}`,
    symbol, symbolName: inst?.name || symbol, interval, range,
    mode, strategy, formula, pine, pineInputs, cfg,
    createdAt: new Date().toISOString(),
    startTime, startPrice: lastBar.close,
    status: "active",
    snapshot: null,
  };
  test.snapshot = await refreshTest(test);
  db.tests.push(test);
  save(db);
  return decorate(test);
}

export async function listForwardTests({ refresh = true } = {}) {
  const db = load();
  if (refresh) {
    const active = db.tests.filter(t => t.status === "active");
    await Promise.all(active.map(async (t) => {
      try { t.snapshot = await refreshTest(t); }
      catch (e) {
        t.snapshot = { ...(t.snapshot || {}), error: e.message, updatedAt: new Date().toISOString() };
      }
    }));
    save(db);
  }
  return db.tests.map(decorate);
}

export async function refreshForwardTest(id) {
  const db = load();
  const t = db.tests.find(x => x.id === +id);
  if (!t) throw new Error("Forward test not found");
  try { t.snapshot = await refreshTest(t); }
  catch (e) { t.snapshot = { ...(t.snapshot || {}), error: e.message, updatedAt: new Date().toISOString() }; }
  save(db);
  return decorate(t);
}

export function setForwardStatus(id, status) {
  if (!["active", "paused"].includes(status)) throw new Error("status must be active or paused");
  const db = load();
  const t = db.tests.find(x => x.id === +id);
  if (!t) throw new Error("Forward test not found");
  t.status = status; save(db);
  return decorate(t);
}

export function deleteForwardTest(id) {
  const db = load();
  const before = db.tests.length;
  db.tests = db.tests.filter(x => x.id !== +id);
  if (db.tests.length === before) throw new Error("Forward test not found");
  save(db);
  return { deleted: +id };
}

function decorate(t) {
  const s = t.snapshot;
  return {
    ...t,
    verdict: s && !s.error ? compare(s.baseline, s.forward) : null,
    daysLive: Math.max(0, (Date.now() / 1000 - t.startTime) / 86400),
  };
}
