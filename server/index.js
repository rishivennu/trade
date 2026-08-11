import express from "express";
import cors from "cors";
import { fetchCandles, fetchQuotes, INSTRUMENTS } from "./data.js";
import { ema, rsi, macd, bollingerBands, vwap, generateSignal, evalCustomFormula } from "./indicators.js";
import { analyzeICT } from "./ict.js";
import { ppSuperTrendSignal } from "./ppst.js";
import { getLive, getLiveIndices, nseMarketOpen, isNSESymbol } from "./nse.js";
import * as db from "./db.js";
import { getAISignal, aiProvider } from "./ai.js";
import { runBacktest } from "./backtest.js";
import { runGridSearch, runWalkForward, PARAM_GRIDS, EXEC_GRID, OBJECTIVES } from "./optimize.js";
import { monteCarlo, permutationTest, bootstrapExpectancy } from "./robust.js";
import { runPortfolioBacktest } from "./portfolio.js";
import { CHARGE_PRESETS } from "./exec.js";
import { createForwardTest, listForwardTests, refreshForwardTest, setForwardStatus, deleteForwardTest } from "./forward.js";
import { brokerStatus, brokerConnect, brokerDisconnect, lastTicks } from "./broker.js";

const app = express();
app.use(cors());
app.use(express.json());

// Distinguish a bad request from a genuine server fault. Almost every error these
// analysis routes can raise is caused by the input — an unknown symbol, an interval
// Yahoo will not serve, a Pine construct we do not support, a range too short to
// have any bars. Returning 500 for those is a lie that sends people hunting for a
// server problem that does not exist. A real code fault surfaces as TypeError /
// ReferenceError, and only that gets a 500.
function sendErr(res, e) {
  const bug = e instanceof TypeError || e instanceof ReferenceError || e instanceof RangeError;
  const code = e.status || (bug ? 500 : 400);
  res.status(code).json({ error: e.message, kind: bug ? "server" : "input" });
  if (bug) console.error("[server fault]", e);
}

app.get("/api/instruments", (req, res) => res.json(INSTRUMENTS));

app.get("/api/quotes", async (req, res) => {
  try {
    const symbols = (req.query.symbols || "").split(",").filter(Boolean);
    res.json(await fetchQuotes(symbols));
  } catch (e) { sendErr(res, e); }
});

app.get("/api/candles", async (req, res) => {
  try {
    const { symbol = "^NSEI", interval = "5m", range = "1d" } = req.query;
    res.json(await fetchCandles(symbol, interval, range));
  } catch (e) { sendErr(res, e); }
});

app.get("/api/analyze", async (req, res) => {
  try {
    const { symbol = "^NSEI", interval = "5m", range = "5d", strategy = "combined",
      emaFastPeriod = 9, emaSlowPeriod = 21, rsiPeriod = 14, rsiOverbought = 70, rsiOversold = 30,
      formula, preEntryATR = 0.5, requireTrend = "true", requireSession = "false" } = req.query;

    const data = await fetchCandles(symbol, interval, range);
    // Overlay live NSE price on the last bar so signals compute on fresh data
    if (isNSESymbol(symbol)) {
      try {
        const live = await getLive(symbol);
        if (live?.last) {
          const lc = data.candles[data.candles.length - 1];
          lc.close = live.last;
          if (live.last > lc.high) lc.high = live.last;
          if (live.last < lc.low) lc.low = live.last;
          data.lastPrice = live.last; data.live = true; data.liveSource = live.source;
        }
      } catch (e) { data.live = false; }
    }
    const closes = data.candles.map(c => c.close);
    const config = { strategy, emaFastPeriod: +emaFastPeriod, emaSlowPeriod: +emaSlowPeriod,
      rsiPeriod: +rsiPeriod, rsiOverbought: +rsiOverbought, rsiOversold: +rsiOversold };

    let signalResult, ict = null, ppst = null;
    if (strategy === "ict") {
      ict = analyzeICT(data.candles, { preEntryATR: +preEntryATR, requireTrend: requireTrend === "true", requireSession: requireSession === "true" });
      signalResult = { signal: ict.signal, reason: ict.reason, kind: ict.kind,
        indicators: { price: closes[closes.length-1], trend: ict.trend, atr: ict.atr,
          confluenceLong: ict.confluenceLong, confluenceShort: ict.confluenceShort },
        scores: { buy: ict.confluenceLong, sell: ict.confluenceShort } };
    } else if (strategy === "pp_supertrend") {
      signalResult = ppSuperTrendSignal(data.candles, {
        prd: +(req.query.ppPrd ?? 2), factor: +(req.query.ppFactor ?? 3), atrLen: +(req.query.ppAtrLen ?? 10),
        useEmaFilter: req.query.ppUseEma === "true", emaLen: +(req.query.ppEmaLen ?? 200),
        useAdxFilter: req.query.ppUseAdx === "true", adxMin: +(req.query.ppAdxMin ?? 20),
        useVolumeFilter: req.query.ppUseVolume === "true",
        useCandleConfirm: req.query.ppUseCandle === "true",
      });
      ppst = signalResult.series;
    } else if (formula && strategy === "custom") {
      signalResult = evalCustomFormula(formula, closes);
    } else {
      signalResult = generateSignal(closes, config);
    }

    // Indicator series for charts
    const emaFastSeries = ema(closes, config.emaFastPeriod);
    const emaSlowSeries = ema(closes, config.emaSlowPeriod);
    const rsiSeries = rsi(closes, config.rsiPeriod);
    const macdData = macd(closes);
    const bb = bollingerBands(closes);
    const vwapSeries = vwap(data.candles);

    const price = closes[closes.length - 1];
    db.logSignal({ symbol, signal: signalResult.signal, reason: signalResult.reason, price, strategy });

    // Generate alert on actionable signals (not NEUTRAL)
    let newAlert = null;
    if (signalResult.signal === "BUY" || signalResult.signal === "SELL") {
      newAlert = db.pushAlert({ symbol, signal: signalResult.signal, reason: signalResult.reason,
        price, strategy, kind: signalResult.kind === "pre" ? "pre-entry" : "signal" });
    }
    // Check user price rules
    const firedRules = db.checkPriceRules(symbol, price);

    res.json({ ...data, config, signal: signalResult, ict,
      indicators: { emaFast: emaFastSeries, emaSlow: emaSlowSeries, rsi: rsiSeries,
        macd: macdData.macdLine, macdSignal: macdData.signalLine, macdHist: macdData.histogram,
        bbUpper: bb.upper, bbMid: bb.mid, bbLower: bb.lower, vwap: vwapSeries,
        ppTrail: ppst?.trail || null, ppCenter: ppst?.center || null, ppTrend: ppst?.trend || null },
      newAlert, firedRules });
  } catch (e) { sendErr(res, e); }
});

// Paper trading
app.get("/api/portfolio", (req, res) => { try { res.json(db.getPortfolio()); } catch (e) { sendErr(res, e); } });
app.post("/api/trades", (req, res) => {
  try {
    const { symbol, side, quantity, entryPrice, strategy, reason } = req.body;
    if (!symbol || !side || !quantity || !entryPrice) return res.status(400).json({ error: "Missing fields" });
    res.json(db.openTrade({ symbol, side, quantity: +quantity, entryPrice: +entryPrice, strategy, reason }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post("/api/trades/:id/close", (req, res) => {
  try {
    if (!req.body.exitPrice) return res.status(400).json({ error: "exitPrice required" });
    res.json(db.closeTrade(+req.params.id, +req.body.exitPrice));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get("/api/trades", (req, res) => res.json(db.getTradeHistory(+(req.query.limit || 50))));
app.get("/api/signals", (req, res) => res.json(db.getSignalHistory(+(req.query.limit || 30))));
app.get("/api/stats", (req, res) => { try { res.json(db.getStats()); } catch (e) { sendErr(res, e); } });

// Historical backtest
app.post("/api/backtest", async (req, res) => {
  try { res.json(await runBacktest(req.body || {})); }
  catch (e) { sendErr(res, e); }
});

// ── Parameter optimisation: grid sweep and walk-forward validation ──────────
// Long-running: a wide grid over many bars can take tens of seconds.
app.post("/api/optimize", async (req, res) => {
  try {
    const body = req.body || {};
    const mode = body.mode ?? "grid";
    if (mode !== "grid" && mode !== "walkforward") {
      return res.status(400).json({ error: `Unknown mode "${body.mode}" — expected "grid" or "walkforward"`, kind: "input" });
    }
    const out = mode === "walkforward" ? await runWalkForward(body) : await runGridSearch(body);
    res.json({ mode, ...out });
  } catch (e) { sendErr(res, e); }
});

// Grids, objectives and charge presets the UI needs to build its forms.
app.get("/api/optimize-meta", (req, res) => {
  res.json({
    paramGrids: PARAM_GRIDS,
    execGrid: EXEC_GRID,
    objectives: Object.entries(OBJECTIVES).map(([k, v]) => ({ key: k, label: v.label })),
    chargePresets: Object.entries(CHARGE_PRESETS).map(([k, v]) => ({ key: k, label: v.label })),
  });
});

// ── Robustness: Monte Carlo, permutation test, bootstrap expectancy ─────────
// Runs a backtest first so the client only sends strategy settings.
app.post("/api/robustness", async (req, res) => {
  try {
    const body = req.body || {};
    const bt = await runBacktest({ ...body, wantAllTrades: true, replay: false });
    const trades = bt.allTrades || bt.trades || [];
    if (trades.length < 5) {
      return res.json({
        meta: bt.meta, metrics: bt.metrics, trades: trades.length,
        error: `Only ${trades.length} trade(s) — robustness tests need at least 5 to say anything meaningful.`,
      });
    }
    const initialCapital = body.initialCapital ?? 1000000;
    const runsMC = Math.min(5000, Math.max(100, +(body.mcRuns || 1000)));
    const runsPT = Math.min(2000, Math.max(50, +(body.permRuns || 300)));
    const [mc, boot] = [
      monteCarlo(trades, { initialCapital, runs: runsMC, seed: body.seed || 12345 }),
      bootstrapExpectancy(trades, { runs: Math.min(5000, Math.max(200, +(body.bootRuns || 2000))), seed: body.seed || 777 }),
    ];
    let perm = null;
    try {
      const { loadCandles } = await import("./backtest.js");
      const data = await loadCandles(body.symbol || "^NSEI", body.interval || "1d", body.range || "1y");
      perm = permutationTest(data.candles, trades, { runs: runsPT, initialCapital, seed: body.seed || 999 });
    } catch (e) { perm = { error: e.message }; }
    res.json({ meta: bt.meta, metrics: bt.metrics, trades: trades.length, monteCarlo: mc, permutation: perm, bootstrap: boot });
  } catch (e) { sendErr(res, e); }
});

// ── Multi-symbol portfolio backtest ────────────────────────────────────────
// ── Broker tick feed (SCAFFOLD — see server/broker.js header) ───────────────
app.get("/api/broker/status", (req, res) => res.json(brokerStatus()));
app.get("/api/broker/ticks", (req, res) => res.json(lastTicks()));
app.post("/api/broker/connect", async (req, res) => {
  try { res.json(await brokerConnect(req.body || {})); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post("/api/broker/disconnect", (req, res) => res.json(brokerDisconnect()));

// ── Forward test logger ─────────────────────────────────────────────────────
app.get("/api/forward", async (req, res) => {
  try { res.json(await listForwardTests({ refresh: req.query.refresh !== "false" })); }
  catch (e) { sendErr(res, e); }
});

app.post("/api/forward", async (req, res) => {
  try { res.json(await createForwardTest(req.body || {})); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/forward/:id/refresh", async (req, res) => {
  try { res.json(await refreshForwardTest(req.params.id)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/forward/:id/status", (req, res) => {
  try { res.json(setForwardStatus(req.params.id, (req.body || {}).status)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete("/api/forward/:id", (req, res) => {
  try { res.json(deleteForwardTest(req.params.id)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/portfolio-backtest", async (req, res) => {
  try { res.json(await runPortfolioBacktest(req.body || {})); }
  catch (e) { sendErr(res, e); }
});

// AI trade signal (DeepSeek / Claude)
app.get("/api/ai-status", (req, res) => res.json({ provider: aiProvider() }));
app.post("/api/ai-signal", async (req, res) => {
  try {
    const sig = await getAISignal(req.body || {});
    res.json(sig);
  } catch (e) { res.status(e.code === "NO_KEY" ? 400 : 502).json({ error: e.message, code: e.code }); }
});
app.post("/api/portfolio/reset", (req, res) => res.json(db.resetPortfolio()));

// Alerts
app.get("/api/alerts", (req, res) => res.json(db.getAlerts(+(req.query.limit || 50))));
app.post("/api/alerts/read", (req, res) => res.json(db.markAlertsRead()));
app.post("/api/alerts/clear", (req, res) => res.json(db.clearAlerts()));
app.get("/api/alert-rules", (req, res) => res.json(db.getAlertRules()));
app.post("/api/alert-rules", (req, res) => {
  try {
    const { symbol, condition, price } = req.body;
    if (!symbol || !condition || !price) return res.status(400).json({ error: "Missing fields" });
    res.json(db.addAlertRule({ symbol, condition, price }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete("/api/alert-rules/:id", (req, res) => res.json(db.deleteAlertRule(+req.params.id)));


// -- LIVE data (NSE near-real-time LTP)
app.get("/api/live", async (req, res) => {
  try {
    const { symbol } = req.query;
    if (!symbol || !isNSESymbol(symbol)) return res.json({ symbol, live: false, marketOpen: await nseMarketOpen() });
    const q = await getLive(symbol);
    res.json({ ...q, live: true, marketOpen: await nseMarketOpen() });
  } catch (e) { res.json({ symbol: req.query.symbol, live: false, error: e.message, marketOpen: await nseMarketOpen() }); }
});

app.get("/api/live-indices", async (req, res) => {
  try {
    const symbols = (req.query.symbols || "").split(",").filter(Boolean);
    res.json({ quotes: await getLiveIndices(symbols), marketOpen: await nseMarketOpen() });
  } catch (e) { res.json({ quotes: [], error: e.message, marketOpen: await nseMarketOpen() }); }
});

const PORT = process.env.PORT || 3500;
// On Vercel the app is exported as a serverless handler; only listen locally.
if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`Trading Terminal API running on http://localhost:${PORT}`));
}
export default app;
