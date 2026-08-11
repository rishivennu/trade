import { useState, useEffect, useCallback, useRef } from "react";
import { api, API_BASE } from "./api.js";
import Chart from "./Chart.jsx";
import EquityChart from "./EquityChart.jsx";
import ReplayPlayer from "./ReplayPlayer.jsx";
import ExecutionPanel from "./ExecutionPanel.jsx";
import { RiskMetrics, ExcursionPanel, RegimePanel, MonthlyPanel } from "./AnalyticsPanels.jsx";
import Optimizer from "./Optimizer.jsx";
import PortfolioBacktest from "./PortfolioBacktest.jsx";
import Robustness from "./Robustness.jsx";
import ForwardTest from "./ForwardTest.jsx";
import BrokerFeed from "./BrokerFeed.jsx";
import { ToastProvider, useToast, usePersisted, clearPersisted, useTablist, ShortcutHelp, isTyping } from "./ui.jsx";

// Toast context must sit ABOVE the component that calls useToast(), so App is a thin wrapper.
export default function App() {
  return <ToastProvider><Terminal /></ToastProvider>;
}
import {
  TrendingUp, Bell, LineChart, Radio, History, Sliders, X, Trash2,
  ArrowUpRight, ArrowDownRight, Activity, Target, Layers, Clock,
  BarChart3, Wallet, Percent, Award, DollarSign, Bot, Sparkles,
  FlaskConical, Play, TrendingDown, Gauge, Code2, Sun, Moon, Shield, Grid3x3, Dices,
  Keyboard,
} from "lucide-react";
import "./index.css";

// JSON has no Infinity, so an infinite profit factor arrives as null.
// Anything non-finite renders as ∞ so ratios never crash the view.
const ratio = (v) => (v == null || v === Infinity || !isFinite(v) ? "∞" : Number(v).toFixed(2));

const INTERVALS = ["1m","5m","15m","30m","1h","1d","1wk"];
const RANGES = ["1d","5d","1mo","3mo","6mo","1y","5y"];
const STRATEGIES = [
  { id: "ict", name: "ICT Concepts (OB + Structure)" },
  { id: "combined", name: "Combined Multi-Factor" },
  { id: "ema_cross", name: "EMA Crossover" },
  { id: "rsi_reversal", name: "RSI Reversal" },
  { id: "macd", name: "MACD Signal" },
  { id: "pp_supertrend", name: "Pivot Point SuperTrend PRO" },
  { id: "custom", name: "Custom Formula" },
];


const PINE_EXAMPLES = [
  { name: "EMA Crossover", code: `//@version=5
strategy("EMA Crossover", overlay=true)
fastLen = input.int(9, "Fast EMA")
slowLen = input.int(21, "Slow EMA")
fast = ta.ema(close, fastLen)
slow = ta.ema(close, slowLen)
if ta.crossover(fast, slow)
    strategy.entry("Long", strategy.long)
if ta.crossunder(fast, slow)
    strategy.close("Long")` },
  { name: "RSI Reversal", code: `//@version=5
strategy("RSI Reversal")
len = input.int(14, "RSI Length")
os = input.int(30, "Oversold")
ob = input.int(70, "Overbought")
r = ta.rsi(close, len)
strategy.entry("Long", strategy.long, when = ta.crossover(r, os))
strategy.close("Long", when = ta.crossunder(r, ob))` },
  { name: "MACD Trend", code: `//@version=5
strategy("MACD Trend")
[macdLine, signalLine, hist] = ta.macd(close, 12, 26, 9)
if ta.crossover(macdLine, signalLine)
    strategy.entry("L", strategy.long)
if ta.crossunder(macdLine, signalLine)
    strategy.entry("S", strategy.short)` },
  { name: "Donchian Breakout", code: `//@version=5
strategy("Donchian Breakout")
len = input.int(20, "Channel Length")
hh = ta.highest(high, len)
ll = ta.lowest(low, len)
if close > hh[1]
    strategy.entry("Long", strategy.long)
if close < ll[1]
    strategy.close("Long")` },
  { name: "Bollinger Mean-Reversion", code: `//@version=5
strategy("BB Mean Reversion")
len = input.int(20, "BB Length")
mult = input.float(2.0, "StdDev Mult")
basis = ta.sma(close, len)
dev = mult * ta.stdev(close, len)
upper = basis + dev
lower = basis - dev
strategy.entry("Long", strategy.long, when = ta.crossover(close, lower))
strategy.close("Long", when = ta.crossover(close, basis))` },
  { name: "Pivot Point SuperTrend PRO (Strategy)", code: `//@version=5
strategy("Pivot Point SuperTrend PRO — Strategy", overlay=true,
     initial_capital=1000000, default_qty_type=strategy.percent_of_equity, default_qty_value=100,
     commission_type=strategy.commission.percent, commission_value=0.03)

// ── Core
prd    = input.int(2, "Pivot Point Period", minval=1)
factor = input.float(3.0, "ATR Factor", minval=0.1, step=0.1)
atrLen = input.int(10, "ATR Period", minval=1)

// ── Direction
allowLong  = input.bool(true, "Allow Longs")
allowShort = input.bool(true, "Allow Shorts")

// ── Filters
useEmaFilter = input.bool(false, "Use EMA Trend Filter")
emaLen       = input.int(200, "EMA Length", minval=1)

useAdxFilter = input.bool(false, "Use ADX Filter")
adxLen       = input.int(14, "ADX DI Length", minval=1)
adxSmooth    = input.int(14, "ADX Smoothing", minval=1)
adxMin       = input.float(20, "Minimum ADX", minval=0)

useVolumeFilter = input.bool(false, "Use Volume Filter")
volLen          = input.int(20, "Volume SMA Length", minval=1)

useCandleConfirm = input.bool(false, "Use Strong Candle Confirmation")

// ── Exits
useStopLoss = input.bool(true, "Exit On Trailing Stop")
useTargets  = input.bool(false, "Use R-Multiple Targets")
rr1 = input.float(1.0, "TP1 R Multiple", minval=0.1, step=0.1)
rr2 = input.float(2.0, "TP2 R Multiple", minval=0.1, step=0.1)
rr3 = input.float(3.0, "TP3 R Multiple", minval=0.1, step=0.1)

// ── Pivot Point SuperTrend
ph = ta.pivothigh(high, prd, prd)
pl = ta.pivotlow(low, prd, prd)

var float center = na
lastPP = not na(ph) ? ph : not na(pl) ? pl : na

if not na(lastPP)
    if na(center)
        center := lastPP
    else
        center := (center * 2.0 + lastPP) / 3.0

atrValue = ta.atr(atrLen)
upBand = center - factor * atrValue
dnBand = center + factor * atrValue

var float tUp = na
var float tDown = na
var int trend = 1

tUp   := na(tUp[1])   ? upBand : close[1] > tUp[1]   ? math.max(upBand, tUp[1])   : upBand
tDown := na(tDown[1]) ? dnBand : close[1] < tDown[1] ? math.min(dnBand, tDown[1]) : dnBand

trend := close > nz(tDown[1], dnBand) ? 1 : close < nz(tUp[1], upBand) ? -1 : nz(trend[1], 1)

trailingSL = trend == 1 ? tUp : tDown

plot(trailingSL, title="PP SuperTrend", color=trend == 1 ? color.lime : color.red, linewidth=2)

// ── Filter gates
emaValue = ta.ema(close, emaLen)
emaLongOk  = not useEmaFilter or close > emaValue
emaShortOk = not useEmaFilter or close < emaValue

[plusDI, minusDI, adxValue] = ta.dmi(adxLen, adxSmooth)
adxOk = not useAdxFilter or adxValue >= adxMin

volSma   = ta.sma(volume, volLen)
volumeOk = not useVolumeFilter or volume > volSma

candleLongOk  = not useCandleConfirm or (close > open and close > high[1])
candleShortOk = not useCandleConfirm or (close < open and close < low[1])

// ── Signals
flipUp = trend == 1 and trend[1] == -1 and not na(trailingSL)
flipDn = trend == -1 and trend[1] == 1 and not na(trailingSL)

buySignal  = flipUp and emaLongOk  and adxOk and volumeOk and candleLongOk
sellSignal = flipDn and emaShortOk and adxOk and volumeOk and candleShortOk

// ── Orders
var float entryPrice = na
var float stopPrice  = na

if buySignal
    if allowLong
        strategy.entry("Long", strategy.long)
        entryPrice := close
        stopPrice  := trailingSL
    else
        strategy.close("Short")

if sellSignal
    if allowShort
        strategy.entry("Short", strategy.short)
        entryPrice := close
        stopPrice  := trailingSL
    else
        strategy.close("Long")

risk = na(entryPrice) or na(stopPrice) ? na : math.abs(entryPrice - stopPrice)

if useTargets and not na(risk)
    strategy.exit("TP Long", "Long", stop=useStopLoss ? stopPrice : na, limit=entryPrice + risk * rr3)
    strategy.exit("TP Short", "Short", stop=useStopLoss ? stopPrice : na, limit=entryPrice - risk * rr3)` },
];

const FORMULA_EXAMPLES = [
  { name: "RSI oversold / overbought", code: 'rsi < 30 ? "BUY" : rsi > 70 ? "SELL" : "NEUTRAL"' },
  { name: "EMA crossover", code: 'emaFast > emaSlow && prevEmaFast <= prevEmaSlow ? "BUY" : emaFast < emaSlow && prevEmaFast >= prevEmaSlow ? "SELL" : "NEUTRAL"' },
  { name: "MACD histogram flip", code: 'macdHist > 0 && prevMacdHist <= 0 ? "BUY" : macdHist < 0 && prevMacdHist >= 0 ? "SELL" : "NEUTRAL"' },
  { name: "Bollinger mean-reversion", code: 'close < bbLower ? "BUY" : close > bbUpper ? "SELL" : "NEUTRAL"' },
  { name: "VWAP reclaim (intraday)", code: 'close > vwap && prevClose <= prevVwap ? "BUY" : close < vwap && prevClose >= prevVwap ? "SELL" : "NEUTRAL"' },
  { name: "Trend + momentum + RSI guard", code: 'emaFast > emaSlow && macdHist > 0 && rsi < 70 ? "BUY" : emaFast < emaSlow && macdHist < 0 && rsi > 30 ? "SELL" : "NEUTRAL"' },
  { name: "Breakout above 20-bar SMA on volume", code: 'close > sma20 && volume > prevVolume * 1.5 ? "BUY" : close < sma20 ? "SELL" : "NEUTRAL"' },
];

const FORMULA_VARS = [
  "close", "open", "high", "low", "volume", "i",
  "emaFast", "emaSlow", "rsi", "macd", "macdSignal", "macdHist",
  "bbUpper", "bbMid", "bbLower", "vwap", "sma20", "sma50", "atr",
  "prevClose", "prevOpen", "prevHigh", "prevLow", "prevVolume",
  "prevEmaFast", "prevEmaSlow", "prevRsi", "prevMacdHist", "prevVwap",
];

const fmt = (n, d = 2) => n == null || isNaN(n) ? "—" : Number(n).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const inr = (n) => n == null ? "—" : "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const inrSigned = (n) => n == null ? "—" : (n >= 0 ? "+" : "−") + "₹" + Math.abs(Math.round(n)).toLocaleString("en-IN");
const pctFmt = (n) => n == null || isNaN(n) ? "—" : `${n.toFixed(1)}%`;
const sizingLabel = (mode, cfg = {}) => {
  if (mode === "risk") return `${cfg.riskPct ?? 1}% risk per trade`;
  if (mode === "fixed") return `fixed ${inr(cfg.notional ?? 0)} notional`;
  if (mode === "units") return `${cfg.units ?? 1} unit${(cfg.units ?? 1) === 1 ? "" : "s"} per trade`;
  return "full equity per trade";
};

const TABS = [
  ["chart", LineChart, "Chart"], ["performance", BarChart3, "Performance"],
  ["backtest", FlaskConical, "Backtest"], ["optimizer", Grid3x3, "Optimiser"],
  ["portfolio", Layers, "Portfolio"], ["forward", Radio, "Forward Test"],
  ["signals", Radio, "Signals"], ["trades", History, "Trades"],
  ["alerts", Bell, "Alerts"], ["config", Sliders, "Config"],
];
const TAB_IDS = TABS.map(t => t[0]);

const SHORTCUTS = [
  ["?", "Show this help"],
  ["1 – 9, 0", "Jump straight to a tab"],
  ["← / →", "Previous / next tab (while the tab bar has focus)"],
  ["g", "Run Analyze on the current symbol"],
  ["b", "Run the backtest"],
  ["t", "Toggle light / dark theme"],
  ["a", "Open the alerts drawer"],
  ["/", "Focus the instrument search box"],
  ["Esc", "Close drawer or dialog"],
];

function Terminal() {
  const [tab, setTab] = usePersisted("tab", "chart");
  const [theme, setTheme] = useState(() => localStorage.getItem("tt-theme") || "dark");
  const [btStrategy, setBtStrategy] = usePersisted("btStrategy", "combined");
  const [btFormula, setBtFormula] = useState('rsi < 30 ? "BUY" : rsi > 70 ? "SELL" : "NEUTRAL"');
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("tt-theme", theme); }, [theme]);
  const [instruments, setInstruments] = useState([]);
  const [quotes, setQuotes] = useState({});
  const [symbol, setSymbol] = usePersisted("symbol", "^NSEI");
  const [interval, setIv] = usePersisted("interval", "15m");
  const [range, setRange] = usePersisted("range", "1mo");
  const [strategy, setStrategy] = usePersisted("strategy", "ict");
  const [formula, setFormula] = useState('rsi < 30 ? "BUY" : rsi > 70 ? "SELL" : "NEUTRAL"');
  const [cfg, setCfg] = usePersisted("cfg", { emaFastPeriod: 9, emaSlowPeriod: 21, rsiPeriod: 14, rsiOverbought: 70, rsiOversold: 30, preEntryATR: 0.5, requireTrend: true, requireSession: false });
  const [data, setData] = useState(null);
  const [live, setLive] = useState(null);
  const [marketOpen, setMarketOpen] = useState(false);
  const [portfolio, setPortfolio] = useState(null);
  const [trades, setTrades] = useState([]);
  const [signals, setSignals] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [rules, setRules] = useState([]);
  const [stats, setStats] = useState(null);
  const [drawer, setDrawer] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [qty, setQty] = usePersisted("qty", 1);
  const [search, setSearch] = useState("");
  const [newRule, setNewRule] = useState({ condition: "above", price: "" });
  const refreshRef = useRef(null);
  const seenAlert = useRef(new Set());
  const prevLive = useRef(null);
  const [flash, setFlash] = useState(null);
  const [aiSig, setAiSig] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiProv, setAiProv] = useState(null);
  const [btResult, setBtResult] = useState(null);
  const [btLoading, setBtLoading] = useState(false);
  const [btCfg, setBtCfg] = usePersisted("btCfg", {
    initialCapital: 1000000, allowShort: true,
    // execution realism
    fillMode: "nextOpen", chargeModel: "bps", feeBps: 3, slipBps: 2,
    // sizing
    sizing: "risk", riskPct: 1, notional: 0, units: 0, maxLeverage: 1,
    // stops and exits
    slAtr: 2, tpAtr: 0, trailAtr: 0, maxBars: 0,
    // scale-out
    useTargets: false, tp1R: 1, tp1Pct: 40, tp2R: 2, tp2Pct: 30, tp3R: 3, tp3Pct: 30, beAfterTp1: true,
  });
  const [showKbd, setShowKbd] = useState(false);
  const toast = useToast();
  const [execOpen, setExecOpen] = useState(false);
  const [robustRes, setRobustRes] = useState(null);
  const [robustBusy, setRobustBusy] = useState(false);
  const [robustErr, setRobustErr] = useState(null);
  const [btMode, setBtMode] = usePersisted("btMode", "builtin");
  const [btView, setBtView] = useState("summary");
  const [btPine, setBtPine] = usePersisted("btPine", PINE_EXAMPLES[0].code);

  useEffect(() => {
    api.instruments().then(setInstruments).catch(() => {});
    loadPortfolio(); loadTrades(); loadSignals(); loadAlerts(); loadRules(); loadStats();
    api.aiStatus().then(s => setAiProv(s.provider)).catch(() => {});
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  }, []);

  useEffect(() => {
    if (!instruments.length) return;
    const syms = instruments.map(i => i.symbol);
    const load = () => api.quotes(syms).then(qs => {
      const map = {}; qs.forEach(q => map[q.symbol] = q); setQuotes(prev => ({ ...prev, ...map }));
    }).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [instruments]);

  // Active symbol LIVE poll every 1s (tick feel)
  useEffect(() => {
    let stop = false;
    prevLive.current = null;
    const pollActive = () => fetch(`${API_BASE}/live?symbol=${encodeURIComponent(symbol)}`).then(r=>r.json()).then(l => {
      if (stop) return;
      if (prevLive.current?.last != null && l.last != null && l.last !== prevLive.current.last) {
        setFlash(l.last > prevLive.current.last ? "up" : "down");
        setTimeout(() => setFlash(null), 500);
      }
      prevLive.current = l;
      setLive(l);
      if (l.marketOpen != null) setMarketOpen(l.marketOpen);
    }).catch(()=>{});
    pollActive();
    const t = setInterval(pollActive, 1000);
    return () => { stop = true; clearInterval(t); };
  }, [symbol]);

  useEffect(() => {
    if (!instruments.length) return;
    const idxSyms = instruments.filter(i => i.group === 'F&O Indices').map(i => i.symbol);
    let stop = false;
    const poll = () => fetch(`${API_BASE}/live-indices?symbols=${encodeURIComponent(idxSyms.join(','))}`).then(r=>r.json()).then(res => {
      if (stop || !res.quotes) return;
      setQuotes(prev => { const m={...prev}; res.quotes.forEach(q => m[q.symbol]={ symbol:q.symbol, price:q.last, change:q.change, changePct:q.pct, live:true }); return m; });
      if (res.marketOpen!=null) setMarketOpen(res.marketOpen);
    }).catch(()=>{});
    poll();
    const t = setInterval(poll, 3000);
    return () => { stop = true; clearInterval(t); };
  }, [instruments]);

  const loadPortfolio = () => api.portfolio().then(setPortfolio).catch(() => {});
  const loadTrades = () => api.trades().then(setTrades).catch(() => {});
  const loadSignals = () => api.signals().then(setSignals).catch(() => {});
  const loadRules = () => api.alertRules().then(setRules).catch(() => {});
  const loadStats = () => api.stats().then(setStats).catch(() => {});
  const loadAlerts = () => api.alerts().then(as => {
    setAlerts(as);
    for (const a of as) {
      if (!seenAlert.current.has(a.id)) {
        seenAlert.current.add(a.id);
        if (Notification?.permission === "granted" && !a.read) {
          new Notification(`${a.signal} · ${a.symbol}`, { body: a.reason, silent: false });
        }
      }
    }
  }).catch(() => {});

  const analyze = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const params = { symbol, interval, range, strategy,
        emaFastPeriod: cfg.emaFastPeriod, emaSlowPeriod: cfg.emaSlowPeriod, rsiPeriod: cfg.rsiPeriod,
        rsiOverbought: cfg.rsiOverbought, rsiOversold: cfg.rsiOversold,
        preEntryATR: cfg.preEntryATR, requireTrend: cfg.requireTrend, requireSession: cfg.requireSession };
      if (strategy === "custom") params.formula = formula;
      const r = await api.analyze(params);
      setData(r);
      if (r.newAlert || (r.firedRules && r.firedRules.length)) loadAlerts();
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }, [symbol, interval, range, strategy, cfg, formula]);

  useEffect(() => { analyze(); }, [symbol, interval, range, strategy]);
  useEffect(() => {
    if (refreshRef.current) clearInterval(refreshRef.current);
    refreshRef.current = setInterval(() => { analyze(); loadPortfolio(); }, 30000);
    return () => clearInterval(refreshRef.current);
  }, [analyze]);

  const lastPx = data?.candles?.[data.candles.length - 1]?.close;
  const livePx = live?.live && live?.last ? live.last : lastPx;
  const isLiveSym = live?.live === true;
  const q = quotes[symbol];

  const priceFor = useCallback((sym) => {
    if (sym === symbol && livePx) return livePx;
    return quotes[sym]?.price;
  }, [symbol, livePx, quotes]);

  const openPositions = portfolio?.openTrades || [];
  const posWithLive = openPositions.map(t => {
    const cur = priceFor(t.symbol) ?? t.entry_price;
    const unrealized = t.side === "BUY" ? (cur - t.entry_price) * t.quantity : (t.entry_price - cur) * t.quantity;
    const pctChg = t.entry_price ? ((cur - t.entry_price) / t.entry_price) * 100 * (t.side === "BUY" ? 1 : -1) : 0;
    return { ...t, currentPrice: cur, unrealized, pctChg };
  });
  const unrealizedTotal = posWithLive.reduce((s, t) => s + t.unrealized, 0);
  const closedPnl = trades.filter(t => t.status === "CLOSED").reduce((s, t) => s + (t.pnl || 0), 0);
  const equity = portfolio ? portfolio.balance + posWithLive.reduce((s, t) => s + t.quantity * t.currentPrice, 0) : 0;
  const totalReturn = portfolio ? ((equity - portfolio.initial_balance) / portfolio.initial_balance) * 100 : 0;

  const runAISignal = async () => {
    if (!data) return;
    setAiLoading(true); setAiSig(null); setErr(null);
    try {
      const last = (arr) => Array.isArray(arr) ? [...arr].reverse().find(v => v != null) : undefined;
      const I = data.indicators || {};
      const snapshot = {
        symbol: curName, interval, price: livePx, prevClose: data.prevClose,
        indicators: {
          RSI: last(I.rsi), EMAfast: last(I.emaFast), EMAslow: last(I.emaSlow),
          MACD: last(I.macd), MACDsignal: last(I.macdSignal), MACDhist: last(I.macdHist),
          BBupper: last(I.bbUpper), BBlower: last(I.bbLower), VWAP: last(I.vwap),
        },
        ict: data.ict && !data.ict.error ? data.ict : null,
        recentCandles: (data.candles || []).slice(-12).map(c => ({ o: +c.open?.toFixed?.(2), h: +c.high?.toFixed?.(2), l: +c.low?.toFixed?.(2), c: +c.close?.toFixed?.(2) })),
      };
      const r = await api.aiSignal(snapshot);
      setAiSig(r);
    } catch (e) { setErr("AI: " + e.message); toast("AI signal failed: " + e.message, "err"); }
    setAiLoading(false);
  };

  const runBt = async () => {
    setBtLoading(true); setBtResult(null); setErr(null);
    try {
      const r = await api.backtest({
        symbol, interval, range, strategy: btMode === "pine" ? "combined" : btStrategy,
        formula: btStrategy === "custom" ? btFormula : undefined,
        ...btCfg,
        emaFastPeriod: cfg.emaFastPeriod, emaSlowPeriod: cfg.emaSlowPeriod,
        rsiPeriod: cfg.rsiPeriod, rsiOverbought: cfg.rsiOverbought, rsiOversold: cfg.rsiOversold,
        pineScript: btMode === "pine" ? btPine : null,
        replay: true,
      });
      setBtResult(r);
      toast(`Backtest done: ${r?.trades?.length ?? 0} trades, net ${(r?.metrics?.netPnlPct ?? 0).toFixed(2)}%`, "ok");
    } catch (e) { setErr("Backtest: " + e.message); toast("Backtest failed: " + e.message, "err"); }
    setBtLoading(false);
  };

  // Body shared by backtest, optimiser, portfolio and robustness so all four
  // always simulate with exactly the same execution assumptions.
  const btBody = () => ({
    symbol, interval, range,
    strategy: btMode === "pine" ? "combined" : btStrategy,
    formula: btStrategy === "custom" ? btFormula : undefined,
    ...btCfg,
    emaFastPeriod: cfg.emaFastPeriod, emaSlowPeriod: cfg.emaSlowPeriod,
    rsiPeriod: cfg.rsiPeriod, rsiOverbought: cfg.rsiOverbought, rsiOversold: cfg.rsiOversold,
    pineScript: btMode === "pine" ? btPine : null,
  });

  const runRobust = async () => {
    setRobustBusy(true); setRobustErr(null); setRobustRes(null);
    try { setRobustRes(await api.robustness(btBody())); }
    catch (e) { setRobustErr(e.message); }
    setRobustBusy(false);
  };

  const executeTrade = async (side) => {
    if (!livePx) { toast("No live price yet — run Analyze first", "warn"); return; }
    try {
      await api.openTrade({ symbol, side, quantity: qty, entryPrice: livePx, strategy, reason: data?.signal?.reason });
      loadPortfolio(); loadTrades(); loadStats();
      toast(`${side} ${qty} ${curName} at ${fmt(livePx)}`, "ok");
    } catch (e) { setErr(e.message); toast(e.message, "err"); }
  };
  const closePos = async (t) => {
    const cur = priceFor(t.symbol) ?? t.entry_price;
    try {
      await api.closeTrade(t.id, cur);
      loadPortfolio(); loadTrades(); loadStats();
      toast(`Closed ${t.side} ${t.symbol.replace(".NS", "")} at ${fmt(cur)}`, "ok");
    } catch (e) { setErr(e.message); toast(e.message, "err"); }
  };
  const resetPf = async () => {
    if (!confirm("Reset portfolio and clear all trades?")) return;
    await api.resetPortfolio(); loadPortfolio(); loadTrades(); loadStats();
    toast("Portfolio reset to opening balance", "ok");
  };
  const openDrawer = () => { setDrawer(true); api.markAlertsRead().then(loadAlerts); };
  const addRule = async () => {
    if (!newRule.price) return;
    try {
      await api.addAlertRule({ symbol, condition: newRule.condition, price: newRule.price });
      setNewRule({ condition: "above", price: "" }); loadRules();
      toast(`Alert set: ${curName} ${newRule.condition} ${newRule.price}`, "ok");
    } catch (e) { setErr(e.message); toast(e.message, "err"); }
  };

  // ── Tab navigation ────────────────────────────────────────────────────
  const goTab = useCallback(id => {
    setTab(id);
    if (id === "performance") loadStats();
  }, [setTab, loadStats]);
  const tablist = useTablist(TAB_IDS, tab, goTab);

  // The tab is restored from localStorage, so a direct landing on Performance
  // must fetch its own data instead of waiting for a click.
  useEffect(() => { if (tab === "performance" && !stats) loadStats(); }, [tab, stats]);

  const searchRef = useRef(null);

  // ── Global keyboard shortcuts (stand down while typing) ───────────────
  useEffect(() => {
    const onKey = e => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") { setDrawer(false); setShowKbd(false); return; }
      if (isTyping()) return;

      if (e.key === "?" || (e.key === "/" && e.shiftKey)) { e.preventDefault(); setShowKbd(v => !v); return; }
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); return; }

      // 1..9 then 0 map onto the ten tabs in visual order
      if (/^[0-9]$/.test(e.key)) {
        const idx = e.key === "0" ? 9 : Number(e.key) - 1;
        if (TAB_IDS[idx]) { e.preventDefault(); goTab(TAB_IDS[idx]); }
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "t") { setTheme(t => (t === "dark" ? "light" : "dark")); }
      else if (k === "a") { goTab("alerts"); openDrawer(); }
      else if (k === "g") { analyze(); }
      else if (k === "b") { goTab("backtest"); runBt(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTab, analyze, runBt, openDrawer, setTheme]);

  const unread = alerts.filter(a => !a.read).length;
  const filtered = instruments.filter(i => !search || i.name.toLowerCase().includes(search.toLowerCase()) || i.symbol.toLowerCase().includes(search.toLowerCase()));
  const grouped = filtered.reduce((a, i) => { (a[i.group] = a[i.group] || []).push(i); return a; }, {});
  const curName = instruments.find(i => i.symbol === symbol)?.name || symbol;

  useEffect(() => {
    const px = livePx ? fmt(livePx) : "—";
    document.title = `${curName} ${px} · Trading Terminal`;
  }, [curName, livePx]);

  const ict = data?.ict && !data.ict.error ? data.ict : null;

  const winRate = stats?.overall?.winRate ?? 0;
  const pf = stats?.overall?.profitFactor ?? 0;

  return (
    <>
      <a className="skip-link" href="#view-panel">Skip to main content</a>
      <header className="hdr">
        <div className="hdr-left">
          <h1 className="logo"><span className="logo-mark" aria-hidden="true"><TrendingUp size={17} aria-hidden="true" /></span> Trading Terminal</h1>
          <span className="pill">PAPER · LIVE</span>
        </div>
        <div className="hdr-right">
          <div className="price-ticker">
            <span className="sym">{curName}</span>
            <span className={`px mono ${flash === "up" ? "flash-up" : flash === "down" ? "flash-down" : ""}`}>{fmt(livePx)}</span>
            {live && live.pct != null && isLiveSym
              ? <span className={`mono ${live.change >= 0 ? "green" : "red"}`} style={{ fontSize: 12, fontWeight: 700 }}>{live.change >= 0 ? "+" : ""}{fmt(live.pct)}%</span>
              : q && <span className={`mono ${q.change >= 0 ? "green" : "red"}`} style={{ fontSize: 12, fontWeight: 700 }}>{q.change >= 0 ? "+" : ""}{fmt(q.changePct)}%</span>}
          </div>
          <span className="live-tag" title={isLiveSym ? "NSE real-time" : "Yahoo ~15min delayed"}>
            <span className={`dot ${isLiveSym ? (marketOpen ? "on" : "idle") : "delayed"}`} />
            {isLiveSym ? (marketOpen ? "LIVE · NSE" : "NSE · Closed") : "DELAYED"}
          </span>
          {data?.signal && <span className={`sig ${data.signal.signal}`}>{data.signal.signal}</span>}
          <button className="bell theme-toggle" onClick={() => setShowKbd(true)}
            aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
            <Keyboard size={17} aria-hidden="true" />
          </button>
          <button className="bell theme-toggle" onClick={() => setTheme(t => t === "dark" ? "light" : "dark")} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} title={theme === "dark" ? "Light mode" : "Dark mode"}>
            {theme === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
          </button>
          <button className="bell" onClick={openDrawer} aria-label="Alerts">
            <Bell size={18} aria-hidden="true" />
            {unread > 0 && <span className="badge">{unread}</span>}
          </button>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar" aria-label="Instrument watchlist and search">
          <div className="search-box">
            <input ref={searchRef} id="wl-search" type="search" className="input" style={{ width: "100%" }}
              placeholder="Search F&O instruments…" aria-label="Search F&O instruments (press / to focus)"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="watchlist" role="listbox" aria-label="Instrument watchlist">
            {Object.entries(grouped).map(([group, items]) => (
              <div key={group} role="group" aria-label={group}>
                <div className="wl-group" aria-hidden="true">{group}</div>
                {items.map(i => {
                  const iq = quotes[i.symbol];
                  return (
                    <button key={i.symbol} type="button" role="option" aria-selected={symbol === i.symbol}
                      className={`wl-item ${symbol === i.symbol ? "active" : ""}`} onClick={() => setSymbol(i.symbol)}>
                      <div className="wl-name">
                        <span className="nm">{i.name}</span>
                        <span className="tk">{i.symbol.replace(".NS", "")}</span>
                      </div>
                      <div className="wl-px">
                        <span className="p mono">{iq ? fmt(iq.price) : "—"}</span>
                        {iq && <span className={`c mono ${iq.change >= 0 ? "green" : "red"}`}>{iq.change >= 0 ? "+" : ""}{fmt(iq.changePct)}%</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </aside>

        <main className="content">
          <div className="tabs" role="tablist" aria-label="Terminal views" ref={tablist.ref} onKeyDown={tablist.onKeyDown}>
            {TABS.map(([id, Icon, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                data-tabid={id}
                id={`tab-${id}`}
                aria-selected={tab === id}
                aria-controls="view-panel"
                tabIndex={tab === id ? 0 : -1}
                className={`tab ${tab === id ? "active" : ""}`}
                onClick={() => goTab(id)}
              >
                <Icon size={15} aria-hidden="true" /> {label}
                {id === "alerts" && unread > 0
                  ? <span className="badge-inline">{unread}<span className="sr-only"> unread alerts</span></span>
                  : null}
              </button>
            ))}
          </div>

          <div
            id="view-panel"
            className="view-panel"
            role="tabpanel"
            aria-labelledby={`tab-${tab}`}
            tabIndex={-1}
          >

          {tab === "chart" && (
          <div className="kpi-row">
            <div className="kpi feature">
              <div className="kpi-top"><span className="kpi-label">Equity</span><span className="kpi-ic"><Wallet size={16} aria-hidden="true"/></span></div>
              <div className="kpi-val">{inr(equity)}</div>
              <div className="kpi-sub">{totalReturn >= 0 ? "▲" : "▼"} {pctFmt(Math.abs(totalReturn))} total return</div>
            </div>
            <div className="kpi">
              <div className="kpi-top"><span className="kpi-label">Unrealized P&L</span><span className="kpi-ic"><Activity size={16} aria-hidden="true"/></span></div>
              <div className={`kpi-val ${unrealizedTotal >= 0 ? "green" : "red"}`}>{inrSigned(unrealizedTotal)}</div>
              <div className="kpi-sub">{openPositions.length} open position{openPositions.length !== 1 ? "s" : ""}</div>
            </div>
            <div className="kpi">
              <div className="kpi-top"><span className="kpi-label">Realized P&L</span><span className="kpi-ic"><DollarSign size={16} aria-hidden="true"/></span></div>
              <div className={`kpi-val ${closedPnl >= 0 ? "green" : "red"}`}>{inrSigned(closedPnl)}</div>
              <div className="kpi-sub">{stats?.overall?.totalTrades || 0} closed trades</div>
            </div>
            <div className="kpi">
              <div className="kpi-top"><span className="kpi-label">Win Rate · PF</span><span className="kpi-ic"><Percent size={16} aria-hidden="true"/></span></div>
              <div className="kpi-val">{pctFmt(winRate)}</div>
              <div className="kpi-sub">Profit Factor {ratio(pf)}</div>
            </div>
          </div>
          )}

          {tab === "chart" && (
            <div className="toolbar">
              <div className="field"><label htmlFor="app-interval-1">Interval</label>
                <select id="app-interval-1" className="select" value={interval} onChange={e => setIv(e.target.value)}>{INTERVALS.map(v => <option key={v}>{v}</option>)}</select></div>
              <div className="field"><label htmlFor="app-range-2">Range</label>
                <select id="app-range-2" className="select" value={range} onChange={e => setRange(e.target.value)}>{RANGES.map(v => <option key={v}>{v}</option>)}</select></div>
              <div className="field" style={{ minWidth: 220 }}><label htmlFor="app-strategy-3">Strategy</label>
                <select id="app-strategy-3" className="select" value={strategy} onChange={e => setStrategy(e.target.value)}>{STRATEGIES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              {strategy === "ict" && (
                <>
                  <div className="field"><label htmlFor="app-pre-entry-atr-4">Pre-Entry ATR</label>
                    <input id="app-pre-entry-atr-4" className="input" type="number" step="0.1" style={{ width: 90 }} value={cfg.preEntryATR} onChange={e => setCfg(c => ({ ...c, preEntryATR: +e.target.value }))} /></div>
                  <div className="field"><label htmlFor="app-trend-filter-5">Trend Filter</label>
                    <select id="app-trend-filter-5" className="select" value={cfg.requireTrend ? "1" : "0"} onChange={e => setCfg(c => ({ ...c, requireTrend: e.target.value === "1" }))}><option value="1">On</option><option value="0">Off</option></select></div>
                  <div className="field"><label htmlFor="app-killzone-only-6">Killzone Only</label>
                    <select id="app-killzone-only-6" className="select" value={cfg.requireSession ? "1" : "0"} onChange={e => setCfg(c => ({ ...c, requireSession: e.target.value === "1" }))}><option value="0">Off</option><option value="1">On</option></select></div>
                </>
              )}
              {(strategy === "ema_cross" || strategy === "combined") && (
                <>
                  <div className="field"><label htmlFor="app-ema-fast-7">EMA Fast</label><input id="app-ema-fast-7" className="input" type="number" style={{ width: 80 }} value={cfg.emaFastPeriod} onChange={e => setCfg(c => ({ ...c, emaFastPeriod: +e.target.value }))} /></div>
                  <div className="field"><label htmlFor="app-ema-slow-8">EMA Slow</label><input id="app-ema-slow-8" className="input" type="number" style={{ width: 80 }} value={cfg.emaSlowPeriod} onChange={e => setCfg(c => ({ ...c, emaSlowPeriod: +e.target.value }))} /></div>
                </>
              )}
              <div className="field"><label htmlFor="app-qty-9">Qty</label><input id="app-qty-9" className="input" type="number" min={1} style={{ width: 70 }} value={qty} onChange={e => setQty(+e.target.value)} /></div>
              <div className="field" style={{ justifyContent: "flex-end" }}>
                <button className="btn btn-primary" onClick={analyze} disabled={loading}><Activity size={15} aria-hidden="true" />{loading ? "Analyzing…" : "Analyze"}</button>
              </div>
            </div>
          )}

          {err && <div className="err" role="alert">{err}</div>}

          <div className="split">
            <div className="chart-col">
              {tab === "chart" && (
                <>
                  <div className="chart-wrap">
                    {data ? <Chart data={data} showICT={strategy === "ict"} livePrice={isLiveSym ? livePx : null} theme={theme} /> : <div className="loading" role="status" aria-live="polite">{loading ? "Loading market data…" : "Select an instrument"}</div>}
                  </div>
                  {data && (
                    <div className="trade-bar">
                      <button className="btn btn-green" onClick={() => executeTrade("BUY")}><ArrowUpRight size={15} aria-hidden="true" />BUY {qty} @ {fmt(livePx)}</button>
                      <button className="btn btn-red" onClick={() => executeTrade("SELL")}><ArrowDownRight size={15} aria-hidden="true" />SELL {qty} @ {fmt(livePx)}</button>
                      <span className="muted mono" style={{ fontSize: 11, marginLeft: "auto" }}>{data.signal?.reason}</span>
                    </div>
                  )}
                </>
              )}

              {tab === "performance" && <PerformanceView stats={stats} onRefresh={loadStats} />}

              {tab === "backtest" && (
                <BacktestView cfg={btCfg} setCfg={setBtCfg} result={btResult} loading={btLoading}
                  onRun={runBt} symbol={curName} interval={interval} range={range}
                  strategy={btStrategy} setStrategy={setBtStrategy}
                  formula={btFormula} setFormula={setBtFormula}
                  strategyName={(STRATEGIES.find(x => x.id === btStrategy) || {}).name}
                  mode={btMode} setMode={setBtMode} pine={btPine} setPine={setBtPine}
                  view={btView} setView={setBtView} theme={theme}
                  execOpen={execOpen} setExecOpen={setExecOpen}
                  robustRes={robustRes} robustBusy={robustBusy} robustErr={robustErr} onRunRobust={runRobust} />
              )}

              {tab === "optimizer" && (
                <Optimizer symbol={symbol} interval={interval} range={range}
                  strategy={btStrategy} formula={btFormula} mode={btMode} pine={btPine}
                  execCfg={btCfg} theme={theme} />
              )}

              {tab === "portfolio" && (
                <PortfolioBacktest instruments={instruments} interval={interval} range={range}
                  strategy={btStrategy} formula={btFormula} mode={btMode} pine={btPine}
                  execCfg={btCfg} theme={theme} />
              )}

              {tab === "forward" && (
                <ForwardTest symbol={symbol} symbolName={curName} interval={interval} range={range}
                  strategy={btStrategy} strategyName={(STRATEGIES.find(x => x.id === btStrategy) || {}).name}
                  mode={btMode} pine={btPine} formula={btFormula} execCfg={btCfg} theme={theme} />
              )}

              {tab === "signals" && (
                <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Recent signals (scrollable)">
                  <table className="tbl">
                    <thead><tr><th scope="col">Time</th><th scope="col">Symbol</th><th scope="col">Signal</th><th scope="col">Price</th><th scope="col">Strategy</th><th scope="col">Reason</th></tr></thead>
                    <tbody>{signals.map(s => (
                      <tr key={s.id}>
                        <td className="mono dim">{new Date(s.created_at).toLocaleTimeString()}</td>
                        <td>{s.symbol.replace(".NS", "")}</td>
                        <td><span className={`sig ${s.signal}`}>{s.signal}</span></td>
                        <td className="mono">{fmt(s.price)}</td>
                        <td className="muted">{s.strategy}</td>
                        <td className="muted" style={{ fontSize: 12 }}>{s.reason}</td>
                      </tr>))}
                    </tbody>
                  </table>
                </div>
              )}

              {tab === "trades" && (
                <div className="tbl-wrap">
                  <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                    <button className="btn btn-ghost btn-sm" onClick={loadTrades}>Refresh</button>
                    <button className="btn btn-ghost btn-sm" onClick={resetPf}><Trash2 size={13} aria-hidden="true" />Reset Portfolio</button>
                  </div>
                  <table className="tbl">
                    <thead><tr><th scope="col">#</th><th scope="col">Symbol</th><th scope="col">Side</th><th scope="col">Qty</th><th scope="col">Entry</th><th scope="col">Exit / Now</th><th scope="col">P&L</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                    <tbody>{trades.map(t => {
                      const isOpen = t.status === "OPEN";
                      const cur = isOpen ? (priceFor(t.symbol) ?? t.entry_price) : t.exit_price;
                      const pnl = isOpen ? (t.side === "BUY" ? (cur - t.entry_price) * t.quantity : (t.entry_price - cur) * t.quantity) : t.pnl;
                      return (
                        <tr key={t.id}>
                          <td className="mono dim">{t.id}</td>
                          <td>{t.symbol.replace(".NS", "")}</td>
                          <td className={t.side === "BUY" ? "green" : "red"} style={{ fontWeight: 700 }}>{t.side}</td>
                          <td className="mono">{t.quantity}</td>
                          <td className="mono">{fmt(t.entry_price)}</td>
                          <td className="mono">{cur ? fmt(cur) : "—"}</td>
                          <td className={`mono ${pnl > 0 ? "green" : pnl < 0 ? "red" : ""}`} style={{ fontWeight: 600 }}>{pnl != null ? (pnl >= 0 ? "+" : "") + fmt(pnl) : "—"}</td>
                          <td><span className={`sig ${isOpen ? "NEUTRAL" : "BUY"}`} style={{ fontSize: 10 }}>{t.status}</span></td>
                          <td>{isOpen && <button className="btn btn-ghost btn-sm" onClick={() => closePos(t)}>Close</button>}</td>
                        </tr>);
                    })}
                    </tbody>
                  </table>
                  {!trades.length && <div className="empty" role="status"><History size={32} aria-hidden="true" /><span>No trades yet — execute one from the Chart tab</span></div>}
                </div>
              )}

              {tab === "alerts" && (
                <div className="tbl-wrap">
                  <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => api.markAlertsRead().then(loadAlerts)}>Mark all read</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => api.clearAlerts().then(loadAlerts)}><Trash2 size={13} aria-hidden="true" />Clear</button>
                  </div>
                  {alerts.map(a => (
                    <div key={a.id} className={`alert-item ${a.read ? "" : "unread"}`}>
                      <div className={`alert-icon ${a.signal}`}>{a.signal === "BUY" ? <ArrowUpRight size={18} aria-hidden="true" /> : <ArrowDownRight size={18} aria-hidden="true" />}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <strong>{a.signal} · {a.symbol.replace(".NS", "")}</strong>
                          <span className="dim mono" style={{ fontSize: 11 }}>{new Date(a.created_at).toLocaleTimeString()}</span>
                        </div>
                        <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>{a.reason}</div>
                        <span className="dim" style={{ fontSize: 10.5 }}>{a.kind} · {a.strategy} · {fmt(a.price)}</span>
                      </div>
                    </div>
                  ))}
                  {!alerts.length && <div className="empty" role="status"><Bell size={32} aria-hidden="true" /><span>No alerts yet</span></div>}
                </div>
              )}

              {tab === "config" && (
                <div className="tbl-wrap" style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 640 }}>
                  <div className="card">
                    <div className="card-h">Saved session</div>
                    <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                      Your active tab, symbol, interval, range, strategy and every execution setting are
                      saved in this browser and restored on reload. Nothing is sent anywhere.
                    </p>
                    <button className="btn btn-ghost btn-sm" onClick={() => {
                      clearPersisted();
                      toast("Saved inputs cleared — reload to see defaults", "ok");
                    }}>
                      <Trash2 size={13} aria-hidden="true" /> Clear saved inputs
                    </button>
                  </div>
                  <BrokerFeed />
                  <div className="card">
                    <div className="card-h">Strategy Parameters</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      {[["rsiPeriod", "RSI Period"], ["rsiOverbought", "RSI Overbought"], ["rsiOversold", "RSI Oversold"], ["emaFastPeriod", "EMA Fast"], ["emaSlowPeriod", "EMA Slow"], ["preEntryATR", "Pre-Entry ATR ×"]].map(([k, l]) => (
                        <div className="field" key={k}><label htmlFor={`sp-${k}`}>{l}</label><input id={`sp-${k}`} className="input" type="number" step={k === "preEntryATR" ? "0.1" : "1"} value={cfg[k]} onChange={e => setCfg(c => ({ ...c, [k]: +e.target.value }))} /></div>
                      ))}
                    </div>
                  </div>
                  <div className="card">
                    <div className="card-h">Custom Formula</div>
                    <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Variables: <code className="mono">close, emaFast, emaSlow, rsi, macd, macdSignal, macdHist</code>. Return <code className="mono">"BUY"</code> / <code className="mono">"SELL"</code> / <code className="mono">"NEUTRAL"</code>.</p>
                    <textarea id="cfg-formula" aria-label="Custom signal formula" className="input" rows={3} style={{ width: "100%", fontFamily: "JetBrains Mono", fontSize: 12 }} value={formula} onChange={e => setFormula(e.target.value)} />
                    <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={() => { setStrategy("custom"); analyze(); }}>Apply Formula</button>
                  </div>
                  <div className="card">
                    <div className="card-h">Price Alert Rules · {curName}</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 12 }}>
                      <div className="field"><label htmlFor="app-condition-11">Condition</label><select id="app-condition-11" className="select" value={newRule.condition} onChange={e => setNewRule(r => ({ ...r, condition: e.target.value }))}><option value="above">Price Above</option><option value="below">Price Below</option></select></div>
                      <div className="field"><label htmlFor="app-price-12">Price</label><input id="app-price-12" className="input" type="number" value={newRule.price} onChange={e => setNewRule(r => ({ ...r, price: e.target.value }))} placeholder={fmt(lastPx)} /></div>
                      <button className="btn btn-primary" onClick={addRule}>Add Alert</button>
                    </div>
                    {rules.map(r => (
                      <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--border)" }}>
                        <span style={{ fontSize: 13 }}>{r.symbol.replace(".NS", "")} <span className="muted">{r.condition}</span> <span className="mono">{fmt(r.price)}</span></span>
                        <button className="btn btn-ghost btn-sm" onClick={() => api.deleteAlertRule(r.id).then(loadRules)}><Trash2 size={12} aria-hidden="true" /></button>
                      </div>
                    ))}
                    {!rules.length && <span className="dim" style={{ fontSize: 12 }}>No active price alerts</span>}
                  </div>
                </div>
              )}
            </div>

            {tab === "chart" && (
            <aside className="panel">
              <div className="panel-sec">
                <div className="panel-title">Live Signal</div>
                {data?.signal ? (
                  <div className={`sig-card ${data.signal.signal === "BUY" ? "buy" : data.signal.signal === "SELL" ? "sell" : ""}`}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span className={`sig ${data.signal.signal}`}>{data.signal.signal}</span>
                      <span className="mono" style={{ fontSize: 17, fontWeight: 800 }}>{fmt(livePx)}</span>
                    </div>
                    <div className="sig-reason">{data.signal.reason}</div>
                  </div>
                ) : <span className="dim" style={{ fontSize: 12 }}>—</span>}
              </div>

              <div className="panel-sec">
                <div className="panel-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span><Bot size={12} style={{ verticalAlign: -1 }} /> AI Signal {aiProv ? `\u00b7 ${aiProv === "deepseek" ? "DeepSeek" : "Claude"}` : ""}</span>
                </div>
                <button className="btn btn-primary" style={{ width: "100%" }} onClick={runAISignal} disabled={aiLoading || !data}>
                  <Sparkles size={15} aria-hidden="true" />{aiLoading ? "Analyzing market\u2026" : "Generate AI Signal"}
                </button>
                {!aiProv && <div className="dim" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.4 }}>No AI key set. Add <code className="mono">DEEPSEEK_API_KEY</code> or <code className="mono">ANTHROPIC_API_KEY</code> to <code className="mono">server/.env</code>.</div>}
                {aiSig && (
                  <div className={`sig-card ${aiSig.signal === "BUY" ? "buy" : aiSig.signal === "SELL" ? "sell" : ""}`} style={{ marginTop: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span className={`sig ${aiSig.signal}`}>{aiSig.signal}</span>
                      <span className="mono lime" style={{ fontSize: 13, fontWeight: 700 }}>{aiSig.confidence}% conf</span>
                    </div>
                    <div className="ict-grid" style={{ marginTop: 10 }}>
                      <div className="ict-row"><span className="k">Entry</span><span className="v">{fmt(aiSig.entry)}</span></div>
                      <div className="ict-row"><span className="k">Stop Loss</span><span className="v red">{fmt(aiSig.stopLoss)}</span></div>
                      <div className="ict-row"><span className="k">Target</span><span className="v green">{fmt(aiSig.target)}</span></div>
                      <div className="ict-row"><span className="k">Risk : Reward</span><span className="v">1 : {aiSig.riskReward}</span></div>
                      <div className="ict-row"><span className="k">Horizon</span><span className="v">{aiSig.timeframe}</span></div>
                    </div>
                    <div className="sig-reason">{aiSig.rationale}</div>
                    {aiSig.keyLevels && <div className="dim" style={{ fontSize: 11, marginTop: 6 }}>Levels: {aiSig.keyLevels}</div>}
                  </div>
                )}
              </div>

              {ict && (
                <div className="panel-sec">
                  <div className="panel-title"><Target size={12} aria-hidden="true" style={{ verticalAlign: -1 }} /> ICT Dashboard</div>
                  <div className="ict-grid">
                    <div className="ict-row"><span className="k">Trend</span><span className={`v ${ict.trend === "Up Trend" ? "green" : ict.trend === "Down Trend" ? "red" : "muted"}`}>{ict.trend}</span></div>
                    <div className="ict-row"><span className="k">Last BoS</span><span className={`v ${ict.lastBoS.includes("Bull") ? "green" : ict.lastBoS.includes("Bear") ? "red" : ""}`}>{ict.lastBoS}</span></div>
                    <div className="ict-row"><span className="k">Killzone</span><span className={`v ${ict.inKillzone ? "green" : "muted"}`}>{ict.killzone || "Off-Session"}</span></div>
                    <div className="ict-row"><span className="k">NSE Session</span><span className={`v ${ict.nseOpen ? "green" : "muted"}`}>{ict.nseOpen ? "Open" : "Closed"}</span></div>
                    <div className="ict-row"><span className="k">Demand OB</span><span className="v green">{ict.activeDemand ? fmt(ict.activeDemand.proximal) : "None"}</span></div>
                    <div className="ict-row"><span className="k">Supply OB</span><span className="v red">{ict.activeSupply ? fmt(ict.activeSupply.proximal) : "None"}</span></div>
                    <div className="ict-row"><span className="k">Long Score</span><ScoreBar n={ict.confluenceLong} color="g" /></div>
                    <div className="ict-row"><span className="k">Short Score</span><ScoreBar n={ict.confluenceShort} color="r" /></div>
                    <div className="ict-row"><span className="k">ATR(14)</span><span className="v">{fmt(ict.atr)}</span></div>
                  </div>
                </div>
              )}

              {data?.signal?.indicators && !ict && (
                <div className="panel-sec">
                  <div className="panel-title"><Layers size={12} aria-hidden="true" style={{ verticalAlign: -1 }} /> Indicators</div>
                  <div className="ict-grid">
                    {Object.entries(data.signal.indicators).map(([k, v]) => (
                      <div className="ict-row" key={k}><span className="k">{k}</span><span className="v">{typeof v === "number" ? fmt(v) : String(v)}</span></div>
                    ))}
                  </div>
                </div>
              )}

              <div className="panel-sec">
                <div className="panel-title"><Clock size={12} aria-hidden="true" style={{ verticalAlign: -1 }} /> Open Positions ({posWithLive.length})</div>
                {posWithLive.length ? posWithLive.map(t => (
                  <div className="pos-card" key={t.id}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span className={t.side === "BUY" ? "green" : "red"} style={{ fontWeight: 700 }}>{t.side} {t.quantity}</span>
                      <span className="mono" style={{ fontSize: 11 }}>{t.symbol.replace(".NS", "")}</span>
                    </div>
                    <div className="mono dim" style={{ fontSize: 11, marginBottom: 4 }}>Entry {fmt(t.entry_price)} · Now {fmt(t.currentPrice)}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span className={`mono ${t.unrealized >= 0 ? "green" : "red"}`} style={{ fontSize: 13, fontWeight: 700 }}>{t.unrealized >= 0 ? "+" : ""}{fmt(t.unrealized)}</span>
                      <span className={`mono ${t.pctChg >= 0 ? "green" : "red"}`} style={{ fontSize: 11, fontWeight: 600 }}>{t.pctChg >= 0 ? "+" : ""}{t.pctChg.toFixed(2)}%</span>
                    </div>
                    <button className="btn btn-ghost btn-sm" style={{ width: "100%", marginTop: 8 }} onClick={() => closePos(t)}>Close @ {fmt(t.currentPrice)}</button>
                  </div>
                )) : <span className="dim" style={{ fontSize: 12 }}>No open positions</span>}
              </div>
            </aside>
            )}
          </div>
          </div>
        </main>
      </div>

      <footer className="footer">
        <div className="stat"><label>Cash</label><span className="v mono">{inr(portfolio?.balance)}</span></div>
        <div className="stat"><label>Equity</label><span className="v mono">{inr(equity)}</span></div>
        <div className="stat"><label>Open</label><span className="v mono">{posWithLive.length}</span></div>
        <div className="stat"><label>Unrealized</label><span className={`v mono ${unrealizedTotal >= 0 ? "green" : "red"}`}>{inrSigned(unrealizedTotal)}</span></div>
        <div className="stat"><label>Realized</label><span className={`v mono ${closedPnl >= 0 ? "green" : "red"}`}>{inrSigned(closedPnl)}</span></div>
        <span className="dim" style={{ fontSize: 10.5, marginLeft: "auto" }}>Live tick 1s · Indices 3s · Yahoo delayed for stocks · ICT engine (Pine v5 port)</span>
      </footer>

      {drawer && (
        <>
          <div className="drawer-overlay" onClick={() => setDrawer(false)} aria-hidden="true" />
          <div className="drawer">
            <div className="drawer-h">
              <strong style={{ display: "flex", alignItems: "center", gap: 8 }}><Bell size={17} aria-hidden="true" /> Alerts</strong>
              <button className="bell" style={{ width: 34, height: 34 }} onClick={() => setDrawer(false)}><X size={16} aria-hidden="true" /></button>
            </div>
            <div className="drawer-body">
              {alerts.map(a => (
                <div key={a.id} className={`alert-item ${a.read ? "" : "unread"}`}>
                  <div className={`alert-icon ${a.signal}`}>{a.signal === "BUY" ? <ArrowUpRight size={18} aria-hidden="true" /> : <ArrowDownRight size={18} aria-hidden="true" />}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <strong>{a.signal} · {a.symbol.replace(".NS", "")}</strong>
                      <span className="dim mono" style={{ fontSize: 11 }}>{new Date(a.created_at).toLocaleTimeString()}</span>
                    </div>
                    <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>{a.reason}</div>
                  </div>
                </div>
              ))}
              {!alerts.length && <div className="empty" role="status"><Bell size={32} aria-hidden="true" /><span>No alerts yet</span></div>}
            </div>
          </div>
        </>
      )}
      {showKbd && <ShortcutHelp rows={SHORTCUTS} onClose={() => setShowKbd(false)} />}
    </>
  );
}

function ScoreBar({ n, color }) {
  return <span className="score-bar">{[0,1,2,3,4].map(i => <span key={i} className={`score-dot ${i < n ? "on-" + color : ""}`} />)}</span>;
}

function PerformanceView({ stats, onRefresh }) {
  if (!stats) return <div className="loading" role="status" aria-live="polite">Loading stats…</div>;
  const o = stats.overall;
  if (o.totalTrades === 0) return (
    <div className="empty" role="status"><BarChart3 size={40} aria-hidden="true" /><span>No closed trades yet</span><span className="dim" style={{ fontSize: 12 }}>Close positions from Chart or Trades tab to see performance</span></div>
  );

  const R = 74, C = 2 * Math.PI * R;
  const winFrac = o.winRate / 100;

  return (
    <div className="perf-wrap">
      <div className="perf-top">
        <div className="ring-card">
          <div className="panel-title">Win Rate</div>
          <div className="ring">
            <svg width="176" height="176" viewBox="0 0 176 176">
              <circle cx="88" cy="88" r={R} fill="none" stroke="var(--bg-2)" strokeWidth="14" />
              <circle cx="88" cy="88" r={R} fill="none" stroke="var(--accent)" strokeWidth="14" strokeLinecap="round"
                strokeDasharray={`${C * winFrac} ${C}`} />
            </svg>
            <div className="ring-center">
              <div className="big lime">{(o.winRate ?? 0).toFixed(1)}%</div>
              <div className="lbl">Win Rate</div>
            </div>
          </div>
          <div className="ring-legend">
            <div><span className="n green">{o.wins}</span><span className="t">Wins</span></div>
            <div><span className="n red">{o.losses}</span><span className="t">Losses</span></div>
            <div><span className="n">{o.totalTrades}</span><span className="t">Total</span></div>
          </div>
        </div>

        <div>
          <div className="metric-grid">
            <div className="metric"><div className="m-lbl">Net P&L</div><div className={`m-val ${o.netPnl >= 0 ? "green" : "red"}`}>{inrSigned(o.netPnl)}</div><div className="m-sub">Across all closed trades</div></div>
            <div className="metric"><div className="m-lbl">Profit Factor</div><div className={`m-val ${o.profitFactor >= 1 ? "green" : "red"}`}>{ratio(o.profitFactor)}</div><div className="m-sub">Gross profit ÷ gross loss</div></div>
            <div className="metric"><div className="m-lbl">P&L Ratio</div><div className={`m-val ${o.plRatio >= 1 ? "green" : "red"}`}>{ratio(o.plRatio)}</div><div className="m-sub">Avg win ÷ avg loss</div></div>
            <div className="metric"><div className="m-lbl">Avg Win</div><div className="m-val green">+{fmt(o.avgWin)}</div><div className="m-sub">Per winning trade</div></div>
            <div className="metric"><div className="m-lbl">Avg Loss</div><div className="m-val red">−{fmt(o.avgLoss)}</div><div className="m-sub">Per losing trade</div></div>
            <div className="metric"><div className="m-lbl">Expectancy</div><div className={`m-val ${o.expectancy >= 0 ? "green" : "red"}`}>{o.expectancy >= 0 ? "+" : ""}{fmt(o.expectancy)}</div><div className="m-sub">Per-trade average</div></div>
            <div className="metric"><div className="m-lbl">Best Trade</div><div className="m-val green">+{fmt(o.bestTrade)}</div><div className="m-sub">Largest winner</div></div>
            <div className="metric"><div className="m-lbl">Worst Trade</div><div className="m-val red">{fmt(o.worstTrade)}</div><div className="m-sub">Largest loser</div></div>
            <div className="metric"><div className="m-lbl">Gross Profit</div><div className="m-val">{fmt(o.grossProfit)}</div><div className="m-sub">Sum of wins</div></div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-h" style={{ display: "flex", justifyContent: "space-between" }}>
          <span><Award size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Strategy Performance</span>
          <button className="btn btn-ghost btn-sm" onClick={onRefresh}>Refresh</button>
        </div>
        {stats.strategies.length === 0 && <span className="dim">No strategy data yet</span>}
        <div className="strat-list">
          {stats.strategies.map(s => {
            const total = s.wins + s.losses;
            const winPct = total ? (s.wins / total) * 100 : 0;
            const lossPct = total ? (s.losses / total) * 100 : 0;
            return (
              <div key={s.strategy} className="strat-row">
                <div className="s-head">
                  <div>
                    <span className="s-name">{s.strategy}</span>
                    <span className="s-meta"> · {s.totalTrades} trades · {(s.winRate ?? 0).toFixed(1)}% win · PF {ratio(s.profitFactor)}</span>
                  </div>
                  <span className={`s-pnl ${s.netPnl >= 0 ? "green" : "red"}`}>{inrSigned(s.netPnl)}</span>
                </div>
                <div className="bar-track">
                  <div className="bar-fill g" style={{ width: `${winPct}%` }} />
                  <div className="bar-fill r" style={{ width: `${lossPct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}


function BacktestView({ cfg, setCfg, result, loading, onRun, symbol, strategy, setStrategy, formula, setFormula, interval, range, strategyName, mode, setMode, pine, setPine, view, setView, theme, execOpen, setExecOpen, robustRes, robustBusy, robustErr, onRunRobust }) {
  const set = (k, v) => setCfg(c => ({ ...c, [k]: v }));
  const m = result?.metrics;
  const pf = ratio;

  return (
    <div className="bt-wrap">
      <div className="card bt-controls">
        <div className="card-h"><FlaskConical size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Backtest Setup</div>
        <div className="bt-meta-line">
          <span>{symbol}</span><span className="dot">·</span>
          <span>{mode === "pine" ? "Pine Script" : (strategyName || strategy)}</span><span className="dot">·</span>
          <span>{interval}</span><span className="dot">·</span>
          <span>{range}</span>
          <span className="dim" style={{ marginLeft: "auto", fontSize: 11 }}>Symbol / interval / range set in the top bar</span>
        </div>
        <div className="bt-modes" role="radiogroup" aria-label="Signal source">
          <button type="button" role="radio" aria-checked={mode === "builtin"} className={`bt-mode ${mode === "builtin" ? "active" : ""}`} onClick={() => setMode("builtin")}><Sliders size={13} aria-hidden="true" /> Built-in Strategy</button>
          <button type="button" role="radio" aria-checked={mode === "pine"} className={`bt-mode ${mode === "pine" ? "active" : ""}`} onClick={() => setMode("pine")}><Code2 size={13} aria-hidden="true" /> Pine Script</button>
        </div>
        {mode === "builtin" && (
          <div className="bt-strat-pick">
            <label htmlFor="bt-strategy"><Gauge size={12} aria-hidden="true" style={{ verticalAlign: -2 }} /> Strategy</label>
            <select id="bt-strategy" className="select" value={strategy} onChange={e => setStrategy(e.target.value)}>
              {STRATEGIES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <span className="dim">Choose the built-in strategy to backtest — independent of the Chart tab.</span>
          </div>
        )}
        {mode === "builtin" && strategy === "custom" && (
          <div className="pine-box">
            <div className="pine-head">
              <span className="pine-lbl"><Code2 size={12} /> Custom Formula <span className="dim">(JS expression, evaluated on every bar)</span></span>
              <select className="select pine-ex" aria-label="Load a formula example" value="" onChange={e => { const ex = FORMULA_EXAMPLES.find(x => x.name === e.target.value); if (ex) setFormula(ex.code); }}>
                <option value="">Load example…</option>
                {FORMULA_EXAMPLES.map(ex => <option key={ex.name} value={ex.name}>{ex.name}</option>)}
              </select>
            </div>
            <textarea className="pine-editor formula-editor" rows={3} spellCheck={false}
              value={formula} onChange={e => setFormula(e.target.value)}
              placeholder={'rsi < 30 ? "BUY" : rsi > 70 ? "SELL" : "NEUTRAL"'} />
            <div className="formula-help">
              Return <code>"BUY"</code>, <code>"SELL"</code> or <code>"NEUTRAL"</code> — a bare boolean also works (<code>true</code> → BUY).
              Every <code>prev*</code> variable is the previous bar, so crossovers work:
              <code>emaFast &gt; emaSlow &amp;&amp; prevEmaFast &lt;= prevEmaSlow</code>
            </div>
            <div className="formula-vars">
              {FORMULA_VARS.map(v => <span key={v} className="fvar" onClick={() => setFormula(f => f + v)} title="Click to append">{v}</span>)}
            </div>
          </div>
        )}
        {mode === "pine" && (
          <div className="pine-box">
            <div className="pine-head">
              <span className="pine-lbl"><Code2 size={12} /> Pine Script v5 <span className="dim">(subset)</span></span>
              <select className="select pine-ex" aria-label="Load a Pine Script example" value="" onChange={e => { const ex = PINE_EXAMPLES.find(x => x.name === e.target.value); if (ex) setPine(ex.code); }}>
                <option value="">Load example…</option>
                {PINE_EXAMPLES.map(ex => <option key={ex.name} value={ex.name}>{ex.name}</option>)}
              </select>
            </div>
            <textarea className="pine-editor" spellCheck={false} value={pine} onChange={e => setPine(e.target.value)}
              placeholder="Paste your Pine v5 strategy here…" />
            <div className="dim pine-note">
              Supports <code>ta.*</code>, <code>input.*</code>, <code>math.*</code>, <code>strategy.entry/close/exit</code>, series history <code>[n]</code>, <code>var</code>, <code>:=</code>, ternary and tuple destructuring.
              Higher-timeframe <code>request.security(syminfo.tickerid, "60", …)</code> <b>is</b> supported — the chart symbol is resampled into HTF bars and only fully closed HTF bars are used unless you pass <code>barmerge.lookahead_on</code>.
              Needs at least one <code>strategy.entry</code> or <code>strategy.close</code>.
              Not supported: cross-symbol <code>request.security</code>, drawings (line/label/box/table), <code>for</code>/<code>while</code>, user-defined functions.
            </div>
          </div>
        )}
        <div className="bt-form bt-form-2">
          <div className="field"><label htmlFor="app-initial-capital-13">Initial Capital (₹)</label><input id="app-initial-capital-13" className="input" type="number" step="10000" value={cfg.initialCapital} onChange={e => set("initialCapital", +e.target.value)} /></div>
          <div className="field">
            <label htmlFor="app-direction-14">Direction</label>
            <select id="app-direction-14" className="select" value={cfg.allowShort ? "yes" : "no"} onChange={e => set("allowShort", e.target.value === "yes")}>
              <option value="yes">Long + Short</option>
              <option value="no">Long only</option>
            </select>
          </div>
          <div className="field" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-primary" style={{ width: "100%" }} onClick={onRun} disabled={loading}>
              <Play size={15} aria-hidden="true" />{loading ? "Running…" : "Run Backtest"}
            </button>
          </div>
        </div>
        <ExecutionPanel cfg={cfg} set={set} open={execOpen} setOpen={setExecOpen} />
        {result?.meta?.strategyNote && <div className="dim" style={{ fontSize: 11.5, marginTop: 8 }}>{result.meta.strategyNote}</div>}
        {result?.meta?.pine?.inputs?.length > 0 && <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>Detected inputs: {result.meta.pine.inputs.map(i => `${i.name}=${i.def}`).join(" · ")}</div>}
        {result?.meta?.pine?.securityCalls?.length > 0 && <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>Higher-timeframe requests resampled: {result.meta.pine.securityCalls.map(c => `${c.timeframe}${c.lookahead === "on" ? " (lookahead)" : ""}`).join(" · ")}</div>}
      </div>

      {!result && !loading && (
        <div className="empty" role="status"><FlaskConical size={40} aria-hidden="true" /><span>No backtest run yet</span><span className="dim" style={{ fontSize: 12 }}>Configure above and hit Run Backtest to simulate this strategy over history</span></div>
      )}
      {loading && <div className="loading" role="status" aria-live="polite">Simulating {range} of {interval} candles…</div>}

      {result && m && (
        <>
          <div className="bt-view-tabs" role="tablist" aria-label="Backtest result views">
            {[["summary", BarChart3, "Summary", false],
              ["analytics", Gauge, "Analytics", false],
              ["robustness", Shield, "Robustness", false],
              ["replay", Play, "Bar Replay", !result.replay]].map(([id, Ic, label, dis]) => (
              <button key={id} type="button" role="tab" aria-selected={view === id}
                className={`bt-vtab ${view === id ? "active" : ""}`}
                onClick={() => setView(id)} disabled={dis}
                title={dis ? "Re-run the backtest with replay data to enable this" : undefined}>
                <Ic size={13} aria-hidden="true" /> {label}
              </button>
            ))}
          </div>

          <div className="bt-assume">
            <span className="ba-t">Assumptions</span>
            <span className="ba-i">Fills: <b>{result.meta.fillMode === "nextOpen" ? "next bar open" : "signal bar close"}</b></span>
            <span className="ba-i">Costs: <b>{result.meta.chargeLabel || "none"}</b>{result.meta.slipBps ? ` + ${result.meta.slipBps} bps slippage` : ""}</span>
            <span className="ba-i">Sizing: <b>{sizingLabel(result.meta.sizing, cfg)}</b></span>
            {m.totalCharges != null && <span className="ba-i">Total costs paid: <b>{inr(m.totalCharges)}</b></span>}
            {result.meta.rejectedEntries > 0 && <span className="ba-i warn">{result.meta.rejectedEntries} entries skipped ({result.meta.rejectReason || "sizing"})</span>}
          </div>

          {view === "replay" && result.replay
            ? <ReplayPlayer replay={result.replay} theme={theme} />
            : view === "analytics"
            ? <div className="bt-analytics">
                <RiskMetrics m={m} meta={result.meta} />
                <ExcursionPanel ex={result.excursion} />
                <RegimePanel regime={result.regime} />
                <MonthlyPanel monthly={result.monthly} />
              </div>
            : view === "robustness"
            ? <Robustness res={robustRes} busy={robustBusy} err={robustErr} onRun={onRunRobust} symbol={symbol} interval={interval} range={range} />
            : <>
          <div className="metric-grid bt-kpis">
            <div className="metric feature"><div className="m-lbl">Net P&amp;L</div><div className={`m-val ${m.netPnl >= 0 ? "green" : "red"}`}>{inrSigned(m.netPnl)}</div><div className="m-sub">{pctFmt(m.netPnlPct)} on capital</div></div>
            <div className="metric"><div className="m-lbl">vs Buy &amp; Hold</div><div className={`m-val ${m.vsBuyHold >= 0 ? "green" : "red"}`}>{m.vsBuyHold >= 0 ? "+" : ""}{m.vsBuyHold.toFixed(1)}%</div><div className="m-sub">B&amp;H {pctFmt(m.buyHoldPct)}</div></div>
            <div className="metric"><div className="m-lbl">Win Rate</div><div className="m-val lime">{m.winRate.toFixed(1)}%</div><div className="m-sub">{m.wins}W / {m.losses}L</div></div>
            <div className="metric"><div className="m-lbl">Profit Factor</div><div className={`m-val ${m.profitFactor >= 1 ? "green" : "red"}`}>{pf(m.profitFactor)}</div><div className="m-sub">Gross P ÷ gross L</div></div>
            <div className="metric"><div className="m-lbl">Max Drawdown</div><div className="m-val red">−{m.maxDrawdownPct.toFixed(1)}%</div><div className="m-sub">{inr(m.maxDrawdown)} peak-to-trough</div></div>
            <div className="metric"><div className="m-lbl">Total Trades</div><div className="m-val">{m.totalTrades}</div><div className="m-sub">avg {m.avgBars.toFixed(0)} bars held</div></div>
            <div className="metric"><div className="m-lbl">P&amp;L Ratio</div><div className={`m-val ${m.plRatio >= 1 ? "green" : "red"}`}>{pf(m.plRatio)}</div><div className="m-sub">Avg win ÷ avg loss</div></div>
            <div className="metric"><div className="m-lbl">Expectancy</div><div className={`m-val ${m.expectancy >= 0 ? "green" : "red"}`}>{m.expectancy >= 0 ? "+" : ""}{fmt(m.expectancy)}</div><div className="m-sub">Per trade</div></div>
            <div className="metric"><div className="m-lbl">Final Equity</div><div className="m-val">{inr(m.finalEquity)}</div><div className="m-sub">from {inr(result.meta.initialCapital)}</div></div>
          </div>

          <div className="card">
            <div className="card-h"><Gauge size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Equity Curve</div>
            <div className="bt-chart"><EquityChart curve={result.equityCurve} initialCapital={result.meta.initialCapital} theme={theme} /></div>
          </div>

          <div className="card">
            <div className="card-h"><History size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Trades ({result.trades.length} shown)</div>
            <div className="tbl-wrap" style={{ maxHeight: 380, overflow: "auto" }} tabIndex={0} role="region" aria-label="Backtest trade list (scrollable)">
              <table className="tbl">
                <thead><tr><th scope="col">Side</th><th scope="col">Entry</th><th scope="col">Exit</th><th scope="col">Qty</th><th scope="col">Bars</th><th scope="col">Exit Reason</th><th scope="col">P&amp;L</th><th scope="col">%</th></tr></thead>
                <tbody>{result.trades.map((t, i) => (
                  <tr key={i}>
                    <td className={t.side === "BUY" ? "green" : "red"} style={{ fontWeight: 700 }}>{t.side}</td>
                    <td className="mono">{fmt(t.entry)}</td>
                    <td className="mono">{fmt(t.exit)}</td>
                    <td className="mono">{t.qty}</td>
                    <td className="mono dim">{t.bars}</td>
                    <td><span className="sig NEUTRAL" style={{ fontSize: 10 }}>{t.exitReason}</span></td>
                    <td className={`mono ${t.pnl >= 0 ? "green" : "red"}`} style={{ fontWeight: 600 }}>{inrSigned(t.pnl)}</td>
                    <td className={`mono ${t.pnlPct >= 0 ? "green" : "red"}`}>{t.pnlPct >= 0 ? "+" : ""}{t.pnlPct.toFixed(2)}%</td>
                  </tr>))}
                </tbody>
              </table>
              {!result.trades.length && <div className="empty" role="status"><History size={28} aria-hidden="true" /><span>No trades were triggered for this configuration</span></div>}
            </div>
          </div>
          </>}
        </>
      )}
    </div>
  );
}
