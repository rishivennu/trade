// Pivot Point SuperTrend PRO — native JS port of the Pine v5 indicator
// (© LonesomeTheBlue, extended with EMA / ADX / volume / candle filters).
//
// Core idea: confirmed pivot highs/lows feed a slowly-updating "center" line
// (center := (center*2 + lastPivot) / 3). An ATR band around that center forms a
// SuperTrend trail; trend flips produce BUY / SELL signals.

const NA = null;

function rma(src, len) {
  const out = new Array(src.length).fill(NA);
  let sum = 0, prev = NA;
  for (let i = 0; i < src.length; i++) {
    const v = src[i] == null ? 0 : src[i];
    if (i < len) { sum += v; if (i === len - 1) { prev = sum / len; out[i] = prev; } continue; }
    prev = (prev * (len - 1) + v) / len;
    out[i] = prev;
  }
  return out;
}

function emaArr(src, len) {
  const out = new Array(src.length).fill(NA);
  const k = 2 / (len + 1);
  let prev = NA, sum = 0;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (i < len) { sum += v; if (i === len - 1) { prev = sum / len; out[i] = prev; } continue; }
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function smaArr(src, len) {
  const out = new Array(src.length).fill(NA);
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    sum += src[i];
    if (i >= len) sum -= src[i - len];
    if (i >= len - 1) out[i] = sum / len;
  }
  return out;
}

function trueRange(candles) {
  const tr = new Array(candles.length).fill(0);
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (i === 0) { tr[i] = c.high - c.low; continue; }
    const pc = candles[i - 1].close;
    tr[i] = Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  }
  return tr;
}

// Wilder DMI/ADX — mirrors Pine's ta.dmi(diLen, adxSmoothing)
function dmi(candles, diLen, adxSmooth) {
  const n = candles.length;
  const tr = trueRange(candles), plusDM = new Array(n).fill(0), minusDM = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const dn = candles[i - 1].low - candles[i].low;
    plusDM[i] = up > dn && up > 0 ? up : 0;
    minusDM[i] = dn > up && dn > 0 ? dn : 0;
  }
  const trR = rma(tr, diLen), pR = rma(plusDM, diLen), mR = rma(minusDM, diLen);
  const plusDI = new Array(n).fill(NA), minusDI = new Array(n).fill(NA), dx = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (trR[i] == null || trR[i] === 0) continue;
    plusDI[i] = 100 * pR[i] / trR[i];
    minusDI[i] = 100 * mR[i] / trR[i];
    const s = plusDI[i] + minusDI[i];
    dx[i] = s === 0 ? 0 : 100 * Math.abs(plusDI[i] - minusDI[i]) / s;
  }
  return { plusDI, minusDI, adx: rma(dx, adxSmooth) };
}

// ta.pivothigh(high, left, right): confirmed `right` bars later; strict extreme.
function pivots(candles, prd) {
  const n = candles.length;
  const ph = new Array(n).fill(NA), pl = new Array(n).fill(NA);
  for (let i = 2 * prd; i < n; i++) {
    const c = i - prd;
    let isH = true, isL = true;
    for (let j = c - prd; j <= c + prd; j++) {
      if (j === c) continue;
      if (candles[j].high >= candles[c].high) isH = false;
      if (candles[j].low <= candles[c].low) isL = false;
    }
    if (isH) ph[i] = candles[c].high;
    if (isL) pl[i] = candles[c].low;
  }
  return { ph, pl };
}

export function ppSuperTrend(candles, opts = {}) {
  const {
    prd = 2, factor = 3, atrLen = 10,
    useEmaFilter = false, emaLen = 200,
    useAdxFilter = false, adxLen = 14, adxSmooth = 14, adxMin = 20,
    useVolumeFilter = false, volLen = 20,
    useCandleConfirm = false,
    rr1 = 1, rr2 = 2, rr3 = 3,
  } = opts;

  const n = candles.length;
  const closes = candles.map(c => c.close);
  const atr = rma(trueRange(candles), Math.max(1, +atrLen));
  const emaS = emaArr(closes, Math.max(1, +emaLen));
  const { adx } = dmi(candles, Math.max(1, +adxLen), Math.max(1, +adxSmooth));
  const volSma = smaArr(candles.map(c => c.volume || 0), Math.max(1, +volLen));
  const { ph, pl } = pivots(candles, Math.max(1, +prd));

  const center = new Array(n).fill(NA), trail = new Array(n).fill(NA);
  const trendArr = new Array(n).fill(NA), signals = new Array(n).fill("NEUTRAL");
  const support = new Array(n).fill(NA), resistance = new Array(n).fill(NA);

  let ctr = NA, tUp = NA, tDown = NA, trend = 1, sup = NA, res = NA;

  for (let i = 0; i < n; i++) {
    const lastPP = ph[i] != null ? ph[i] : (pl[i] != null ? pl[i] : NA);
    if (lastPP != null) ctr = ctr == null ? lastPP : (ctr * 2 + lastPP) / 3;

    if (pl[i] != null) sup = pl[i];
    if (ph[i] != null) res = ph[i];
    support[i] = sup; resistance[i] = res;
    center[i] = ctr;

    if (ctr == null || atr[i] == null) { trendArr[i] = trend; continue; }

    const upBand = ctr - factor * atr[i];
    const dnBand = ctr + factor * atr[i];
    const prevUp = tUp, prevDown = tDown;
    const prevClose = i > 0 ? closes[i - 1] : NA;

    tUp = prevUp == null ? upBand : (prevClose != null && prevClose > prevUp ? Math.max(upBand, prevUp) : upBand);
    tDown = prevDown == null ? dnBand : (prevClose != null && prevClose < prevDown ? Math.min(dnBand, prevDown) : dnBand);

    const refDown = prevDown == null ? dnBand : prevDown;
    const refUp = prevUp == null ? upBand : prevUp;
    const prevTrend = trend;
    trend = closes[i] > refDown ? 1 : closes[i] < refUp ? -1 : prevTrend;

    trendArr[i] = trend;
    trail[i] = trend === 1 ? tUp : tDown;

    const flipUp = trend === 1 && prevTrend === -1;
    const flipDn = trend === -1 && prevTrend === 1;
    if (!flipUp && !flipDn) continue;

    // Optional confirmation filters (all default off, matching the Pine defaults)
    const emaOk = !useEmaFilter || (emaS[i] != null && (flipUp ? closes[i] > emaS[i] : closes[i] < emaS[i]));
    const adxOk = !useAdxFilter || (adx[i] != null && adx[i] >= adxMin);
    const volOk = !useVolumeFilter || (volSma[i] != null && (candles[i].volume || 0) > volSma[i]);
    const candleOk = !useCandleConfirm || (i > 0 && (flipUp
      ? closes[i] > candles[i].open && closes[i] > candles[i - 1].high
      : closes[i] < candles[i].open && closes[i] < candles[i - 1].low));

    if (emaOk && adxOk && volOk && candleOk) signals[i] = flipUp ? "BUY" : "SELL";
  }

  // Risk levels off the latest signal: stop = trail, targets = R multiples
  let levels = null;
  for (let i = n - 1; i >= 0; i--) {
    if (signals[i] === "NEUTRAL") continue;
    const entry = closes[i], stop = trail[i];
    if (stop == null) break;
    const risk = Math.abs(entry - stop), dir = signals[i] === "BUY" ? 1 : -1;
    levels = { side: signals[i], barIdx: i, entry, stop, risk,
      tp1: entry + dir * risk * rr1, tp2: entry + dir * risk * rr2, tp3: entry + dir * risk * rr3 };
    break;
  }

  return { trend: trendArr, trail, center, support, resistance, ph, pl, atr, ema: emaS, adx, volSma, signals, levels };
}

// Latest-bar verdict for the Chart tab (same shape as generateSignal()).
export function ppSuperTrendSignal(candles, opts = {}) {
  const n = candles.length;
  if (n < 30) return { signal: "NEUTRAL", reason: "Insufficient data", indicators: {} };
  const r = ppSuperTrend(candles, opts);
  const last = n - 1;
  const trend = r.trend[last], trail = r.trail[last];
  const price = candles[last].close;

  let signal = r.signals[last], kind = "signal";
  let reason;
  if (signal !== "NEUTRAL") {
    reason = `Pivot SuperTrend flipped ${signal === "BUY" ? "bullish" : "bearish"} — trail ${trail?.toFixed(2)}`;
  } else {
    // No flip this bar: report trend bias, and flag "pre" when price hugs the trail
    const dist = trail == null ? null : Math.abs(price - trail);
    const near = dist != null && r.atr[last] != null && dist < r.atr[last] * 0.5;
    reason = trend === 1
      ? `Uptrend — trail support ${trail?.toFixed(2)}${near ? " (price testing trail)" : ""}`
      : `Downtrend — trail resistance ${trail?.toFixed(2)}${near ? " (price testing trail)" : ""}`;
    if (near) kind = "pre";
  }

  return {
    signal, reason, kind,
    indicators: { price, trend, trailingSL: trail, center: r.center[last],
      support: r.support[last], resistance: r.resistance[last],
      atr: r.atr[last], adx: r.adx[last], ema: r.ema[last] },
    levels: r.levels,
    scores: { buy: trend === 1 ? 3 : 0, sell: trend === -1 ? 3 : 0 },
    series: { trail: r.trail, center: r.center, trend: r.trend },
  };
}
