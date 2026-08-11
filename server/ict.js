// ICT Concepts engine — ported from the "ICT Ultimate + Sessions + Pre-Entry" Pine Script.
// Computes: ATR, market structure (swings, BoS, trend), order blocks (demand/supply),
// killzone sessions, pre-entry proximity signals, and 0-5 confluence scoring.

function atr(candles, period = 14) {
  const tr = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const pc = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  });
  const out = Array(candles.length).fill(null);
  let sum = 0;
  for (let i = 0; i < tr.length; i++) {
    sum += tr[i];
    if (i >= period) sum -= tr[i - period];
    if (i >= period - 1) out[i] = sum / Math.min(period, i + 1);
  }
  return out;
}

// Pivot swing detection: a swing high has `lb` lower highs on both sides
function findSwings(candles, lb = 5) {
  const highs = [], lows = [];
  for (let i = lb; i < candles.length - lb; i++) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= lb; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isHigh = false;
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) isLow = false;
    }
    if (isHigh) highs.push({ index: i, price: candles[i].high });
    if (isLow) lows.push({ index: i, price: candles[i].low });
  }
  return { highs, lows };
}

// Market structure: track last swing high/low, detect Break of Structure, derive trend
function marketStructure(candles, lb = 5) {
  const { highs, lows } = findSwings(candles, lb);
  const events = [];
  let lastHigh = null, lastLow = null, trend = "No Trend";
  let hi = 0, li = 0;

  for (let i = 0; i < candles.length; i++) {
    while (hi < highs.length && highs[hi].index === i) { lastHigh = highs[hi]; hi++; }
    while (li < lows.length && lows[li].index === i) { lastLow = lows[li]; li++; }

    const c = candles[i];
    // Bullish BoS: close breaks above last swing high
    if (lastHigh && c.close > lastHigh.price && (!candles[i-1] || candles[i-1].close <= lastHigh.price)) {
      events.push({ index: i, type: "Bull BoS", level: lastHigh.price });
      trend = "Up Trend";
      lastHigh = null;
    }
    // Bearish BoS: close breaks below last swing low
    if (lastLow && c.close < lastLow.price && (!candles[i-1] || candles[i-1].close >= lastLow.price)) {
      events.push({ index: i, type: "Bear BoS", level: lastLow.price });
      trend = "Down Trend";
      lastLow = null;
    }
  }
  return { events, trend, swings: { highs, lows } };
}

// Order blocks: last opposite-color candle before a BoS becomes the OB zone
function orderBlocks(candles, structure) {
  const demand = [], supply = [];
  for (const ev of structure.events) {
    if (ev.type === "Bull BoS") {
      // find last bearish (down) candle before break -> demand zone
      for (let k = ev.index - 1; k >= Math.max(0, ev.index - 15); k--) {
        if (candles[k].close < candles[k].open) {
          demand.push({ index: k, proximal: candles[k].high, distal: candles[k].low, breakIndex: ev.index, mitigated: false });
          break;
        }
      }
    } else if (ev.type === "Bear BoS") {
      for (let k = ev.index - 1; k >= Math.max(0, ev.index - 15); k--) {
        if (candles[k].close > candles[k].open) {
          supply.push({ index: k, proximal: candles[k].low, distal: candles[k].high, breakIndex: ev.index, mitigated: false });
          break;
        }
      }
    }
  }
  // Mark mitigation: a demand OB is mitigated once price later trades below its distal
  const lastClose = candles[candles.length - 1].close;
  for (const ob of demand) {
    for (let i = ob.breakIndex + 1; i < candles.length; i++) {
      if (candles[i].low < ob.distal) { ob.mitigated = true; break; }
    }
  }
  for (const ob of supply) {
    for (let i = ob.breakIndex + 1; i < candles.length; i++) {
      if (candles[i].high > ob.distal) { ob.mitigated = true; break; }
    }
  }
  // Active (unmitigated) zones nearest to price
  const activeDemand = demand.filter(o => !o.mitigated).sort((a,b) => b.index - a.index)[0] || null;
  const activeSupply = supply.filter(o => !o.mitigated).sort((a,b) => b.index - a.index)[0] || null;
  return { demand, supply, activeDemand, activeSupply };
}

// ICT killzones — times in IST (Asia/Kolkata) since focus is Indian markets.
// Also flags the NSE cash/F&O session. Returns which killzone the latest bar is in.
function killzone(tsSeconds) {
  const d = new Date(tsSeconds * 1000);
  // Convert to IST
  const ist = new Date(d.getTime() + (5.5 * 3600 - d.getTimezoneOffset() * -60 + d.getTimezoneOffset()*60) * 1000);
  const istHour = (d.getUTCHours() + 5) % 24;
  const istMin = (d.getUTCMinutes() + 30) % 60;
  const t = istHour * 60 + istMin + (d.getUTCMinutes() + 30 >= 60 ? 0 : 0);
  const mins = ((d.getUTCHours() * 60 + d.getUTCMinutes()) + 330) % 1440; // IST minutes since midnight
  // Killzone windows in IST
  const zones = [
    { name: "Asia KZ", start: 5*60+30, end: 9*60+30 },       // 05:30-09:30 IST
    { name: "London KZ", start: 12*60+30, end: 14*60+30 },   // 12:30-14:30 IST
    { name: "NY AM KZ", start: 18*60, end: 20*60+30 },       // 18:00-20:30 IST
    { name: "NY PM KZ", start: 19*60+30, end: 21*60+30 },    // 19:30-21:30 IST
  ];
  const nse = mins >= (9*60+15) && mins <= (15*60+30); // 09:15-15:30 IST
  const active = zones.find(z => mins >= z.start && mins <= z.end);
  return { active: active?.name || null, inKillzone: !!active, nseOpen: nse, istMinutes: mins };
}

export function analyzeICT(candles, opts = {}) {
  const { preEntryATR = 0.5, requireTrend = true, requireSession = false, swingLookback = 5 } = opts;
  if (candles.length < 40) return { error: "Insufficient bars for ICT analysis" };

  const atrSeries = atr(candles, 14);
  const structure = marketStructure(candles, swingLookback);
  const obs = orderBlocks(candles, structure);
  const last = candles.length - 1;
  const c = candles[last];
  const curAtr = atrSeries[last] || (c.high - c.low);
  const kz = killzone(c.time);

  // Proximity to active zones
  const dem = obs.activeDemand, sup = obs.activeSupply;
  const distToDemand = dem ? c.low - dem.proximal : null;
  const nearDemand = dem && distToDemand > 0 && distToDemand <= curAtr * preEntryATR;
  const distToSupply = sup ? sup.proximal - c.high : null;
  const nearSupply = sup && distToSupply > 0 && distToSupply <= curAtr * preEntryATR;

  // Zone taps (entry)
  const tappedDemand = dem && c.low <= dem.proximal && c.low >= dem.distal;
  const tappedSupply = sup && c.high >= sup.proximal && c.high <= sup.distal;

  const trend = structure.trend;
  const bodyUp = c.close > c.open;
  const lastBoS = structure.events[structure.events.length - 1]?.type || "None";

  // Confluence 0-5 (matching Pine logic)
  const confluenceLong = (trend === "Up Trend" ? 1 : 0) + (kz.inKillzone ? 1 : 0) +
    (nearDemand ? 1 : 0) + (lastBoS === "Bull BoS" ? 1 : 0) + (bodyUp ? 1 : 0);
  const confluenceShort = (trend === "Down Trend" ? 1 : 0) + (kz.inKillzone ? 1 : 0) +
    (nearSupply ? 1 : 0) + (lastBoS === "Bear BoS" ? 1 : 0) + (!bodyUp ? 1 : 0);

  const trendAlignLong = requireTrend ? (trend === "Up Trend" || trend === "No Trend") : true;
  const trendAlignShort = requireTrend ? (trend === "Down Trend" || trend === "No Trend") : true;
  const sessOk = requireSession ? kz.inKillzone : true;

  // Signal resolution
  let signal = "NEUTRAL", reason = "No ICT setup", kind = "none";
  if (tappedDemand && trendAlignLong && sessOk) {
    signal = "BUY"; kind = "entry"; reason = `Price tapped Demand OB (${confluenceLong}/5 confluence)`;
  } else if (tappedSupply && trendAlignShort && sessOk) {
    signal = "SELL"; kind = "entry"; reason = `Price tapped Supply OB (${confluenceShort}/5 confluence)`;
  } else if (nearDemand && trendAlignLong && sessOk) {
    signal = "BUY"; kind = "pre"; reason = `Approaching Demand OB (${confluenceLong}/5) — prepare long`;
  } else if (nearSupply && trendAlignShort && sessOk) {
    signal = "SELL"; kind = "pre"; reason = `Approaching Supply OB (${confluenceShort}/5) — prepare short`;
  } else {
    reason = trend !== "No Trend" ? `${trend}, waiting for OB interaction` : "No clear structure";
  }

  return {
    signal, reason, kind,
    trend, lastBoS, atr: curAtr,
    killzone: kz.active, inKillzone: kz.inKillzone, nseOpen: kz.nseOpen,
    confluenceLong, confluenceShort,
    activeDemand: dem ? { proximal: dem.proximal, distal: dem.distal, index: dem.index } : null,
    activeSupply: sup ? { proximal: sup.proximal, distal: sup.distal, index: sup.index } : null,
    nearDemand, nearSupply, tappedDemand, tappedSupply,
    // series for chart overlays
    zones: {
      demand: obs.demand.map(o => ({ time: candles[o.index].time, proximal: o.proximal, distal: o.distal, mitigated: o.mitigated, breakTime: candles[o.breakIndex]?.time })),
      supply: obs.supply.map(o => ({ time: candles[o.index].time, proximal: o.proximal, distal: o.distal, mitigated: o.mitigated, breakTime: candles[o.breakIndex]?.time })),
    },
    bosEvents: structure.events.map(e => ({ time: candles[e.index].time, type: e.type, level: e.level })),
    swings: {
      highs: structure.swings.highs.map(h => ({ time: candles[h.index].time, price: h.price })),
      lows: structure.swings.lows.map(l => ({ time: candles[l.index].time, price: l.price })),
    },
  };
}
