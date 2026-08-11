// Technical indicator calculations — pure functions on OHLCV arrays

export function sma(closes, period) {
  const result = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    const slice = closes.slice(i - period + 1, i + 1);
    result.push(slice.reduce((a, b) => a + b, 0) / period);
  }
  return result;
}

export function ema(closes, period) {
  const k = 2 / (period + 1);
  const result = [closes[0]];
  for (let i = 1; i < closes.length; i++) {
    result.push(closes[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

export function rsi(closes, period = 14) {
  const result = Array(closes.length).fill(null);
  if (closes.length <= period) return result;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) avgGain += diff; else avgLoss -= diff;
  }
  avgGain /= period; avgLoss /= period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

export function macd(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine = emaFast.map((f, i) => f - emaSlow[i]);
  const signalLine = ema(macdLine, signal);
  const histogram = macdLine.map((m, i) => m - signalLine[i]);
  return { macdLine, signalLine, histogram };
}

export function bollingerBands(closes, period = 20, mult = 2) {
  const mid = sma(closes, period);
  const upper = [], lower = [];
  for (let i = 0; i < closes.length; i++) {
    if (mid[i] === null) { upper.push(null); lower.push(null); continue; }
    const slice = closes.slice(i - period + 1, i + 1);
    const std = Math.sqrt(slice.reduce((s, v) => s + (v - mid[i]) ** 2, 0) / period);
    upper.push(mid[i] + mult * std);
    lower.push(mid[i] - mult * std);
  }
  return { upper, mid, lower };
}

export function vwap(candles) {
  let cumVol = 0, cumTP = 0;
  return candles.map(c => {
    const tp = (c.high + c.low + c.close) / 3;
    cumVol += c.volume; cumTP += tp * c.volume;
    return cumVol > 0 ? cumTP / cumVol : tp;
  });
}

// Signal generation based on strategy config
export function generateSignal(closes, config = {}) {
  const {
    emaFastPeriod = 9, emaSlowPeriod = 21,
    rsiPeriod = 14, rsiOverbought = 70, rsiOversold = 30,
    strategy = "combined"
  } = config;

  const n = closes.length;
  if (n < 30) return { signal: "NEUTRAL", reason: "Insufficient data", indicators: {} };

  const emaFast = ema(closes, emaFastPeriod);
  const emaSlow = ema(closes, emaSlowPeriod);
  const rsiValues = rsi(closes, rsiPeriod);
  const { macdLine, signalLine, histogram } = macd(closes);

  const last = n - 1;
  const prev = n - 2;
  const indicators = {
    emaFast: emaFast[last], emaSlow: emaSlow[last],
    rsi: rsiValues[last],
    macd: macdLine[last], macdSignal: signalLine[last], macdHist: histogram[last],
    price: closes[last],
  };

  let buyScore = 0, sellScore = 0;

  // EMA cross
  if (emaFast[last] > emaSlow[last] && emaFast[prev] <= emaSlow[prev]) buyScore += 2;
  else if (emaFast[last] > emaSlow[last]) buyScore += 1;
  if (emaFast[last] < emaSlow[last] && emaFast[prev] >= emaSlow[prev]) sellScore += 2;
  else if (emaFast[last] < emaSlow[last]) sellScore += 1;

  // RSI
  if (rsiValues[last] !== null) {
    if (rsiValues[last] < rsiOversold) buyScore += 2;
    else if (rsiValues[last] < 45) buyScore += 1;
    if (rsiValues[last] > rsiOverbought) sellScore += 2;
    else if (rsiValues[last] > 55) sellScore += 1;
  }

  // MACD
  if (histogram[last] > 0 && histogram[prev] <= 0) buyScore += 2;
  else if (histogram[last] > 0) buyScore += 1;
  if (histogram[last] < 0 && histogram[prev] >= 0) sellScore += 2;
  else if (histogram[last] < 0) sellScore += 1;

  let signal, reason;
  if (strategy === "ema_cross") {
    signal = emaFast[last] > emaSlow[last] ? "BUY" : emaFast[last] < emaSlow[last] ? "SELL" : "NEUTRAL";
    reason = `EMA${emaFastPeriod} ${signal === "BUY" ? "above" : "below"} EMA${emaSlowPeriod}`;
  } else if (strategy === "rsi_reversal") {
    signal = rsiValues[last] < rsiOversold ? "BUY" : rsiValues[last] > rsiOverbought ? "SELL" : "NEUTRAL";
    reason = `RSI at ${rsiValues[last]?.toFixed(1)}`;
  } else if (strategy === "macd") {
    signal = histogram[last] > 0 && histogram[prev] <= 0 ? "BUY" : histogram[last] < 0 && histogram[prev] >= 0 ? "SELL" : "NEUTRAL";
    reason = `MACD histogram ${histogram[last] > 0 ? "positive" : "negative"}`;
  } else {
    // Combined — need 3+ score to trigger
    if (buyScore >= 3 && buyScore > sellScore) { signal = "BUY"; reason = `Confluence score BUY:${buyScore} SELL:${sellScore}`; }
    else if (sellScore >= 3 && sellScore > buyScore) { signal = "SELL"; reason = `Confluence score BUY:${buyScore} SELL:${sellScore}`; }
    else { signal = "NEUTRAL"; reason = `No clear edge (BUY:${buyScore} SELL:${sellScore})`; }
  }

  return { signal, reason, indicators, scores: { buy: buyScore, sell: sellScore } };
}

// Custom formula evaluation (vars: close, emaFast, emaSlow, rsi, macd, macdSignal, macdHist)
export function evalCustomFormula(formula, closes) {
  const n = closes.length;
  const emaF = ema(closes, 9), emaS = ema(closes, 21);
  const rsiV = rsi(closes, 14);
  const { macdLine: ml, signalLine: sl, histogram: h } = macd(closes);
  const vars = {
    close: closes[n-1], emaFast: emaF[n-1], emaSlow: emaS[n-1],
    rsi: rsiV[n-1], macd: ml[n-1], macdSignal: sl[n-1], macdHist: h[n-1],
  };
  try {
    const fn = new Function(...Object.keys(vars), `"use strict"; return (${formula});`);
    const result = fn(...Object.values(vars));
    if (["BUY","SELL","NEUTRAL"].includes(result)) return { signal: result, reason: "Custom formula" };
    return { signal: result ? "BUY" : "SELL", reason: "Custom formula (boolean)" };
  } catch (e) {
    return { signal: "NEUTRAL", reason: `Formula error: ${e.message}` };
  }
}

// ── Per-bar custom formula compiler (used by the backtester) ─────────────────
// The formula is a JS expression evaluated once per bar. It may return the
// string "BUY" / "SELL" / "NEUTRAL", or a boolean (true → BUY, false → NEUTRAL).
// Every variable is the value AT THAT BAR; `prev*` are the previous bar's values
// so crossovers are expressible, e.g.:
//   emaFast > emaSlow && prevEmaFast <= prevEmaSlow ? "BUY" : "NEUTRAL"
export const FORMULA_VARS = [
  "i", "open", "high", "low", "close", "volume",
  "emaFast", "emaSlow", "rsi", "macd", "macdSignal", "macdHist",
  "bbUpper", "bbMid", "bbLower", "vwap", "sma20", "sma50", "atr",
  "prevClose", "prevOpen", "prevHigh", "prevLow", "prevVolume",
  "prevEmaFast", "prevEmaSlow", "prevRsi", "prevMacdHist", "prevVwap",
];

function atrSeries(candles, period = 14) {
  const n = candles.length, out = new Array(n).fill(null);
  let prev = null, sum = 0;
  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const tr = i === 0 ? c.high - c.low
      : Math.max(c.high - c.low, Math.abs(c.high - candles[i-1].close), Math.abs(c.low - candles[i-1].close));
    sum += tr;
    if (i === period - 1) { prev = sum / period; out[i] = prev; }
    else if (i >= period) { prev = (prev * (period - 1) + tr) / period; out[i] = prev; }
  }
  return out;
}

export function compileCustomFormula(formula, candles, config = {}) {
  if (!formula || !String(formula).trim()) throw new Error("Custom Formula strategy needs a formula");
  const { emaFastPeriod = 9, emaSlowPeriod = 21, rsiPeriod = 14 } = config;
  const closes = candles.map(c => c.close);

  const emaF = ema(closes, +emaFastPeriod), emaS = ema(closes, +emaSlowPeriod);
  const rsiV = rsi(closes, +rsiPeriod);
  const md = macd(closes);
  const bb = bollingerBands(closes);
  const vw = vwap(candles);
  const s20 = sma(closes, 20), s50 = sma(closes, 50);
  const at = atrSeries(candles, 14);

  let fn;
  try { fn = new Function(...FORMULA_VARS, `"use strict"; return (${formula});`); }
  catch (e) { throw new Error(`Formula syntax error: ${e.message}`); }

  const g = (arr, i) => (i >= 0 && arr[i] != null ? arr[i] : null);
  let errored = null;

  function at_(i) {
    const c = candles[i], p = i > 0 ? candles[i - 1] : c;
    const args = [
      i, c.open, c.high, c.low, c.close, c.volume ?? 0,
      g(emaF, i), g(emaS, i), g(rsiV, i), g(md.macdLine, i), g(md.signalLine, i), g(md.histogram, i),
      g(bb.upper, i), g(bb.mid, i), g(bb.lower, i), g(vw, i), g(s20, i), g(s50, i), g(at, i),
      p.close, p.open, p.high, p.low, p.volume ?? 0,
      g(emaF, i - 1), g(emaS, i - 1), g(rsiV, i - 1), g(md.histogram, i - 1), g(vw, i - 1),
    ];
    let r;
    try { r = fn(...args); }
    catch (e) { if (!errored) errored = e.message; return "NEUTRAL"; }
    if (r === "BUY" || r === "SELL" || r === "NEUTRAL") return r;
    if (r === true) return "BUY";
    if (r === false || r == null) return "NEUTRAL";
    return "NEUTRAL";
  }

  return { at: at_, vars: FORMULA_VARS, get error() { return errored; } };
}
