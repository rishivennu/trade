import { useEffect, useState, useCallback } from "react";
import { MousePointer2, Slash, ArrowUpRight, Square, Percent, Eraser, X, Trash2 } from "lucide-react";
import { usePersisted, isTyping } from "./ui.jsx";

// Shared TradingView-style drawing tools: trendline / ray / rectangle / fib
// retracement. Used by both the live Chart and Bar Replay so a symbol's
// drawings look and behave identically — and persist — across both views.

export const TOOLS = [
  ["cursor", MousePointer2, "Cursor — pan/zoom the chart"],
  ["trend", Slash, "Trendline"],
  ["ray", ArrowUpRight, "Ray"],
  ["rect", Square, "Rectangle"],
  ["fib", Percent, "Fib retracement"],
];
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
export const TOOL_LABEL = { trend: "Trendline", ray: "Ray", rect: "Rectangle", fib: "Fib retracement" };

// Drawings persist under one storage key shared by every chart surface,
// mapped by symbol so switching instruments (or opening Bar Replay for the
// same instrument) shows the right set without bleeding across symbols.
export function useSymbolDrawings(symbol) {
  const [all, setAll] = usePersisted("chartDrawings", {});
  const drawings = all[symbol] || [];
  const setDrawings = useCallback((updater) => {
    setAll(prev => {
      const cur = prev[symbol] || [];
      const next = typeof updater === "function" ? updater(cur) : updater;
      return { ...prev, [symbol]: next };
    });
  }, [symbol, setAll]);
  return [drawings, setDrawings];
}

// Renders the floating toolbar, the manage-drawings popover, and the
// transparent overlay canvas. Owns tool/pending/selection/list-open state
// internally so callers only need to hand it chart/series/host refs (from
// lightweight-charts) plus the symbol-scoped [drawings, setDrawings] pair.
// `registerRedraw` lets the caller's own chart lifecycle (pan/zoom/resize/
// data-tick) trigger a repaint without this component re-running its own
// effects on every pixel-level change.
export function DrawingLayer({ chartRef, seriesRef, hostRef, drawings, setDrawings, registerRedraw }) {
  const [tool, setTool] = useState("cursor");
  const [pending, setPending] = useState(null); // { type, p1, p2 } while placing the 2nd click
  const [selectedId, setSelectedId] = useState(null);
  const [listOpen, setListOpen] = useState(false);
  const [canvas, setCanvas] = useState(null); // DOM node, via ref callback so redraw can run as soon as it mounts

  const drawOverlay = useCallback(() => {
    const chart = chartRef.current, series = seriesRef.current, host = hostRef.current;
    if (!canvas || !chart || !series || !host) return;
    const w = host.clientWidth, h = host.clientHeight;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);

    const css = getComputedStyle(document.documentElement);
    const cv = (n, fb) => (css.getPropertyValue(n).trim() || fb);
    const accent = cv("--accent-2", "#5b9dff");
    const selColor = cv("--accent", "#c6f24e");
    const txt = cv("--chart-txt", "#97a8c4");

    const toXY = (pt) => ({ x: chart.timeScale().timeToCoordinate(pt.time), y: series.priceToCoordinate(pt.price) });
    const all = pending ? [...drawings, { id: "__pending", type: pending.type, p1: pending.p1, p2: pending.p2 }] : drawings;

    for (const d of all) {
      const a = toXY(d.p1), b = toXY(d.p2);
      if (a.x == null || a.y == null || b.x == null || b.y == null) continue;
      const isSel = d.id === selectedId || d.id === "__pending";
      ctx.save();
      ctx.strokeStyle = isSel ? selColor : accent;
      ctx.lineWidth = isSel ? 2.2 : 1.5;
      ctx.setLineDash(d.id === "__pending" ? [5, 4] : []);

      if (d.type === "trend") {
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      } else if (d.type === "ray") {
        let ex = b.x, ey = b.y;
        if (b.x !== a.x) {
          const dir = b.x > a.x ? 1 : -1;
          const edgeX = dir > 0 ? w : 0;
          const t = (edgeX - a.x) / (b.x - a.x);
          ex = edgeX; ey = a.y + (b.y - a.y) * t;
        }
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(ex, ey); ctx.stroke();
      } else if (d.type === "rect") {
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), rw = Math.abs(b.x - a.x), rh = Math.abs(b.y - a.y);
        ctx.fillStyle = (isSel ? selColor : accent) + "26";
        ctx.fillRect(x, y, rw, rh);
        ctx.strokeRect(x, y, rw, rh);
      } else if (d.type === "fib") {
        const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
        ctx.font = "11px Inter, sans-serif";
        for (const lvl of FIB_LEVELS) {
          const price = d.p1.price + (d.p2.price - d.p1.price) * lvl;
          const y = series.priceToCoordinate(price);
          if (y == null) continue;
          ctx.beginPath(); ctx.moveTo(minX, y); ctx.lineTo(maxX, y); ctx.stroke();
          ctx.fillStyle = txt;
          ctx.fillText(`${(lvl * 100).toFixed(1)}%  ${price.toFixed(2)}`, maxX + 6, y - 3);
        }
      }
      ctx.restore();
    }
  }, [canvas, chartRef, seriesRef, hostRef, drawings, pending, selectedId]);

  useEffect(() => { registerRedraw?.(drawOverlay); }, [drawOverlay, registerRedraw]);
  useEffect(() => { drawOverlay(); }, [drawOverlay]);

  const pxToPoint = (clientX, clientY) => {
    const host = hostRef.current;
    if (!host || !chartRef.current || !seriesRef.current) return null;
    const rect = host.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    const time = chartRef.current.timeScale().coordinateToTime(x);
    const price = seriesRef.current.coordinateToPrice(y);
    if (time == null || price == null) return null;
    return { time, price };
  };

  const onCanvasClick = (e) => {
    if (tool === "cursor") return;
    const pt = pxToPoint(e.clientX, e.clientY);
    if (!pt) return;
    if (!pending) {
      setPending({ type: tool, p1: pt, p2: pt });
    } else {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setDrawings(cur => [...cur, { id, type: pending.type, p1: pending.p1, p2: pt }]);
      setSelectedId(id);
      setPending(null);
      setTool("cursor");
    }
  };
  const onCanvasMove = (e) => {
    if (!pending) return;
    const pt = pxToPoint(e.clientX, e.clientY);
    if (!pt) return;
    setPending(p => (p ? { ...p, p2: pt } : p));
  };

  useEffect(() => {
    const onKey = (e) => {
      if (isTyping()) return;
      if (e.key === "Escape" && (pending || tool !== "cursor")) { setPending(null); setTool("cursor"); }
      else if ((e.key === "Delete" || e.key === "Backspace") && selectedId && !listOpen) {
        setDrawings(cur => cur.filter(d => d.id !== selectedId));
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, tool, selectedId, listOpen, setDrawings]);

  return (
    <>
      <div className="chart-dtools" role="toolbar" aria-label="Drawing tools">
        {TOOLS.map(([id, Icon, label]) => (
          <button key={id} type="button" className={`dtool-btn ${tool === id ? "active" : ""}`}
            aria-pressed={tool === id} title={label} aria-label={label}
            onClick={() => { setTool(id); setPending(null); }}>
            <Icon size={15} aria-hidden="true" />
          </button>
        ))}
        <span className="dtool-sep" aria-hidden="true" />
        <button type="button" className={`dtool-btn ${listOpen ? "active" : ""}`}
          aria-label={`Manage drawings, ${drawings.length} on this chart`} aria-expanded={listOpen}
          onClick={() => setListOpen(v => !v)}>
          <Trash2 size={14} aria-hidden="true" />
          {drawings.length > 0 && <span className="dtool-count">{drawings.length}</span>}
        </button>
      </div>

      {listOpen && (
        <div className="dtool-list" role="dialog" aria-label="Manage drawings">
          <div className="dtool-list-h">
            <span>Drawings on this chart</span>
            <button type="button" className="dtool-x" aria-label="Close" onClick={() => setListOpen(false)}><X size={13} aria-hidden="true" /></button>
          </div>
          {drawings.length === 0
            ? <div className="dtool-empty">Nothing drawn yet — pick a tool above, click once to anchor, click again to place it.</div>
            : <ul className="dtool-items">
                {drawings.map((d, i) => (
                  <li key={d.id} className={selectedId === d.id ? "sel" : ""}>
                    <button type="button" className="dtool-item-name" onClick={() => setSelectedId(d.id)}>
                      {TOOL_LABEL[d.type] || d.type} {i + 1}
                    </button>
                    <button type="button" className="dtool-x" aria-label={`Delete ${TOOL_LABEL[d.type] || d.type} ${i + 1}`}
                      onClick={() => { setDrawings(cur => cur.filter(x => x.id !== d.id)); if (selectedId === d.id) setSelectedId(null); }}>
                      <X size={13} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>}
          {drawings.length > 0 && (
            <button type="button" className="dtool-clear" onClick={() => { setDrawings([]); setSelectedId(null); }}>
              <Eraser size={13} aria-hidden="true" /> Clear all
            </button>
          )}
        </div>
      )}

      <canvas
        ref={setCanvas}
        className="chart-overlay"
        style={{ pointerEvents: tool === "cursor" ? "none" : "auto", cursor: tool === "cursor" ? "default" : "crosshair" }}
        onClick={onCanvasClick}
        onMouseMove={onCanvasMove}
      />
    </>
  );
}
