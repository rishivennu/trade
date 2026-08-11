// portfolio.js — run one strategy across many symbols and aggregate as a portfolio.
// Each symbol is backtested independently on its own capital slice, then the
// equity curves are aligned on a shared time axis and summed. An optional
// "portfolio heat" cap re-plays the combined trade tape chronologically and
// drops entries that would exceed a concurrent-position or open-risk limit.
import { loadCandles, buildSignals, simulate, computeMetrics } from "./backtest.js";
import { drawdownSeries, riskAdjusted, monthlyReturns, streaks } from "./metrics.js";

function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  if (da <= 0 || db <= 0) return null;
  return num / Math.sqrt(da * db);
}

// Step-forward ("last known value") resample of {time,equity} onto a time axis.
function alignCurve(curve, axis, fallback) {
  const out = new Array(axis.length);
  let j = 0, last = fallback;
  for (let i = 0; i < axis.length; i++) {
    while (j < curve.length && curve[j].time <= axis[i]) { last = curve[j].equity; j++; }
    out[i] = last;
  }
  return out;
}

function returnsOf(series) {
  const r = [];
  for (let i = 1; i < series.length; i++) {
    const p = series[i - 1];
    r.push(p ? (series[i] - p) / p : 0);
  }
  return r;
}

// Bucket a bar timestamp into a comparable period key. Exchanges on different
// calendars stamp the "same" daily bar with different session-close epochs
// (NSE 15:30 IST vs COMEX 17:00 ET), so exact-epoch matching finds zero overlap.
const INTERVAL_SECS = {
  "1m": 60, "2m": 120, "5m": 300, "15m": 900, "30m": 1800,
  "60m": 3600, "1h": 3600, "90m": 5400,
  "1d": 86400, "5d": 5 * 86400, "1wk": 7 * 86400, "1mo": 30 * 86400,
};
function bucketer(interval) {
  const secs = INTERVAL_SECS[interval] || 86400;
  return (t) => Math.floor(t / secs);
}

export async function runPortfolioBacktest(opts) {
  const {
    symbols = [], interval = "1d", range = "1y",
    initialCapital = 1000000,
    weights = null,          // { SYM: 0.4, ... } — normalised; equal weight if absent
    maxOpenPositions = 0,    // 0 = unlimited
    maxHeatPct = 0,          // 0 = unlimited; sum of open per-trade risk % of portfolio
  } = opts;

  const syms = [...new Set(symbols.filter(Boolean))];
  if (syms.length < 2) throw Object.assign(new Error(`Portfolio backtest needs at least 2 distinct symbols (got ${syms.length})`), { status: 400 });
  if (syms.length > 20) throw Object.assign(new Error(`Portfolio backtest is capped at 20 symbols (got ${syms.length})`), { status: 400 });

  // Normalise weights
  const rawW = {};
  let wSum = 0;
  for (const s of syms) {
    const w = weights && weights[s] > 0 ? Number(weights[s]) : 1;
    rawW[s] = w; wSum += w;
  }
  const wNorm = {};
  for (const s of syms) wNorm[s] = rawW[s] / wSum;

  // ── Per-symbol backtests, in parallel ─────────────────────────────────────
  const legs = await Promise.all(syms.map(async (symbol) => {
    const alloc = initialCapital * wNorm[symbol];
    try {
      const data = await loadCandles(symbol, interval, range);
      const candles = data.candles;
      if (!candles || candles.length < 30) throw new Error("not enough bars");
      const sub = { ...opts, symbol, interval, range, initialCapital: alloc, replay: false };
      const sig = buildSignals(candles, sub);
      const sim = simulate(candles, sig.signals, sub, sig.startIdx, { atr: sig.atr, pineExits: sig.pineExits });
      const met = computeMetrics(sim, candles, sig.startIdx, sub, { adxSeries: null, atrPct: null });
      return {
        symbol, ok: true, allocation: alloc, weight: wNorm[symbol],
        bars: candles.length, name: data.name || symbol,
        metrics: met.metrics,
        equityCurve: sim.equityCurve,
        trades: sim.trades.map(t => ({ ...t, symbol })),
        priceCurve: candles.map(c => ({ time: c.time, equity: c.close })),
      };
    } catch (e) {
      return { symbol, ok: false, allocation: alloc, weight: wNorm[symbol], error: String(e.message || e) };
    }
  }));

  const good = legs.filter(l => l.ok && l.equityCurve.length);
  if (good.length < 2) {
    throw new Error("Fewer than 2 symbols produced a usable backtest: " +
      legs.filter(l => !l.ok).map(l => `${l.symbol} (${l.error})`).join(", "));
  }

  // ── Shared time axis = union of all equity-curve timestamps ────────────────
  const tset = new Set();
  for (const l of good) for (const p of l.equityCurve) tset.add(p.time);
  const axis = [...tset].sort((a, b) => a - b);

  const aligned = {};
  for (const l of good) aligned[l.symbol] = alignCurve(l.equityCurve, axis, l.allocation);

  // Capital that actually got deployed (failed legs are excluded, so rescale)
  const deployed = good.reduce((s, l) => s + l.allocation, 0);
  const portCurve = axis.map((time, i) => {
    let eq = 0;
    for (const l of good) eq += aligned[l.symbol][i];
    return { time, equity: eq };
  });

  // ── Correlation matrices ──────────────────────────────────────────────────
  // Correlate on each PAIR's own overlapping timestamps, not the union axis.
  // Symbols on different calendars (NSE vs COMEX vs FX) would otherwise be
  // padded with flat step-forward bars whose zero returns drag |r| toward 0.
  const bucket = bucketer(interval);
  const stratMap = {}, priceMap = {};
  for (const l of good) {
    const sm = new Map(), pm = new Map();
    const rawEq = new Map();
    for (const p of l.equityCurve) rawEq.set(p.time, p.equity);
    // equity is only emitted on bars the leg traded; step-forward onto price axis
    let lastEq = l.allocation;
    for (const p of l.priceCurve) {
      if (rawEq.has(p.time)) lastEq = rawEq.get(p.time);
      sm.set(bucket(p.time), lastEq);
      pm.set(bucket(p.time), p.equity);
    }
    stratMap[l.symbol] = sm; priceMap[l.symbol] = pm;
  }
  const pairCorr = (maps, sa, sb) => {
    if (sa === sb) return 1;
    const A = maps[sa], B = maps[sb];
    const times = [...A.keys()].filter(t => B.has(t)).sort((x, y) => x - y);
    if (times.length < 5) return null;
    const ra = [], rb = [];
    for (let i = 1; i < times.length; i++) {
      const a0 = A.get(times[i - 1]), a1 = A.get(times[i]);
      const b0 = B.get(times[i - 1]), b1 = B.get(times[i]);
      if (!a0 || !b0) continue;
      ra.push((a1 - a0) / a0); rb.push((b1 - b0) / b0);
    }
    return pearson(ra, rb);
  };
  const mkMatrix = (maps) => {
    const m = [];
    for (const a of good) {
      const row = { symbol: a.symbol, values: [], overlap: [] };
      for (const b of good) {
        row.values.push(pairCorr(maps, a.symbol, b.symbol));
        row.overlap.push([...maps[a.symbol].keys()].filter(t => maps[b.symbol].has(t)).length);
      }
      m.push(row);
    }
    return m;
  };
  const strategyCorr = mkMatrix(stratMap);
  const priceCorr = mkMatrix(priceMap);
  // Average off-diagonal strategy correlation = crude diversification score
  let cSum = 0, cN = 0;
  for (let i = 0; i < strategyCorr.length; i++)
    for (let j = i + 1; j < strategyCorr.length; j++) {
      const v = strategyCorr[i].values[j];
      if (v != null && isFinite(v)) { cSum += v; cN++; }
    }
  const avgCorr = cN ? cSum / cN : null;

  // ── Combined trade tape + concurrency / heat analysis ──────────────────────
  const tape = good.flatMap(l => l.trades)
    .filter(t => t.entryTime != null)
    .sort((a, b) => a.entryTime - b.entryTime || a.symbol.localeCompare(b.symbol));

  const riskPctOf = (t) => {
    const risk = (t.riskPerUnit || 0) * (t.qty || 0);
    return deployed > 0 ? (risk / deployed) * 100 : 0;
  };

  let maxConcurrent = 0, maxHeatSeen = 0;
  const kept = [], skipped = [];
  const open = []; // { exitTime, riskPct }
  for (const t of tape) {
    while (open.length && open[0].exitTime <= t.entryTime) open.shift();
    open.sort((a, b) => a.exitTime - b.exitTime);
    const heatNow = open.reduce((s, o) => s + o.riskPct, 0);
    const myRisk = riskPctOf(t);
    const wouldExceedCount = maxOpenPositions > 0 && open.length >= maxOpenPositions;
    const wouldExceedHeat = maxHeatPct > 0 && heatNow + myRisk > maxHeatPct + 1e-9;
    if (wouldExceedCount || wouldExceedHeat) {
      skipped.push({ symbol: t.symbol, entryTime: t.entryTime, side: t.side, pnl: t.pnl,
        reason: wouldExceedCount ? "maxOpenPositions" : "maxHeatPct" });
      continue;
    }
    kept.push(t);
    open.push({ exitTime: t.exitTime ?? Infinity, riskPct: myRisk });
    open.sort((a, b) => a.exitTime - b.exitTime);
    maxConcurrent = Math.max(maxConcurrent, open.length);
    maxHeatSeen = Math.max(maxHeatSeen, heatNow + myRisk);
  }

  // Realised-at-exit equity curve for the (possibly heat-filtered) tape.
  // NOTE: this is realised-only, not mark-to-market, so its drawdown is a
  // floor, not the true intrabar drawdown.
  const buildRealised = (trades) => {
    const sorted = [...trades].filter(t => t.exitTime != null).sort((a, b) => a.exitTime - b.exitTime);
    let eq = deployed;
    const curve = [{ time: axis[0], equity: eq }];
    for (const t of sorted) { eq += t.pnl; curve.push({ time: t.exitTime, equity: eq }); }
    return curve;
  };

  const heatApplied = maxOpenPositions > 0 || maxHeatPct > 0;
  const filteredCurve = heatApplied ? buildRealised(kept) : null;

  // ── Portfolio metrics from the mark-to-market summed curve ─────────────────
  const summarise = (curve, trades, label) => {
    const dd = drawdownSeries(curve);
    const ra = riskAdjusted(curve, interval, deployed, dd.maxDDPct);
    const wins = trades.filter(t => t.pnl > 0), losses = trades.filter(t => t.pnl < 0);
    const gp = wins.reduce((s, t) => s + t.pnl, 0);
    const gl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const net = curve.length ? curve[curve.length - 1].equity - deployed : 0;
    return {
      label,
      totalTrades: trades.length, wins: wins.length, losses: losses.length,
      winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
      netPnl: net, netPnlPct: (net / deployed) * 100, finalEquity: deployed + net,
      profitFactor: gl > 0 ? gp / gl : (gp > 0 ? Infinity : 0),
      expectancy: trades.length ? net / trades.length : 0,
      expectancyR: trades.length ? trades.reduce((s, t) => s + (t.rMultiple || 0), 0) / trades.length : 0,
      maxDrawdown: dd.maxDD, maxDrawdownPct: dd.maxDDPct, longestDDBars: dd.longestDDBars,
      sharpe: ra.sharpe, sortino: ra.sortino, calmar: ra.calmar, cagr: ra.cagr,
      annualVolPct: ra.annualVolPct,
      totalCharges: trades.reduce((s, t) => s + (t.charges || 0), 0),
      ...streaks(trades),
    };
  };

  const allTrades = tape;
  const portfolio = summarise(portCurve, allTrades, "mark-to-market, all signals taken");
  const filtered = heatApplied ? summarise(filteredCurve, kept, "realised-at-exit, heat-capped") : null;

  // Best single leg vs portfolio — does diversification actually help?
  const legNets = good.map(l => l.metrics.netPnlPct);
  const bestLeg = Math.max(...legNets), worstLeg = Math.min(...legNets);

  return {
    meta: {
      symbols: syms, interval, range, initialCapital, deployedCapital: deployed,
      bars: axis.length, from: axis[0], to: axis[axis.length - 1],
      strategy: opts.strategy || "combined",
      maxOpenPositions, maxHeatPct, heatApplied,
      failed: legs.filter(l => !l.ok).map(l => ({ symbol: l.symbol, error: l.error })),
    },
    portfolio,
    filtered,
    equityCurve: portCurve,
    filteredCurve,
    drawdown: drawdownSeries(portCurve).dd,
    monthly: monthlyReturns(portCurve),
    legs: good.map(l => ({
      symbol: l.symbol, name: l.name, weight: l.weight, allocation: l.allocation,
      bars: l.bars, metrics: l.metrics,
      curve: l.equityCurve,
    })),
    correlation: { strategy: strategyCorr, price: priceCorr, avgStrategyCorr: avgCorr },
    concurrency: {
      maxConcurrent, maxHeatPctSeen: maxHeatSeen,
      keptTrades: kept.length, skippedTrades: skipped.length,
      skipped: skipped.slice(0, 50),
    },
    diversification: {
      bestLegPct: bestLeg, worstLegPct: worstLeg, portfolioPct: portfolio.netPnlPct,
      avgStrategyCorr: avgCorr,
      verdict: avgCorr == null ? "Not enough overlap to judge correlation."
        : avgCorr > 0.7 ? `Legs are highly correlated (avg ${avgCorr.toFixed(2)}) — this is one bet wearing ${good.length} hats, not a diversified portfolio.`
        : avgCorr > 0.4 ? `Moderate correlation (avg ${avgCorr.toFixed(2)}) — some diversification, but expect legs to draw down together.`
        : `Low correlation (avg ${avgCorr.toFixed(2)}) — genuine diversification; portfolio drawdown should beat the average leg.`,
    },
    trades: allTrades.slice(-300).reverse().map(t => ({
      symbol: t.symbol, side: t.side, entry: t.entry, exit: t.exit, qty: t.qty,
      entryTime: t.entryTime, exitTime: t.exitTime, bars: t.bars,
      pnl: t.pnl, pnlPct: t.pnlPct, exitReason: t.exitReason,
      rMultiple: t.rMultiple, charges: t.charges,
    })),
  };
}
