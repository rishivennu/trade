import { useEffect, useRef } from "react";
import { createChart, CrosshairMode, ColorType } from "lightweight-charts";
import { DrawingLayer, useSymbolDrawings } from "./DrawingTools.jsx";

export default function Chart({ data, showICT, livePrice, theme, symbol }) {
  const ref = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const drawOverlayRef = useRef(() => {});

  const [drawings, setDrawings] = useSymbolDrawings(symbol);

  // ── Chart creation (unchanged behaviour) + wires the overlay redraw into
  //    the chart's own lifecycle so it never points at a destroyed chart. ──
  useEffect(() => {
    if (!ref.current || !data?.candles?.length) return;
    if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }

    const css = getComputedStyle(document.documentElement);
    const cv = (n, fb) => (css.getPropertyValue(n).trim() || fb);
    const cBg = cv("--chart-bg", "#070a11"), cGrid = cv("--chart-grid", "#12172a"),
      cTxt = cv("--chart-txt", "#97a8c4"), cBorder = cv("--border", "#1e2634"),
      cCross = cv("--chart-cross", "#2a3c5e"), cCrossBg = cv("--chart-cross-bg", "#16223a");
    const chart = createChart(ref.current, {
      width: ref.current.clientWidth, height: ref.current.clientHeight,
      layout: { background: { type: ColorType.Solid, color: cBg }, textColor: cTxt, fontSize: 11, fontFamily: "Inter" },
      grid: { vertLines: { color: cGrid }, horzLines: { color: cGrid } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: cCross, labelBackgroundColor: cCrossBg }, horzLine: { color: cCross, labelBackgroundColor: cCrossBg } },
      rightPriceScale: { borderColor: cBorder },
      timeScale: { borderColor: cBorder, timeVisible: true, secondsVisible: false },
    });
    chartRef.current = chart;

    const candle = chart.addCandlestickSeries({
      upColor: "#16d19b", downColor: "#ff5c6c", borderUpColor: "#16d19b",
      borderDownColor: "#ff5c6c", wickUpColor: "#16d19b", wickDownColor: "#ff5c6c",
    });
    seriesRef.current = candle;
    candle.setData(data.candles.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));

    const vol = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol" });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.88, bottom: 0 } });
    vol.setData(data.candles.map(c => ({ time: c.time, value: c.volume, color: c.close >= c.open ? "rgba(22,209,155,.18)" : "rgba(255,92,108,.18)" })));

    const times = data.candles.map(c => c.time);
    const line = (arr, color, width = 1, style = 0, title) => {
      if (!arr) return;
      const s = chart.addLineSeries({ color, lineWidth: width, lineStyle: style, title, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      s.setData(arr.map((v, i) => v != null ? { time: times[i], value: v } : null).filter(Boolean));
      return s;
    };

    if (showICT && data.ict && !data.ict.error) {
      const ict = data.ict;
      if (ict.activeDemand) {
        candle.createPriceLine({ price: ict.activeDemand.proximal, color: "#16d19b", lineWidth: 1, lineStyle: 0, title: "Demand ▲" });
        candle.createPriceLine({ price: ict.activeDemand.distal, color: "rgba(22,209,155,.5)", lineWidth: 1, lineStyle: 2, title: "" });
      }
      if (ict.activeSupply) {
        candle.createPriceLine({ price: ict.activeSupply.proximal, color: "#ff5c6c", lineWidth: 1, lineStyle: 0, title: "Supply ▼" });
        candle.createPriceLine({ price: ict.activeSupply.distal, color: "rgba(255,92,108,.5)", lineWidth: 1, lineStyle: 2, title: "" });
      }
      const markers = [];
      for (const b of (ict.bosEvents || [])) {
        markers.push({ time: b.time, position: b.type === "Bull BoS" ? "belowBar" : "aboveBar",
          color: b.type === "Bull BoS" ? "#16d19b" : "#ff5c6c", shape: b.type === "Bull BoS" ? "arrowUp" : "arrowDown",
          text: b.type === "Bull BoS" ? "BoS↑" : "BoS↓" });
      }
      const seen = new Set(); const uniq = [];
      for (const m of markers.reverse()) { if (!seen.has(m.time)) { seen.add(m.time); uniq.push(m); } }
      uniq.reverse();
      candle.setMarkers(uniq.slice(-40).sort((a,b)=>a.time-b.time));
    } else if (data.indicators) {
      const { emaFast, emaSlow, bbUpper, bbLower, vwap, ppTrail, ppCenter, ppTrend } = data.indicators;
      if (ppTrail) {
        const up = ppTrail.map((v, i) => ppTrend?.[i] === 1 ? v : null);
        const dn = ppTrail.map((v, i) => ppTrend?.[i] === -1 ? v : null);
        line(up, "#16d19b", 2, 0, "PP Trail ↑");
        line(dn, "#ff5c6c", 2, 0, "PP Trail ↓");
        line(ppCenter, "#5aa9ff", 1, 2, "PP Center");
      } else {
        line(emaFast, "#c6f24e", 1.5, 0, "EMA Fast");
        line(emaSlow, "#ffb224", 1.5, 0, "EMA Slow");
      }
      line(bbUpper, "rgba(151,168,196,.3)", 1, 2);
      line(bbLower, "rgba(151,168,196,.3)", 1, 2);
      line(vwap, "#a855f7", 1, 1, "VWAP");
    }

    if (livePrice) {
      candle.createPriceLine({ price: livePrice, color: "#c6f24e", lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: "LIVE" });
    }
    chart.timeScale().fitContent();

    const redraw = () => drawOverlayRef.current();
    const resize = () => { if (ref.current) { chart.applyOptions({ width: ref.current.clientWidth, height: ref.current.clientHeight }); redraw(); } };
    window.addEventListener("resize", resize);
    chart.timeScale().subscribeVisibleTimeRangeChange(redraw);
    requestAnimationFrame(redraw);

    return () => { window.removeEventListener("resize", resize); chart.remove(); chartRef.current = null; seriesRef.current = null; };
  }, [data, showICT, livePrice, theme]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <div ref={ref} style={{ width: "100%", height: "100%" }} />
      <DrawingLayer
        chartRef={chartRef} seriesRef={seriesRef} hostRef={ref}
        drawings={drawings} setDrawings={setDrawings}
        registerRedraw={(fn) => { drawOverlayRef.current = fn; fn(); }}
      />
    </div>
  );
}
