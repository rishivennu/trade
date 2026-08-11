// Historical backtesting engine.
//
// Split into three reusable stages so the optimizer / portfolio runner can drive
// them without refetching data:
//   loadCandles()  -> cached OHLCV
//   buildSignals() -> per-bar BUY / SELL / FLAT / NEUTRAL
//   simulate()     -> fills, charges, sizing, partial exits, trades, equity
import { fetchCandles } from "./data.js";
import { ema, rsi, macd, compileCustomFormula } from "./indicators.js";
import { compilePine } from "./pine.js";
import { ppSuperTrend } from "./ppst.js";
import { CHARGE_PRESETS, legCost, applySlippage, sizePosition } from "./exec.js";
import {
  drawdownSeries, streaks, monthlyReturns, riskAdjusted,
  excursionStats, regimeSplit, atrPercentile,
} from "./metrics.js";

export function computeATR(candles, period = 14) {
  const tr = [], atr = new Array(candles.length).fill(null);
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) { tr.push(candles[i].high - candles[i].low); continue; }
    const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += tr[i];
    if (i === period - 1) atr[i] = sum / period;
    else if (i >= period) atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }
  return atr;
}

// Wilder ADX, used only as a regime label for the analytics split.
function adxSeries(candles, len = 14) {
  const n = candles.length;
  const tr = new Array(n).fill(0), pdm = new Array(n).fill(0), mdm = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    const up = h - candles[i - 1].high, dn = candles[i - 1].low - l;
    pdm[i] = up > dn && up > 0 ? up : 0;
    mdm[i] = dn > up && dn > 0 ? dn : 0;
  }
  const rma = (src) => {
    const o = new Array(n).fill(null); let p = null, s = 0;
    for (let i = 0; i < n; i++) {
      s += src[i];
      if (i === len - 1) { p = s / len; o[i] = p; }
      else if (i >= len) { p = (p * (len - 1) + src[i]) / len; o[i] = p; }
    }
    return o;
  };
  const t = rma(tr), pp = rma(pdm), mm = rma(mdm);
  const dx = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (!t[i]) continue;
    const pdi = 100 * pp[i] / t[i], mdi = 100 * mm[i] / t[i], s = pdi + mdi;
    dx[i] = s ? 100 * Math.abs(pdi - mdi) / s : 0;
  }
  return rma(dx);
}

// ── Candle cache: an optimizer sweep must not hammer the data source ────────
const candleCache = new Map();
const CACHE_TTL = 90_000;
export async function loadCandles(symbol, interval, range) {
  const key = `${symbol}|${interval}|${range}`;
  const hit = candleCache.get(key);
  if (hit && Date.now() - hit.t < CACHE_TTL) return hit.data;
  const data = await fetchCandles(symbol, interval, range);
  candleCache.set(key, { t: Date.now(), data });
  return data;
}
export function clearCandleCache() { candleCache.clear(); }

// ── Stage 2: per-bar signals ────────────────────────────────────────────────
export function buildSignals(candles, opts = {}) {
  const {
    strategy = "combined",
    emaFastPeriod = 9, emaSlowPeriod = 21, rsiPeriod = 14,
    rsiOverbought = 70, rsiOversold = 30,
    pineScript = null, pineInputs = {}, formula = null,
  } = opts;

  const closes = candles.map(c => c.close);
  const n = closes.length;
  const emaF = ema(closes, +emaFastPeriod);
  const emaS = ema(closes, +emaSlowPeriod);
  const rs = rsi(closes, +rsiPeriod);
  const md = macd(closes);
  const atr = computeATR(candles, 14);
  const warmup = Math.max(+emaSlowPeriod, +rsiPeriod, 26) + 1;

  const usePine = !!(pineScript && String(pineScript).trim());
  const custom = strategy === "custom" && !usePine
    ? compileCustomFormula(formula, candles, { emaFastPeriod, emaSlowPeriod, rsiPeriod })
    : null;

  const ppst = strategy === "pp_supertrend" && !usePine ? ppSuperTrend(candles, {
    prd: +(opts.ppPrd ?? 2), factor: +(opts.ppFactor ?? 3), atrLen: +(opts.ppAtrLen ?? 10),
    useEmaFilter: !!opts.ppUseEma, emaLen: +(opts.ppEmaLen ?? 200),
    useAdxFilter: !!opts.ppUseAdx, adxLen: +(opts.ppAdxLen ?? 14),
    adxSmooth: +(opts.ppAdxSmooth ?? 14), adxMin: +(opts.ppAdxMin ?? 20),
    useVolumeFilter: !!opts.ppUseVolume, volLen: +(opts.ppVolLen ?? 20),
    useCandleConfirm: !!opts.ppUseCandle,
  }) : null;

  const ppWarmup = 2 * (+(opts.ppPrd ?? 2)) + (+(opts.ppAtrLen ?? 10)) + 2;
  const startIdx = usePine ? 5
    : strategy === "pp_supertrend" ? ppWarmup
    : strategy === "custom" ? Math.max(warmup, 51)
    : warmup;

  const strat = strategy === "ict" ? "combined" : strategy;
  function sigAt(i) {
    if (strat === "pp_supertrend") return ppst.signals[i] || "NEUTRAL";
    if (strat === "custom") return custom.at(i);
    if (strat === "ema_cross") {
      if (emaF[i] == null || emaS[i] == null || emaF[i-1] == null || emaS[i-1] == null) return "NEUTRAL";
      const c = emaF[i] - emaS[i], p = emaF[i-1] - emaS[i-1];
      return p <= 0 && c > 0 ? "BUY" : p >= 0 && c < 0 ? "SELL" : "NEUTRAL";
    }
    if (strat === "rsi_reversal") {
      if (rs[i] == null || rs[i-1] == null) return "NEUTRAL";
      if (rs[i-1] < rsiOversold && rs[i] >= rsiOversold) return "BUY";
      if (rs[i-1] > rsiOverbought && rs[i] <= rsiOverbought) return "SELL";
      return "NEUTRAL";
    }
    if (strat === "macd") {
      const h = md.histogram;
      if (h[i] == null || h[i-1] == null) return "NEUTRAL";
      return h[i-1] <= 0 && h[i] > 0 ? "BUY" : h[i-1] >= 0 && h[i] < 0 ? "SELL" : "NEUTRAL";
    }
    if (emaF[i] == null || emaS[i] == null || rs[i] == null || md.histogram[i] == null) return "NEUTRAL";
    const up = emaF[i] > emaS[i], mom = md.histogram[i] > 0;
    if (up && mom && rs[i] < rsiOverbought) return "BUY";
    if (!up && !mom && rs[i] > rsiOversold) return "SELL";
    return "NEUTRAL";
  }

  const signals = new Array(n).fill("NEUTRAL");
  let pineMeta = null, pineInfo = null, pineExits = null;
  if (usePine) {
    const prog = compilePine(pineScript);
    const pr = prog.run(candles, pineInputs);
    pineMeta = prog.meta;
    pineInfo = { inputs: pr.inputs, hasStrategy: pr.hasStrategy, securityCalls: pr.securityCalls || [] };
    if (!pr.hasStrategy) throw new Error("Pine script has no strategy.entry / strategy.close calls — add them so the backtester knows when to trade.");
    for (let i = 0; i < n; i++) signals[i] = pr.signals[i];
    pineExits = pr.exitLevels || null;
  } else {
    for (let i = startIdx; i < n; i++) signals[i] = sigAt(i);
    if (custom?.error && !signals.some(s => s !== "NEUTRAL")) throw new Error(`Formula error: ${custom.error}`);
  }

  return {
    signals, startIdx, usePine, pineMeta, pineInfo, pineExits,
    customError: custom?.error || null, customVars: custom?.vars,
    emaF, emaS, rs, md, atr, ppst,
  };
}

// ── Stage 3: simulation ─────────────────────────────────────────────────────
// Fill conventions:
//   fillMode "nextOpen" (default) — a signal on bar i is filled at bar i+1's
//     OPEN. This is what TradingView does and it is the honest convention: you
//     cannot transact at the close that produced the signal.
//   fillMode "close" — legacy behaviour, fills at the signal bar's own close.
//     Systematically optimistic; kept only for comparison.
export function simulate(candles, signals, opts = {}, startIdx = 0, extras = {}) {
  const {
    initialCapital = 1000000, allowShort = true,
    fillMode = "nextOpen", slipBps = 0, feeBps = 0, chargeModel = "bps",
    slAtr = 0, tpAtr = 0, trailAtr = 0, maxBars = 0,
    sizing = "allin", riskPct = 1, notional = 0, units = 0, maxLeverage = 1,
    useTargets = false, tp1R = 1, tp2R = 2, tp3R = 3,
    tp1Pct = 40, tp2Pct = 30, tp3Pct = 30, beAfterTp1 = true,
    endIdx = null,     // simulate only up to this bar (walk-forward slicing)
  } = opts;

  const model = CHARGE_PRESETS[chargeModel] || CHARGE_PRESETS.bps;
  const atr = extras.atr || computeATR(candles, 14);
  const pineExits = extras.pineExits || null;
  const n = candles.length;
  const closes = candles.map(c => c.close);

  let realized = 0, pos = null, pending = null, barsInMarket = 0, rejected = 0, rejectReason = null;
  let pendingExit = null;   // strategy.exit() levels declared on a previous bar
  const trades = [], equityCurve = [];

  const cost = (turnover, isBuy) => legCost(turnover, isBuy, model, feeBps);

  function finalize(i) {
    const exits = pos.exits;
    const qty = exits.reduce((s, e) => s + e.qty, 0);
    const avgExit = qty ? exits.reduce((s, e) => s + e.price * e.qty, 0) / qty : pos.entry;
    const pnl = exits.reduce((s, e) => s + e.pnl, 0);
    const R = pos.risk > 0 ? pos.risk : null;
    const mae = pos.side === "BUY" ? pos.entry - pos.loWater : pos.hiWater - pos.entry;
    const mfe = pos.side === "BUY" ? pos.hiWater - pos.entry : pos.entry - pos.loWater;
    trades.push({
      side: pos.side, entry: pos.entry, exit: avgExit, qty: pos.qtyTotal,
      entryIdx: pos.entryIdx, exitIdx: i, entryTime: pos.entryTime, exitTime: candles[i].time,
      bars: i - pos.entryIdx, pnl, pnlPct: (pnl / (pos.entry * pos.qtyTotal)) * 100,
      exitReason: exits.length > 1 ? "scaled" : exits[0]?.reason || "exit",
      exits: exits.map(e => ({ price: e.price, qty: e.qty, idx: e.idx, reason: e.reason, pnl: e.pnl })),
      sl: pos.initialSl, riskPerUnit: pos.risk || null,
      rMultiple: R ? pnl / (R * pos.qtyTotal) : null,
      maeR: R ? Math.max(0, mae) / R : null,
      mfeR: R ? Math.max(0, mfe) / R : null,
      charges: pos.costEntry + exits.reduce((s, e) => s + e.cost, 0),
    });
    pos = null;
  }

  function closeQty(qty, rawPrice, i, reason) {
    const q = Math.min(qty, pos.qtyOpen);
    if (q <= 0) return;
    const price = applySlippage(rawPrice, pos.side, false, slipBps);
    const gross = pos.side === "BUY" ? (price - pos.entry) * q : (pos.entry - price) * q;
    const c = cost(price * q, pos.side === "SELL");
    const entryShare = pos.costEntry * (q / pos.qtyTotal);
    const net = gross - c - entryShare;
    realized += net;
    pos.exits.push({ price, qty: q, idx: i, reason, pnl: net, cost: c });
    pos.qtyOpen -= q;
    if (pos.qtyOpen <= 0) finalize(i);
  }

  function openPos(side, rawPrice, i) {
    const price = applySlippage(rawPrice, side, true, slipBps);
    const a = atr[i] ?? 0;
    const sl = slAtr > 0 && a ? (side === "BUY" ? price - slAtr * a : price + slAtr * a) : null;
    const equityNow = initialCapital + realized;
    const s = sizePosition({ mode: sizing, equity: equityNow, price, stop: sl, riskPct, notional, units, maxLeverage });
    if (!s.qty) { rejected++; rejectReason = rejectReason || s.reason; return; }
    // R unit: distance to stop, else one ATR so R-multiples remain meaningful
    const risk = sl != null ? Math.abs(price - sl) : (a || 0);
    const targets = [];
    if (useTargets && risk > 0) {
      const spec = [[tp1R, tp1Pct], [tp2R, tp2Pct], [tp3R, tp3Pct]];
      let assigned = 0;
      spec.forEach(([r, pct], k) => {
        if (!(r > 0) || !(pct > 0)) return;
        let q = k === spec.length - 1 ? s.qty - assigned : Math.floor(s.qty * pct / 100);
        if (q <= 0) return;
        assigned += q;
        targets.push({ r, price: side === "BUY" ? price + r * risk : price - r * risk, qty: q, hit: false });
      });
    } else if (tpAtr > 0 && a) {
      targets.push({ r: null, price: side === "BUY" ? price + tpAtr * a : price - tpAtr * a, qty: s.qty, hit: false });
    }
    pendingExit = null;   // a new position must not inherit the last trade's levels
    pos = {
      side, entry: price, qtyTotal: s.qty, qtyOpen: s.qty, entryIdx: i, entryTime: candles[i].time,
      sl, initialSl: sl, risk, targets, exits: [],
      hiWater: candles[i].high, loWater: candles[i].low,
      costEntry: cost(price * s.qty, side === "BUY"),
    };
  }

  // Apply Pine strategy.exit() levels. Always one bar late on purpose: the
  // declaration is only known at its own bar's close, so testing it against
  // that same bar's high/low would be look-ahead.
  function applyPineExit() {
    const e = pendingExit;
    if (!e || !pos) return;
    const long = pos.side === "BUY";
    if (e.stop != null) pos.sl = e.stop;
    else if (e.loss != null) pos.sl = long ? pos.entry - e.loss : pos.entry + e.loss;
    const lim = e.limit != null ? e.limit
      : e.profit != null ? (long ? pos.entry + e.profit : pos.entry - e.profit) : null;
    if (lim != null) pos.targets = [{ r: null, price: lim, qty: pos.qtyOpen, hit: false }];
    if (e.trail != null) {
      const t = long ? pos.hiWater - e.trail : pos.loWater + e.trail;
      pos.sl = pos.sl == null ? t : (long ? Math.max(pos.sl, t) : Math.min(pos.sl, t));
    }
  }

  function manage(i) {
    const c = candles[i];
    applyPineExit();
    pos.hiWater = Math.max(pos.hiWater, c.high);
    pos.loWater = Math.min(pos.loWater, c.low);

    // Stop first: when a bar contains both the stop and a target we assume the
    // worse outcome, because a single OHLC bar cannot tell us the true order.
    if (pos.sl != null) {
      if (pos.side === "BUY" ? c.low <= pos.sl : c.high >= pos.sl) {
        closeQty(pos.qtyOpen, pos.sl, i, pos.sl === pos.initialSl ? "SL" : "trail/BE");
        return;
      }
    }
    for (const t of pos.targets) {
      if (t.hit) continue;
      const hit = pos.side === "BUY" ? c.high >= t.price : c.low <= t.price;
      if (!hit) continue;
      t.hit = true;
      closeQty(t.qty, t.price, i, t.r ? `TP${pos.targets.indexOf(t) + 1}` : "TP");
      if (!pos) return;
      if (beAfterTp1 && pos.risk > 0) pos.sl = pos.entry;   // risk-free runner
    }
    if (trailAtr > 0 && atr[i]) {
      const t = pos.side === "BUY" ? c.close - trailAtr * atr[i] : c.close + trailAtr * atr[i];
      pos.sl = pos.sl == null ? t : (pos.side === "BUY" ? Math.max(pos.sl, t) : Math.min(pos.sl, t));
    }
    if (maxBars > 0 && i - pos.entryIdx >= maxBars) closeQty(pos.qtyOpen, c.close, i, "time");
  }

  function act(sig, rawPrice, i) {
    if (sig === "FLAT") { if (pos) closeQty(pos.qtyOpen, rawPrice, i, "exit"); return; }
    if (sig === "BUY") {
      if (pos && pos.side === "SELL") closeQty(pos.qtyOpen, rawPrice, i, "signal");
      if (!pos) openPos("BUY", rawPrice, i);
    } else if (sig === "SELL") {
      if (pos && pos.side === "BUY") closeQty(pos.qtyOpen, rawPrice, i, "signal");
      if (!pos && allowShort) openPos("SELL", rawPrice, i);
    }
  }

  const stop = endIdx == null ? n : Math.min(n, endIdx);
  for (let i = startIdx; i < stop; i++) {
    const c = candles[i];
    if (pending && fillMode === "nextOpen") { act(pending, c.open, i); pending = null; }
    if (pos) manage(i);
    if (pineExits && pineExits[i]) pendingExit = pineExits[i];
    const sig = signals[i];
    if (sig && sig !== "NEUTRAL") {
      if (fillMode === "close") act(sig, c.close, i);
      else pending = sig;              // executes at the next bar's open
    }
    if (pos) barsInMarket++;
    const unreal = pos ? (pos.side === "BUY" ? (closes[i] - pos.entry) : (pos.entry - closes[i])) * pos.qtyOpen : 0;
    equityCurve.push({ time: c.time, equity: initialCapital + realized + unreal });
  }
  if (pos) closeQty(pos.qtyOpen, closes[stop - 1], stop - 1, "eod");

  const bars = Math.max(1, stop - startIdx);
  return { trades, equityCurve, realized, exposurePct: (barsInMarket / bars) * 100, rejected, rejectReason };
}

// ── Stage 4: metrics assembly ───────────────────────────────────────────────
export function computeMetrics(sim, candles, startIdx, opts, extras) {
  const { trades, equityCurve, realized, exposurePct } = sim;
  const { initialCapital = 1000000, interval = "1d" } = opts;
  const n = candles.length;
  const closes = candles.map(c => c.close);

  const wins = trades.filter(t => t.pnl > 0), losses = trades.filter(t => t.pnl < 0);
  const grossP = wins.reduce((s, t) => s + t.pnl, 0);
  const grossL = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const avgWin = wins.length ? grossP / wins.length : 0;
  const avgLoss = losses.length ? grossL / losses.length : 0;
  const { dd, maxDD, maxDDPct, longestDDBars } = drawdownSeries(equityCurve);
  const ra = riskAdjusted(equityCurve, interval, initialCapital, maxDDPct);
  const buyHoldPct = ((closes[n - 1] - closes[startIdx]) / closes[startIdx]) * 100;
  const charges = trades.reduce((s, t) => s + (t.charges || 0), 0);

  return {
    metrics: {
      totalTrades: trades.length, wins: wins.length, losses: losses.length,
      winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
      netPnl: realized, netPnlPct: (realized / initialCapital) * 100,
      finalEquity: initialCapital + realized,
      profitFactor: grossL > 0 ? grossP / grossL : (grossP > 0 ? Infinity : 0),
      avgWin, avgLoss, plRatio: avgLoss > 0 ? avgWin / avgLoss : (avgWin > 0 ? Infinity : 0),
      expectancy: trades.length ? realized / trades.length : 0,
      expectancyR: trades.length ? trades.reduce((s, t) => s + (t.rMultiple || 0), 0) / trades.length : 0,
      maxDrawdown: maxDD, maxDrawdownPct: maxDDPct, longestDDBars,
      bestTrade: trades.length ? Math.max(...trades.map(t => t.pnl)) : 0,
      worstTrade: trades.length ? Math.min(...trades.map(t => t.pnl)) : 0,
      avgBars: trades.length ? trades.reduce((s, t) => s + t.bars, 0) / trades.length : 0,
      buyHoldPct, vsBuyHold: (realized / initialCapital) * 100 - buyHoldPct,
      sharpe: ra.sharpe, sortino: ra.sortino, calmar: ra.calmar, cagr: ra.cagr,
      annualVolPct: ra.annualVolPct, exposurePct, totalCharges: charges,
      ...streaks(trades),
    },
    drawdown: dd,
    monthly: monthlyReturns(equityCurve),
    excursion: excursionStats(trades),
    regime: regimeSplit(trades, {
      adx: extras.adxSeries, atrPct: extras.atrPct,
      intraday: ["1m", "5m", "15m", "30m", "1h"].includes(interval),
    }),
  };
}

// ── Orchestrator ────────────────────────────────────────────────────────────
export async function runBacktest(opts) {
  const { symbol = "^NSEI", interval = "1d", range = "1y", strategy = "combined" } = opts;
  const data = await loadCandles(symbol, interval, range);
  const candles = data.candles;
  if (candles.length < 30) throw new Error("Not enough historical data for this range/interval");

  const sig = buildSignals(candles, opts);
  const sim = simulate(candles, sig.signals, opts, sig.startIdx, { atr: sig.atr, pineExits: sig.pineExits });
  const extras = { adxSeries: adxSeries(candles, 14), atrPct: atrPercentile(sig.atr) };
  const out = computeMetrics(sim, candles, sig.startIdx, { ...opts, interval }, extras);
  const n = candles.length;

  const replay = opts.replay ? {
    startIdx: sig.startIdx,
    candles: candles.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0 })),
    signals: sig.signals,
    emaFast: sig.usePine || sig.ppst ? null : sig.emaF,
    emaSlow: sig.usePine || sig.ppst ? null : sig.emaS,
    trail: sig.ppst ? sig.ppst.trail : null,
    center: sig.ppst ? sig.ppst.center : null,
    equity: sim.equityCurve,
    drawdown: out.drawdown,
    trades: sim.trades.map(t => ({
      side: t.side, entry: t.entry, exit: t.exit, qty: t.qty, entryIdx: t.entryIdx, exitIdx: t.exitIdx,
      pnl: t.pnl, pnlPct: t.pnlPct, exitReason: t.exitReason, exits: t.exits,
      sl: t.sl, rMultiple: t.rMultiple, maeR: t.maeR, mfeR: t.mfeR,
    })),
  } : undefined;

  const note = sig.usePine
    ? (sig.pineMeta?.title ? `Pine: ${sig.pineMeta.title}` : "Pine Script strategy")
    : strategy === "ict" ? "ICT backtest uses combined trend+momentum proxy"
    : strategy === "pp_supertrend" ? "Pivot Point SuperTrend PRO (pivot center + ATR trail)"
    : strategy === "custom" ? `Custom formula: ${String(opts.formula).trim().slice(0, 120)}` : null;

  return {
    meta: {
      symbol: data.symbol, interval, range, bars: n,
      from: candles[sig.startIdx]?.time, to: candles[n - 1]?.time,
      strategy: sig.usePine ? "pine" : strategy, strategyNote: note,
      formulaError: sig.customError, formulaVars: sig.customVars, pine: sig.pineInfo,
      initialCapital: opts.initialCapital ?? 1000000,
      allowShort: opts.allowShort ?? true,
      fillMode: opts.fillMode ?? "nextOpen",
      slipBps: +(opts.slipBps ?? 0), feeBps: +(opts.feeBps ?? 0),
      chargeModel: opts.chargeModel ?? "bps",
      chargeLabel: (CHARGE_PRESETS[opts.chargeModel] || CHARGE_PRESETS.bps).label,
      sizing: opts.sizing ?? "allin", riskPct: +(opts.riskPct ?? 1),
      slAtr: +(opts.slAtr ?? 0), tpAtr: +(opts.tpAtr ?? 0), trailAtr: +(opts.trailAtr ?? 0),
      useTargets: !!opts.useTargets, maxBars: +(opts.maxBars ?? 0),
      rejectedEntries: sim.rejected, rejectReason: sim.rejectReason,
    },
    metrics: out.metrics,
    excursion: out.excursion,
    regime: out.regime,
    monthly: out.monthly,
    equityCurve: sim.equityCurve,
    trades: sim.trades.slice(-200).reverse(),
    allTrades: opts.wantAllTrades ? sim.trades : undefined,
    replay,
  };
}
