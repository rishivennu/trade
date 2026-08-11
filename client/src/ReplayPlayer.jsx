import { useEffect, useRef, useState, useMemo } from "react";
import { createChart, ColorType, CrosshairMode } from "lightweight-charts";
import { Play, Pause, SkipBack, StepForward, StepBack, Rewind } from "lucide-react";

const inr = (n) => n == null ? "—" : "₹" + Math.round(n).toLocaleString("en-IN");
const inrSigned = (n) => n == null ? "—" : (n >= 0 ? "+" : "−") + "₹" + Math.abs(Math.round(n)).toLocaleString("en-IN");
const SPEEDS = [0.5, 1, 2, 4, 8];

// TradingView-style bar replay. Self-contained: owns playhead, play/pause, speed.
export default function ReplayPlayer({ replay, theme }) {
  const { candles, startIdx, emaFast, emaSlow, trail, center, trades, equity } = replay;
  const n = candles.length;
  const [idx, setIdx] = useState(startIdx);       // current (last visible) bar
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const ref = useRef(null);
  const chartRef = useRef(null);
  const sRef = useRef({});

  // reset when a new replay dataset arrives
  useEffect(() => { setIdx(startIdx); setPlaying(false); }, [replay, startIdx]);

  // build all entry/exit markers once
  const allMarkers = useMemo(() => {
    const m = [];
    for (const t of trades) {
      const isBuy = t.side === "BUY";
      m.push({ idx: t.entryIdx, time: candles[t.entryIdx]?.time, position: isBuy ? "belowBar" : "aboveBar",
        color: isBuy ? "#16d19b" : "#ff5c6c", shape: isBuy ? "arrowUp" : "arrowDown",
        text: isBuy ? "Long" : "Short" });
      if (t.exitIdx != null && candles[t.exitIdx]) {
        const win = t.pnl >= 0;
        m.push({ idx: t.exitIdx, time: candles[t.exitIdx].time, position: isBuy ? "aboveBar" : "belowBar",
          color: win ? "#7fd41b" : "#ff8a3d", shape: "circle", text: (win ? "+" : "") + Math.round(t.pnl).toLocaleString("en-IN") });
      }
    }
    return m.sort((a, b) => a.idx - b.idx);
  }, [trades, candles]);

  // create chart once (rebuild on theme change)
  useEffect(() => {
    if (!ref.current) return;
    const css = getComputedStyle(document.documentElement);
    const cv = (k, fb) => (css.getPropertyValue(k).trim() || fb);
    const chart = createChart(ref.current, {
      width: ref.current.clientWidth, height: ref.current.clientHeight,
      layout: { background: { type: ColorType.Solid, color: cv("--chart-bg", "#070a11") }, textColor: cv("--chart-txt", "#97a8c4"), fontSize: 11, fontFamily: "Inter" },
      grid: { vertLines: { color: cv("--chart-grid", "#12172a") }, horzLines: { color: cv("--chart-grid", "#12172a") } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: cv("--chart-cross", "#2a3c5e"), labelBackgroundColor: cv("--chart-cross-bg", "#16223a") }, horzLine: { color: cv("--chart-cross", "#2a3c5e"), labelBackgroundColor: cv("--chart-cross-bg", "#16223a") } },
      rightPriceScale: { borderColor: cv("--border", "#1e2634") },
      timeScale: { borderColor: cv("--border", "#1e2634"), timeVisible: true, secondsVisible: false },
    });
    chartRef.current = chart;
    const candle = chart.addCandlestickSeries({ upColor: "#16d19b", downColor: "#ff5c6c", borderUpColor: "#16d19b", borderDownColor: "#ff5c6c", wickUpColor: "#16d19b", wickDownColor: "#ff5c6c" });
    const vol = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol" });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    const mkLine = (color, w, style) => chart.addLineSeries({ color, lineWidth: w, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const eF = emaFast ? mkLine("#c6f24e", 1.5, 0) : null;
    const eS = emaSlow ? mkLine("#ffb224", 1.5, 0) : null;
    // Pivot SuperTrend overlays: ATR trail (stepped) + pivot center line (dashed)
    const tr = trail ? chart.addLineSeries({ color: "#16d19b", lineWidth: 2, lineType: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }) : null;
    const ct = center ? mkLine("#5aa9ff", 1, 2) : null;
    sRef.current = { candle, vol, eF, eS, tr, ct, drawnTo: -1 };
    const resize = () => ref.current && chart.applyOptions({ width: ref.current.clientWidth, height: ref.current.clientHeight });
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); chart.remove(); chartRef.current = null; sRef.current = {}; };
  }, [replay, theme]);

  // push data up to idx whenever it changes
  useEffect(() => {
    const s = sRef.current; if (!s.candle) return;
    const hi = idx + 1;
    const slice = candles.slice(0, hi);
    s.candle.setData(slice.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));
    s.vol.setData(slice.map(c => ({ time: c.time, value: c.volume, color: c.close >= c.open ? "rgba(22,209,155,.18)" : "rgba(255,92,108,.18)" })));
    if (s.eF) s.eF.setData(slice.map((c, i) => emaFast[i] != null ? { time: c.time, value: emaFast[i] } : null).filter(Boolean));
    if (s.eS) s.eS.setData(slice.map((c, i) => emaSlow[i] != null ? { time: c.time, value: emaSlow[i] } : null).filter(Boolean));
    if (s.tr) s.tr.setData(slice.map((c, i) => trail[i] != null ? { time: c.time, value: trail[i] } : null).filter(Boolean));
    if (s.ct) s.ct.setData(slice.map((c, i) => center[i] != null ? { time: c.time, value: center[i] } : null).filter(Boolean));
    s.candle.setMarkers(allMarkers.filter(m => m.idx <= idx).map(m => ({ time: m.time, position: m.position, color: m.color, shape: m.shape, text: m.text })));
    chartRef.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, hi - 140), to: hi + 3 });
  }, [idx, candles, emaFast, emaSlow, trail, center, allMarkers]);

  // autoplay
  useEffect(() => {
    if (!playing) return;
    if (idx >= n - 1) { setPlaying(false); return; }
    const t = setTimeout(() => setIdx(i => Math.min(n - 1, i + 1)), 640 / speed);
    return () => clearTimeout(t);
  }, [playing, idx, speed, n]);

  // derived live stats at current playhead
  const closed = trades.filter(t => t.exitIdx != null && t.exitIdx <= idx);
  const open = trades.find(t => t.entryIdx <= idx && (t.exitIdx == null || t.exitIdx > idx));
  const realized = closed.reduce((s, t) => s + t.pnl, 0);
  const wins = closed.filter(t => t.pnl > 0).length;
  const eqPoint = equity[idx - startIdx];
  const price = candles[idx]?.close;
  const openUnreal = open ? (open.side === "BUY" ? price - open.entry : open.entry - price) * open.qty : 0;
  const dt = candles[idx]?.time ? new Date(candles[idx].time * 1000) : null;
  const dateStr = dt ? dt.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

  const step = (d) => { setPlaying(false); setIdx(i => Math.max(startIdx, Math.min(n - 1, i + d))); };
  const atEnd = idx >= n - 1;

  return (
    <div className="replay">
      <div className="replay-kpis">
        <div className="rk"><span className="rk-l">Bar</span><span className="rk-v mono">{idx - startIdx + 1}<span className="dim"> / {n - startIdx}</span></span></div>
        <div className="rk"><span className="rk-l">Date</span><span className="rk-v mono" style={{ fontSize: 12 }}>{dateStr}</span></div>
        <div className="rk"><span className="rk-l">Price</span><span className="rk-v mono">{price != null ? price.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}</span></div>
        <div className="rk"><span className="rk-l">Position</span><span className={`rk-v ${open ? (open.side === "BUY" ? "green" : "red") : "dim"}`}>{open ? `${open.side} @ ${open.entry.toFixed(2)}` : "Flat"}</span></div>
        <div className="rk"><span className="rk-l">Open P&amp;L</span><span className={`rk-v mono ${openUnreal >= 0 ? "green" : "red"}`}>{open ? inrSigned(openUnreal) : "—"}</span></div>
        <div className="rk"><span className="rk-l">Realized</span><span className={`rk-v mono ${realized >= 0 ? "green" : "red"}`}>{inrSigned(realized)}</span></div>
        <div className="rk"><span className="rk-l">Trades</span><span className="rk-v mono">{closed.length}<span className="dim"> · {wins}W</span></span></div>
        <div className="rk"><span className="rk-l">Equity</span><span className="rk-v mono">{eqPoint ? inr(eqPoint.equity) : "—"}</span></div>
      </div>

      <div className="replay-chart" ref={ref} />

      <div className="replay-transport">
        <button className="rbtn" onClick={() => { setPlaying(false); setIdx(startIdx); }} title="Restart"><SkipBack size={16} /></button>
        <button className="rbtn" onClick={() => step(-1)} title="Step back"><StepBack size={16} /></button>
        <button className="rbtn rbtn-play" onClick={() => atEnd ? (setIdx(startIdx), setPlaying(true)) : setPlaying(p => !p)} title={playing ? "Pause" : "Play"}>
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button className="rbtn" onClick={() => step(1)} title="Step forward"><StepForward size={16} /></button>
        <input className="replay-scrub" type="range" min={startIdx} max={n - 1} value={idx}
          onChange={e => { setPlaying(false); setIdx(+e.target.value); }} />
        <div className="replay-speed">
          {SPEEDS.map(sp => (
            <button key={sp} type="button" aria-pressed={speed === sp}
              aria-label={`Replay speed ${sp} times`}
              className={`sp ${speed === sp ? "active" : ""}`} onClick={() => setSpeed(sp)}>{sp}×</button>
          ))}
        </div>
      </div>

      <div className="replay-log">
        <div className="rl-head">Trade Log <span className="dim">({closed.length} closed{open ? " · 1 open" : ""})</span></div>
        <div className="rl-body">
          {open && (
            <div className="rl-row open">
              <span className={`rl-side ${open.side === "BUY" ? "green" : "red"}`}>{open.side}</span>
              <span className="mono">@ {open.entry.toFixed(2)}</span>
              <span className="dim">open</span>
              <span className={`mono ${openUnreal >= 0 ? "green" : "red"}`}>{inrSigned(openUnreal)}</span>
            </div>
          )}
          {closed.slice().reverse().map((t, k) => (
            <div className="rl-row" key={k}>
              <span className={`rl-side ${t.side === "BUY" ? "green" : "red"}`}>{t.side}</span>
              <span className="mono">{t.entry.toFixed(2)} → {t.exit.toFixed(2)}</span>
              <span className="dim">{t.exitReason} · {t.bars ?? (t.exitIdx - t.entryIdx)}b</span>
              <span className={`mono ${t.pnl >= 0 ? "green" : "red"}`}>{inrSigned(t.pnl)}</span>
            </div>
          ))}
          {!closed.length && !open && <div className="dim" style={{ padding: "10px 12px", fontSize: 12 }}>No trades yet — press play or step forward.</div>}
        </div>
      </div>
    </div>
  );
}
