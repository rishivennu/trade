// Parameter optimizer: grid sweep plus WALK-FORWARD validation.
//
// A plain grid search is actively harmful on its own — it finds the luckiest
// parameters and calls them the best. Walk-forward fits on an in-sample window
// and scores ONLY on the untouched out-of-sample window that follows, so the
// IS-vs-OS gap becomes a direct measure of overfitting.
import { loadCandles, buildSignals, simulate, computeMetrics, computeATR } from "./backtest.js";

// Default sweep ranges per strategy. Execution params are appended for all.
export const PARAM_GRIDS = {
  pp_supertrend: [
    { key: "ppPrd", label: "Pivot Period", values: [1, 2, 3, 4, 5] },
    { key: "ppFactor", label: "ATR Factor", values: [1.5, 2, 2.5, 3, 3.5, 4] },
    { key: "ppAtrLen", label: "ATR Length", values: [7, 10, 14, 21] },
  ],
  ema_cross: [
    { key: "emaFastPeriod", label: "Fast EMA", values: [5, 8, 9, 13, 21] },
    { key: "emaSlowPeriod", label: "Slow EMA", values: [21, 34, 50, 100, 200] },
  ],
  rsi_reversal: [
    { key: "rsiPeriod", label: "RSI Length", values: [7, 9, 14, 21] },
    { key: "rsiOversold", label: "Oversold", values: [20, 25, 30, 35] },
    { key: "rsiOverbought", label: "Overbought", values: [65, 70, 75, 80] },
  ],
  combined: [
    { key: "emaFastPeriod", label: "Fast EMA", values: [5, 9, 13, 21] },
    { key: "emaSlowPeriod", label: "Slow EMA", values: [21, 34, 50, 100] },
    { key: "rsiPeriod", label: "RSI Length", values: [9, 14, 21] },
  ],
  macd: [
    { key: "slAtr", label: "Stop (ATR)", values: [0, 1, 1.5, 2, 3] },
    { key: "tpAtr", label: "Target (ATR)", values: [0, 2, 3, 4, 6] },
  ],
  ict: [
    { key: "slAtr", label: "Stop (ATR)", values: [0, 1, 1.5, 2, 3] },
    { key: "tpAtr", label: "Target (ATR)", values: [0, 2, 3, 4, 6] },
  ],
  custom: [
    { key: "slAtr", label: "Stop (ATR)", values: [0, 1, 1.5, 2, 3] },
    { key: "tpAtr", label: "Target (ATR)", values: [0, 2, 3, 4, 6] },
  ],
};

export const EXEC_GRID = [
  { key: "slAtr", label: "Stop (ATR)", values: [0, 1, 1.5, 2, 2.5, 3] },
  { key: "tpAtr", label: "Target (ATR)", values: [0, 2, 3, 4, 6] },
  { key: "trailAtr", label: "Trailing (ATR)", values: [0, 2, 3, 4] },
  { key: "riskPct", label: "Risk per trade %", values: [0.5, 1, 1.5, 2] },
];

// Params that change the SIGNALS (expensive). Everything else only changes the
// simulation, so signals can be reused across those combos.
const SIGNAL_KEYS = new Set([
  "strategy", "emaFastPeriod", "emaSlowPeriod", "rsiPeriod", "rsiOverbought", "rsiOversold",
  "formula", "pineScript", "ppPrd", "ppFactor", "ppAtrLen", "ppUseEma", "ppEmaLen",
  "ppUseAdx", "ppAdxLen", "ppAdxSmooth", "ppAdxMin", "ppUseVolume", "ppVolLen", "ppUseCandle",
]);

export function cartesian(dims, cap = 4000) {
  let out = [{}];
  for (const d of dims) {
    const next = [];
    for (const base of out) {
      for (const v of d.values) {
        next.push({ ...base, [d.key]: v });
        if (next.length > cap) return { combos: next.slice(0, cap), truncated: true };
      }
    }
    out = next;
  }
  return { combos: out, truncated: false };
}

// Objective functions. Default deliberately penalises low trade counts: a
// profit factor of 8 over 3 trades is noise, not an edge.
export const OBJECTIVES = {
  robustPF: { label: "Profit factor × √trades (recommended)", fn: (m) => (isFinite(m.profitFactor) ? m.profitFactor : 3) * Math.sqrt(Math.max(0, m.totalTrades)) },
  profitFactor: { label: "Profit factor", fn: (m) => isFinite(m.profitFactor) ? m.profitFactor : 0 },
  expectancyR: { label: "Expectancy (R per trade)", fn: (m) => m.expectancyR * Math.sqrt(Math.max(0, m.totalTrades)) },
  sharpe: { label: "Sharpe ratio", fn: (m) => m.sharpe },
  calmar: { label: "Calmar (CAGR / maxDD)", fn: (m) => m.calmar },
  netPnl: { label: "Net P&L %", fn: (m) => m.netPnlPct },
  winRate: { label: "Win rate", fn: (m) => m.winRate * Math.sqrt(Math.max(0, m.totalTrades)) },
};

// Evaluate one parameter combo over a bar window. Signals are memoised.
function makeEvaluator(candles, baseOpts, interval) {
  const cache = new Map();
  const atrFull = computeATR(candles, 14);
  return function evaluate(combo, from, to) {
    const opts = { ...baseOpts, ...combo, interval };
    const sigKey = JSON.stringify(Object.keys(opts).filter(k => SIGNAL_KEYS.has(k)).sort().map(k => [k, opts[k]]))
      + JSON.stringify(opts.pineInputs || {});
    let sig = cache.get(sigKey);
    if (!sig) {
      sig = buildSignals(candles, opts);
      cache.set(sigKey, sig);
    }
    const start = Math.max(sig.startIdx, from);
    if (to - start < 10) return null;
    const sim = simulate(candles, sig.signals, { ...opts, endIdx: to }, start, { atr: atrFull, pineExits: sig.pineExits });
    const { metrics } = computeMetrics(sim, candles, start, opts, {});
    return { metrics, trades: sim.trades, equityCurve: sim.equityCurve, startIdx: start };
  };
}

// ── Single-window grid sweep ────────────────────────────────────────────────
export async function runGridSearch(opts) {
  const {
    symbol = "^NSEI", interval = "1d", range = "1y",
    grid = null, objective = "robustPF", minTrades = 5, topN = 40,
  } = opts;
  const data = await loadCandles(symbol, interval, range);
  const candles = data.candles;
  const dims = normaliseGrid(grid, opts);
  if (!dims.length) throw Object.assign(new Error("No parameters to sweep — pick at least one value in at least one dimension"), { status: 400 });
  const { combos, truncated } = cartesian(dims);
  const objFn = (OBJECTIVES[objective] || OBJECTIVES.robustPF).fn;
  const evaluate = makeEvaluator(candles, opts, interval);

  const rows = [];
  for (const combo of combos) {
    const r = evaluate(combo, 0, candles.length);
    if (!r) continue;
    rows.push({ params: combo, score: objFn(r.metrics), metrics: slimMetrics(r.metrics) });
  }
  const eligible = rows.filter(r => r.metrics.totalTrades >= minTrades);
  eligible.sort((a, b) => b.score - a.score);

  return {
    meta: { symbol: data.symbol, interval, range, bars: candles.length, objective,
      objectiveLabel: (OBJECTIVES[objective] || OBJECTIVES.robustPF).label,
      combos: combos.length, evaluated: rows.length, eligible: eligible.length,
      minTrades, truncated, dims: dims.map(d => ({ key: d.key, label: d.label, values: d.values })) },
    best: eligible[0] || null,
    results: eligible.slice(0, topN),
    heatmap: buildHeatmap(dims, rows, objFn, minTrades),
  };
}

// A 2-D surface is the single most useful optimizer output: a broad plateau is
// robust, an isolated spike is curve-fit noise you should not trade.
function buildHeatmap(dims, rows, objFn, minTrades) {
  if (dims.length < 2) return null;
  const [a, b] = dims;
  const cells = [];
  for (const av of a.values) {
    for (const bv of b.values) {
      const matching = rows.filter(r => r.params[a.key] === av && r.params[b.key] === bv && r.metrics.totalTrades >= minTrades);
      if (!matching.length) { cells.push({ x: av, y: bv, score: null, avg: null, samples: 0 }); continue; }
      const top = matching.reduce((p, r) => (r.score > p.score ? r : p), matching[0]);
      const avg = matching.reduce((s, r) => s + r.score, 0) / matching.length;
      // `score` is the BEST score at this (x,y) pair — a plateau of good bests is
      // the robustness signal. `avg` is kept so you can spot pairs that are only
      // good for one lucky setting of the remaining dimensions.
      cells.push({
        x: av, y: bv, score: top.score, avg, samples: matching.length,
        params: top.params,
        netPnlPct: top.metrics.netPnlPct, profitFactor: top.metrics.profitFactor,
        totalTrades: top.metrics.totalTrades, maxDrawdownPct: top.metrics.maxDrawdownPct,
      });
    }
  }
  return { xKey: a.key, xLabel: a.label, xValues: a.values, yKey: b.key, yLabel: b.label, yValues: b.values, cells };
}

function slimMetrics(m) {
  return {
    totalTrades: m.totalTrades, winRate: m.winRate, netPnlPct: m.netPnlPct,
    profitFactor: isFinite(m.profitFactor) ? m.profitFactor : null,
    expectancy: m.expectancy, expectancyR: m.expectancyR,
    maxDrawdownPct: m.maxDrawdownPct, sharpe: m.sharpe, sortino: m.sortino,
    calmar: m.calmar, cagr: m.cagr, exposurePct: m.exposurePct,
    maxLossStreak: m.maxLossStreak,
  };
}

function normaliseGrid(grid, opts) {
  if (grid && typeof grid === "object" && !Array.isArray(grid)) {
    return Object.entries(grid)
      .filter(([, v]) => Array.isArray(v) && v.length)
      .map(([key, values]) => ({ key, label: key, values }));
  }
  if (Array.isArray(grid) && grid.length) return grid;
  // Pine: sweep declared inputs unless told otherwise
  if (opts.pineScript && opts.pineGrid) {
    return Object.entries(opts.pineGrid).map(([key, values]) => ({ key: `pineInput:${key}`, label: key, values }));
  }
  // Pine strategies have no generic parameter grid — their inputs are whatever
  // the script declares — so we fall back to sweeping execution settings. That
  // fallback is deliberate ONLY for Pine; any other unknown strategy is a typo
  // and must fail loudly rather than return a plausible-looking sweep of the
  // wrong thing.
  if (opts.strategy === "pine" || opts.pineScript) return EXEC_GRID.slice(0, 2);
  const known = PARAM_GRIDS[opts.strategy];
  if (!known) {
    throw Object.assign(
      new Error(`Unknown strategy "${opts.strategy}" — expected one of: ${Object.keys(PARAM_GRIDS).join(", ")}, or "pine"`),
      { status: 400 });
  }
  return known;
}

// ── Walk-forward ────────────────────────────────────────────────────────────
// folds=4, isRatio=0.7 over 1000 bars gives 4 rolling blocks; in each we fit on
// the first 70% and trade the last 30% blind. Only the blind results count.
export async function runWalkForward(opts) {
  const {
    symbol = "^NSEI", interval = "1d", range = "2y",
    grid = null, objective = "robustPF", folds = 4, isRatio = 0.7,
    minTrades = 3, anchored = false,
  } = opts;
  const data = await loadCandles(symbol, interval, range);
  const candles = data.candles;
  const n = candles.length;
  const dims = normaliseGrid(grid, opts);
  if (!dims.length) throw Object.assign(new Error("No parameters to sweep — pick at least one value in at least one dimension"), { status: 400 });
  const { combos, truncated } = cartesian(dims, 1200);
  const objFn = (OBJECTIVES[objective] || OBJECTIVES.robustPF).fn;
  const evaluate = makeEvaluator(candles, opts, interval);

  const warm = 60;
  const usable = n - warm;
  const block = Math.floor(usable / folds);
  if (block < 40) throw new Error(`Not enough bars for ${folds} folds — use a longer range or fewer folds`);
  const osLen = Math.max(20, Math.floor(block * (1 - isRatio)));
  const isLen = block - osLen;

  const foldResults = [];
  const osTrades = [];
  for (let f = 0; f < folds; f++) {
    const isFrom = anchored ? warm : warm + f * block;
    const isTo = warm + f * block + isLen;
    const osTo = Math.min(n, isTo + osLen);
    if (osTo - isTo < 10) break;

    let best = null;
    for (const combo of combos) {
      const r = evaluate(combo, isFrom, isTo);
      if (!r || r.metrics.totalTrades < minTrades) continue;
      const score = objFn(r.metrics);
      if (!best || score > best.score) best = { combo, score, metrics: r.metrics };
    }
    if (!best) { foldResults.push({ fold: f + 1, error: "no combo met minTrades in-sample", isFrom, isTo, osFrom: isTo, osTo }); continue; }

    const os = evaluate(best.combo, isTo, osTo);
    if (os) osTrades.push(...os.trades);
    foldResults.push({
      fold: f + 1,
      isFrom, isTo, osFrom: isTo, osTo,
      isFromTime: candles[isFrom]?.time, isToTime: candles[isTo]?.time, osToTime: candles[osTo - 1]?.time,
      bestParams: best.combo,
      isScore: best.score, isMetrics: slimMetrics(best.metrics),
      osScore: os ? objFn(os.metrics) : null,
      osMetrics: os ? slimMetrics(os.metrics) : null,
    });
  }

  const good = foldResults.filter(f => f.osMetrics);
  const agg = aggregateOS(good, osTrades, opts.initialCapital ?? 1000000);
  const isAvg = avg(good.map(f => f.isMetrics.netPnlPct));
  const osAvg = avg(good.map(f => f.osMetrics.netPnlPct));

  return {
    meta: { symbol: data.symbol, interval, range, bars: n, folds, isRatio, anchored,
      objective, objectiveLabel: (OBJECTIVES[objective] || OBJECTIVES.robustPF).label,
      combos: combos.length, truncated, isBars: isLen, osBars: osLen, minTrades,
      dims: dims.map(d => ({ key: d.key, label: d.label, values: d.values })) },
    folds: foldResults,
    aggregate: agg,
    overfit: {
      isAvgReturnPct: isAvg, osAvgReturnPct: osAvg,
      degradationPct: isAvg !== 0 ? ((isAvg - osAvg) / Math.abs(isAvg)) * 100 : null,
      // Parameter stability: how often the winning combo changed between folds.
      paramStability: stability(good.map(f => f.bestParams)),
      verdict: verdict(isAvg, osAvg, agg),
    },
  };
}

const avg = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;

function stability(paramSets) {
  if (paramSets.length < 2) return null;
  const keys = Object.keys(paramSets[0] || {});
  const out = {};
  for (const k of keys) {
    const vals = paramSets.map(p => p[k]);
    const uniq = new Set(vals);
    out[k] = { values: vals, distinct: uniq.size, stable: uniq.size === 1 };
  }
  const stableCount = Object.values(out).filter(v => v.stable).length;
  return { perParam: out, stableFraction: keys.length ? stableCount / keys.length : null };
}

function aggregateOS(folds, trades, initialCapital) {
  const wins = trades.filter(t => t.pnl > 0);
  const gp = wins.reduce((s, t) => s + t.pnl, 0);
  const gl = Math.abs(trades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
  let eq = initialCapital, peak = eq, maxDD = 0;
  const curve = [];
  for (const t of trades.slice().sort((a, b) => a.exitTime - b.exitTime)) {
    eq += t.pnl;
    if (eq > peak) peak = eq;
    maxDD = Math.max(maxDD, (peak - eq) / peak * 100);
    curve.push({ time: t.exitTime, equity: eq });
  }
  return {
    osTrades: trades.length,
    osWinRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    osNetPnl: trades.reduce((s, t) => s + t.pnl, 0),
    osNetPnlPct: (trades.reduce((s, t) => s + t.pnl, 0) / initialCapital) * 100,
    osProfitFactor: gl > 0 ? gp / gl : (gp > 0 ? null : 0),
    osMaxDDPct: maxDD,
    osExpectancy: trades.length ? trades.reduce((s, t) => s + t.pnl, 0) / trades.length : 0,
    profitableFolds: folds.filter(f => f.osMetrics.netPnlPct > 0).length,
    totalFolds: folds.length,
    equityCurve: curve,
  };
}

function verdict(isAvg, osAvg, agg) {
  if (!agg.totalFolds) return "Not enough data to judge";
  const consistent = agg.profitableFolds / agg.totalFolds;
  if (osAvg <= 0) return "Fails out-of-sample — the parameters do not generalise. Do not trade this.";
  if (isAvg > 0 && osAvg < isAvg * 0.3) return "Heavy overfit: out-of-sample keeps under a third of in-sample. Treat the backtest as fiction.";
  if (consistent >= 0.75 && osAvg > 0) return "Holds up out-of-sample across most folds — the most encouraging result this test can give.";
  if (consistent >= 0.5) return "Mixed: profitable out-of-sample but inconsistent between folds. Needs more history.";
  return "Marginal — out-of-sample profit comes from a minority of folds.";
}
