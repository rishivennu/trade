// Robustness tests. A backtest is one sample from a distribution; these answer
// "is this edge real, or 20 lucky trades in a row?"

// Deterministic PRNG so a given run is reproducible.
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const pct = (sorted, q) => {
  if (!sorted.length) return null;
  const p = (sorted.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (p - lo);
};

// One consistent 5-point summary so every distribution renders the same way.
function dist5(sorted) {
  return {
    p5: pct(sorted, .05), p25: pct(sorted, .25), median: pct(sorted, .5),
    p75: pct(sorted, .75), p95: pct(sorted, .95), mean: mean(sorted),
  };
}

// ── Monte Carlo: reshuffle the ORDER of the realised trades ─────────────────
// Same trades, different sequence. Reveals how much of your drawdown was luck
// of ordering, and gives a confidence band you should expect to live inside.
export function monteCarlo(trades, { initialCapital = 1000000, runs = 1000, seed = 12345 } = {}) {
  const pnls = trades.map(t => t.pnl);
  if (pnls.length < 5) return { error: "Need at least 5 trades for Monte Carlo" };
  const rnd = mulberry(seed);
  const finals = [], dds = [], ruinCount = [];

  for (let r = 0; r < runs; r++) {
    const a = pnls.slice();
    for (let i = a.length - 1; i > 0; i--) {        // Fisher-Yates
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    let eq = initialCapital, peak = eq, maxDD = 0, ruined = false;
    for (const p of a) {
      eq += p;
      if (eq > peak) peak = eq;
      const dd = (peak - eq) / peak * 100;
      if (dd > maxDD) maxDD = dd;
      if (eq <= initialCapital * 0.5) ruined = true;
    }
    finals.push((eq - initialCapital) / initialCapital * 100);
    dds.push(maxDD);
    ruinCount.push(ruined ? 1 : 0);
  }
  finals.sort((a, b) => a - b); dds.sort((a, b) => a - b);
  return {
    runs, trades: pnls.length,
    returnPct: dist5(finals),
    maxDDPct: { ...dist5(dds), worst: dds[dds.length - 1] },
    probProfitPct: finals.filter(x => x > 0).length / runs * 100,
    riskOfRuin50Pct: mean(ruinCount) * 100,
  };
}

// ── Permutation test against random entries ─────────────────────────────────
// Keeps your trade COUNT, side mix and holding periods, but places entries at
// random bars. If your real result sits inside the random cloud, the timing
// carries no information — the "edge" was direction drift, not the signal.
export function permutationTest(candles, trades, { runs = 300, seed = 999, initialCapital = 1000000, startIdx = 0 } = {}) {
  if (trades.length < 5) return { error: "Need at least 5 trades for a permutation test" };
  const rnd = mulberry(seed);
  const n = candles.length;
  const specs = trades.map(t => ({ side: t.side, bars: Math.max(1, t.bars), qty: t.qty }));
  const actual = trades.reduce((s, t) => s + t.pnl, 0) / initialCapital * 100;
  const results = [];

  for (let r = 0; r < runs; r++) {
    let total = 0;
    for (const sp of specs) {
      const lo = startIdx, hi = n - sp.bars - 1;
      if (hi <= lo) continue;
      const i = lo + Math.floor(rnd() * (hi - lo));
      const inPx = candles[i].close, outPx = candles[i + sp.bars].close;
      total += (sp.side === "BUY" ? outPx - inPx : inPx - outPx) * sp.qty;
    }
    results.push(total / initialCapital * 100);
  }
  results.sort((a, b) => a - b);
  const better = results.filter(x => x >= actual).length;
  return {
    runs, actualReturnPct: actual,
    randomReturnPct: dist5(results),
    // Fraction of random-entry runs that matched or beat the strategy.
    pValue: better / runs,
    verdict: better / runs < 0.05 ? "Signal timing adds real edge (p < 0.05)"
      : better / runs < 0.20 ? "Weak evidence of edge — more data needed"
      : "Indistinguishable from random entries — the edge is not in the timing",
  };
}

// Bootstrap confidence interval on expectancy per trade.
export function bootstrapExpectancy(trades, { runs = 2000, seed = 777 } = {}) {
  if (trades.length < 5) return { error: "Need at least 5 trades" };
  const pnls = trades.map(t => t.pnl), rnd = mulberry(seed);
  const means = [];
  for (let r = 0; r < runs; r++) {
    let s = 0;
    for (let k = 0; k < pnls.length; k++) s += pnls[Math.floor(rnd() * pnls.length)];
    means.push(s / pnls.length);
  }
  means.sort((a, b) => a - b);
  return {
    runs, pointEstimate: mean(pnls),
    ci90: [pct(means, .05), pct(means, .95)],
    ci95: [pct(means, .025), pct(means, .975)],
    probPositivePct: means.filter(x => x > 0).length / runs * 100,
  };
}
