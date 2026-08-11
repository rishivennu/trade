// Performance and risk statistics computed from an equity curve + trade list.

// Bars per year, used to annualise Sharpe/Sortino/CAGR.
export function barsPerYear(interval) {
  const perDay = { "1m": 375, "5m": 75, "15m": 25, "30m": 13, "1h": 7, "1d": 1, "1wk": 1 / 5 };
  const p = perDay[interval] ?? 1;
  return interval === "1wk" ? 52 : p * 250; // ~250 NSE trading days
}

const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const stdev = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
export const quantile = (sorted, q) => {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

export function drawdownSeries(equityCurve) {
  let peak = -Infinity, maxDD = 0, maxDDPct = 0, ddStart = null, longest = 0, curLen = 0;
  const dd = [];
  for (const p of equityCurve) {
    if (p.equity > peak) { peak = p.equity; curLen = 0; ddStart = null; }
    else { curLen++; if (ddStart == null) ddStart = p.time; }
    if (curLen > longest) longest = curLen;
    const d = peak - p.equity;
    dd.push({ time: p.time, dd: -d, ddPct: peak > 0 ? -(d / peak) * 100 : 0 });
    if (d > maxDD) { maxDD = d; maxDDPct = peak > 0 ? (d / peak) * 100 : 0; }
  }
  return { dd, maxDD, maxDDPct, longestDDBars: longest };
}

export function streaks(trades) {
  let win = 0, loss = 0, curW = 0, curL = 0;
  for (const t of trades) {
    if (t.pnl > 0) { curW++; curL = 0; } else if (t.pnl < 0) { curL++; curW = 0; }
    win = Math.max(win, curW); loss = Math.max(loss, curL);
  }
  return { maxWinStreak: win, maxLossStreak: loss };
}

export function monthlyReturns(equityCurve) {
  if (!equityCurve.length) return [];
  const byMonth = new Map();
  for (const p of equityCurve) {
    const d = new Date(p.time * 1000);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!byMonth.has(k)) byMonth.set(k, { key: k, first: p.equity, last: p.equity });
    else byMonth.get(k).last = p.equity;
  }
  return [...byMonth.values()].map(m => ({
    month: m.key, retPct: m.first > 0 ? ((m.last - m.first) / m.first) * 100 : 0,
  }));
}

// Bar-to-bar equity returns -> risk-adjusted ratios
export function riskAdjusted(equityCurve, interval, initialCapital, maxDDPct) {
  const rets = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const p = equityCurve[i - 1].equity, c = equityCurve[i].equity;
    if (p > 0) rets.push((c - p) / p);
  }
  const bpy = barsPerYear(interval);
  const mu = mean(rets), sd = stdev(rets);
  const downside = rets.filter(r => r < 0);
  const dsd = downside.length > 1 ? Math.sqrt(downside.reduce((s, r) => s + r * r, 0) / downside.length) : 0;

  const first = equityCurve[0]?.equity ?? initialCapital;
  const last = equityCurve[equityCurve.length - 1]?.equity ?? initialCapital;
  const years = equityCurve.length / bpy;
  const cagr = years > 0 && first > 0 ? (Math.pow(last / first, 1 / years) - 1) * 100 : 0;

  return {
    sharpe: sd > 0 ? (mu / sd) * Math.sqrt(bpy) : 0,
    sortino: dsd > 0 ? (mu / dsd) * Math.sqrt(bpy) : 0,
    calmar: maxDDPct > 0 ? cagr / maxDDPct : 0,
    cagr, annualVolPct: sd * Math.sqrt(bpy) * 100, years,
  };
}

// MAE = worst excursion against you while in the trade (in R units).
// MFE = best excursion in your favour. Together they tell you where the
// optimal stop and target actually are, without guessing.
export function excursionStats(trades) {
  const maeR = trades.map(t => t.maeR).filter(x => x != null);
  const mfeR = trades.map(t => t.mfeR).filter(x => x != null);
  const rs = trades.map(t => t.rMultiple).filter(x => x != null).sort((a, b) => a - b);
  const winMfe = trades.filter(t => t.pnl > 0).map(t => t.mfeR).filter(x => x != null);
  const lossMae = trades.filter(t => t.pnl <= 0).map(t => t.maeR).filter(x => x != null);
  const sortedWinMae = trades.filter(t => t.pnl > 0).map(t => t.maeR).filter(x => x != null).sort((a, b) => a - b);
  return {
    avgMaeR: mean(maeR), avgMfeR: mean(mfeR),
    avgWinMfeR: mean(winMfe), avgLossMaeR: mean(lossMae),
    // A stop just beyond the 90th-percentile heat taken by WINNING trades keeps
    // most winners alive; a target near median winner MFE is realistically hit.
    suggestedStopR: quantile(sortedWinMae, 0.9),
    suggestedTargetR: quantile(winMfe.slice().sort((a, b) => a - b), 0.5),
    count: trades.length,
    rStats: rs.length ? {
      min: rs[0], p25: quantile(rs, 0.25), median: quantile(rs, 0.5),
      p75: quantile(rs, 0.75), max: rs[rs.length - 1], avg: mean(rs),
    } : null,
    // Fixed-edge histogram of R outcomes so the shape of the P&L distribution is
    // visible, not just its quantiles. Tails are clamped into the end buckets.
    rDistribution: rs.length ? rHistogram(rs) : [],
  };
}

const R_EDGES = [-3, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 3];
function rHistogram(sortedRs) {
  const bins = [];
  for (let k = 0; k <= R_EDGES.length; k++) {
    const lo = k === 0 ? -Infinity : R_EDGES[k - 1];
    const hi = k === R_EDGES.length ? Infinity : R_EDGES[k];
    const label = k === 0 ? `<${R_EDGES[0]}` : k === R_EDGES.length ? `>${R_EDGES[R_EDGES.length - 1]}`
      : `${lo} to ${hi}`;
    const shortLabel = k === 0 ? `<${R_EDGES[0]}` : k === R_EDGES.length ? `${R_EDGES[R_EDGES.length - 1]}+` : `${hi}`;
    const mid = k === 0 ? R_EDGES[0] - 0.5 : k === R_EDGES.length ? R_EDGES[R_EDGES.length - 1] + 0.5 : (lo + hi) / 2;
    bins.push({ label, shortLabel, lo, hi, mid, count: 0 });
  }
  for (const r of sortedRs) {
    let k = R_EDGES.findIndex(e => r < e);
    if (k < 0) k = R_EDGES.length;
    bins[k].count++;
  }
  return bins;
}

// Split trade performance by market regime at entry. Most strategies only work
// in one regime, and that is usually invisible in the aggregate numbers.
export function regimeSplit(trades, ctx) {
  const bucket = (rows) => {
    const n = rows.length, w = rows.filter(t => t.pnl > 0).length;
    const gp = rows.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
    const gl = Math.abs(rows.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
    return {
      trades: n, winRate: n ? (w / n) * 100 : 0,
      netPnl: rows.reduce((s, t) => s + t.pnl, 0),
      expectancy: n ? rows.reduce((s, t) => s + t.pnl, 0) / n : 0,
      expectancyR: n ? rows.reduce((s, t) => s + (t.rMultiple || 0), 0) / n : 0,
      profitFactor: gl > 0 ? gp / gl : (gp > 0 ? Infinity : 0),
    };
  };
  const group = (labelFn) => {
    const m = new Map();
    for (const t of trades) {
      const k = labelFn(t);
      if (k == null) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(t);
    }
    return [...m.entries()].map(([k, rows]) => ({ bucket: k, ...bucket(rows) }));
  };

  const adxBand = (v) => v == null ? null : v < 15 ? "ADX <15 (no trend)" : v < 25 ? "ADX 15-25 (weak)" : v < 40 ? "ADX 25-40 (trending)" : "ADX 40+ (strong)";
  const volBand = (p) => p == null ? null : p < 33 ? "Low vol (bottom 3rd)" : p < 66 ? "Mid vol" : "High vol (top 3rd)";

  return {
    byAdx: group(t => adxBand(ctx.adx?.[t.entryIdx])).sort((a, b) => a.bucket.localeCompare(b.bucket)),
    byVol: group(t => volBand(ctx.atrPct?.[t.entryIdx])),
    bySide: group(t => t.side),
    byHour: ctx.intraday ? group(t => {
      const h = new Date(t.entryTime * 1000).getHours();
      return `${String(h).padStart(2, "0")}:00`;
    }).sort((a, b) => a.bucket.localeCompare(b.bucket)) : [],
    byWeekday: group(t => ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][new Date(t.entryTime * 1000).getDay()]),
    byExitReason: group(t => t.exitReason),
  };
}

// ATR as a percentile rank of its own history -> a regime proxy that needs no
// extra data feed (India VIX would be better for indices but needs a fetch).
export function atrPercentile(atr) {
  const out = new Array(atr.length).fill(null);
  const sorted = []; // kept ordered via binary-search insert: O(n log n) overall
  for (let i = 0; i < atr.length; i++) {
    const v = atr[i];
    if (v == null) continue;
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < v) lo = mid + 1; else hi = mid; }
    sorted.splice(lo, 0, v);
    out[i] = (lo / Math.max(1, sorted.length - 1)) * 100;
  }
  return out;
}
