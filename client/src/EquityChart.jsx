import { useEffect, useRef } from "react";
import { createChart, ColorType, CrosshairMode } from "lightweight-charts";

// Equity curve for backtest results. Area series, lime accent, dark OLED bg.
export default function EquityChart({ curve, initialCapital, theme }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current || !curve?.length) return;

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
      timeScale: { borderColor: cBorder, timeVisible: false, secondsVisible: false },
    });

    const area = chart.addAreaSeries({
      lineColor: "#c6f24e", lineWidth: 2,
      topColor: "rgba(198,242,78,.28)", bottomColor: "rgba(198,242,78,.01)",
      priceFormat: { type: "price", precision: 0, minMove: 1 },
    });
    // dedupe by time (lightweight-charts requires ascending unique times)
    const seen = new Set(); const pts = [];
    for (const p of curve) { if (!seen.has(p.time)) { seen.add(p.time); pts.push({ time: p.time, value: Math.round(p.equity) }); } }
    area.setData(pts);

    if (initialCapital) {
      area.createPriceLine({ price: initialCapital, color: "rgba(151,168,196,.5)", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "Start" });
    }
    chart.timeScale().fitContent();
    const resize = () => ref.current && chart.applyOptions({ width: ref.current.clientWidth, height: ref.current.clientHeight });
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); chart.remove(); };
  }, [curve, initialCapital, theme]);

  return <div ref={ref} style={{ width: "100%", height: "100%" }} />;
}
