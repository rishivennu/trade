import { useState, useEffect, useMemo } from "react";
import { api } from "./api.js";
import EquityChart from "./EquityChart.jsx";
import { Sliders, Play, Grid3x3, TrendingDown, AlertTriangle, CheckCircle2, Gauge } from "lucide-react";

const f2 = (n, d = 2) => n == null || !isFinite(n) ? "—" : Number(n).toFixed(d);
const pf = (n) => n === Infinity ? "∞" : n == null || !isFinite(n) ? "—" : n.toFixed(2);
const inr0 = (n) => n == null ? "—" : "₹" + Math.round(n).toLocaleString("en-IN");

// Heat colour for a score cell, scaled across the whole surface.
function heatColor(v, lo, hi) {
  if (v == null || !isFinite(v)) return { background: "var(--bg-2)", color: "var(--dim)" };
  const t = hi > lo ? (v - lo) / (hi - lo) : 0.5;
  // red -> amber -> green
  const r = t < 0.5 ? 239 : Math.round(239 + (34 - 239) * (t - 0.5) * 2);
  const g = t < 0.5 ? Math.round(68 + (197 - 68) * t * 2) : 197;
  const b = t < 0.5 ? Math.round(68 + (94 - 68) * t * 2) : 94;
  const a = 0.18 + t * 0.62;
  return { background: `rgba(${r},${g},${b},${a})`, color: a > 0.55 ? "#fff" : "inherit" };
}

export default function Optimizer({ symbol, interval, range, strategy, formula, mode, pine, execCfg, theme }) {
  const [meta, setMeta] = useState(null);
  const [oMode, setOMode] = useState("grid");
  const [objective, setObjective] = useState("robustPF");
  const [minTrades, setMinTrades] = useState(10);
  const [folds, setFolds] = useState(4);
  const [isRatio, setIsRatio] = useState(0.7);
  const [anchored, setAnchored] = useState(false);
  const [grid, setGrid] = useState(null);           // { key: [selected values] }
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => { api.optimizeMeta().then(setMeta).catch(e => setErr(e.message)); }, []);

  // Default grid selection = every value the server offers for this strategy.
  const dims = useMemo(() => (meta?.paramGrids?.[strategy]) || [], [meta, strategy]);
  useEffect(() => {
    if (!dims.length) { setGrid(null); return; }
    const g = {};
    for (const d of dims) g[d.key] = [...d.values];
    setGrid(g);
  }, [dims]);

  const combos = useMemo(() => {
    if (!grid) return 0;
    return Object.values(grid).reduce((n, vals) => n * Math.max(1, vals.length), 1);
  }, [grid]);

  const toggleVal = (key, val) => setGrid(g => {
    const cur = g[key] || [];
    const has = cur.includes(val);
    const next = has ? cur.filter(v => v !== val) : [...cur, val].sort((a, b) => a - b);
    return { ...g, [key]: next.length ? next : cur };   // never allow an empty dimension
  });

  const run = async () => {
    setBusy(true); setErr(null); setRes(null);
    const t0 = Date.now();
    const timer = setInterval(() => setElapsed(((Date.now() - t0) / 1000)), 200);
    try {
      const body = {
        ...execCfg, symbol, interval, range,
        strategy: mode === "pine" ? "pine" : strategy,
        pineScript: mode === "pine" ? pine : undefined,
        formula: strategy === "custom" ? formula : undefined,
        mode: oMode, objective, minTrades: +minTrades,
        grid: grid || undefined,
        folds: +folds, isRatio: +isRatio, anchored,
      };
      setRes(await api.optimize(body));
    } catch (e) { setErr(e.message); }
    finally { clearInterval(timer); setElapsed((Date.now() - t0) / 1000); setBusy(false); }
  };

  const objLabel = meta?.objectives?.find(o => o.key === objective)?.label || objective;

  return (
    <div className="bt-wrap">
      <div className="card bt-controls">
        <div className="card-h"><Sliders size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Parameter Optimiser</div>
        <div className="bt-meta-line">
          <span>{symbol}</span><span className="dot">·</span>
          <span>{mode === "pine" ? "Pine Script" : strategy}</span><span className="dot">·</span>
          <span>{interval}</span><span className="dot">·</span><span>{range}</span>
          <span className="dim" style={{ marginLeft: "auto", fontSize: 11 }}>Uses the execution model from the Backtest tab</span>
        </div>

        <div className="bt-modes" role="radiogroup" aria-label="Optimisation mode">
          <button type="button" role="radio" aria-checked={oMode === "grid"} className={`bt-mode ${oMode === "grid" ? "active" : ""}`} onClick={() => setOMode("grid")}>
            <Grid3x3 size={13} aria-hidden="true" /> Grid Sweep
          </button>
          <button type="button" role="radio" aria-checked={oMode === "walkforward"} className={`bt-mode ${oMode === "walkforward" ? "active" : ""}`} onClick={() => setOMode("walkforward")}>
            <TrendingDown size={13} aria-hidden="true" /> Walk-Forward
          </button>
        </div>

        <div className="opt-explain">
          {oMode === "grid"
            ? "A grid sweep tests every parameter combination over the whole history and ranks them. It tells you which settings looked best in the past — it does NOT tell you they will keep working. Read the heatmap for a broad plateau, not a lone spike."
            : "Walk-forward optimisation picks the best parameters on an in-sample window, then trades them untouched on the next unseen window, and repeats. The out-of-sample numbers are the only ones worth believing."}
        </div>

        {mode === "pine" && (
          <div className="warn-line">
            Pine mode optimises the <code>input.*</code> declarations in your script. Values you have not exposed as inputs cannot be swept.
          </div>
        )}

        <div className="bt-form">
          <div className="field">
            <label htmlFor="optimizer-objective-1">Objective</label>
            <select id="optimizer-objective-1" className="select" value={objective} onChange={e => setObjective(e.target.value)}>
              {(meta?.objectives || []).map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <span className="fhint">What "best" means. Profit-factor × √trades is the default because it penalises flukes with 3 trades.</span>
          </div>
          <div className="field">
            <label htmlFor="optimizer-min-trades-2">Min Trades</label>
            <input id="optimizer-min-trades-2" className="input" type="number" value={minTrades} onChange={e => setMinTrades(e.target.value)} />
            <span className="fhint">Combinations with fewer trades are excluded from ranking.</span>
          </div>
          {oMode === "walkforward" && <>
            <div className="field">
              <label htmlFor="optimizer-folds-3">Folds</label>
              <input id="optimizer-folds-3" className="input" type="number" min="2" max="10" value={folds} onChange={e => setFolds(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="optimizer-in-sample-ratio-4">In-Sample Ratio</label>
              <input id="optimizer-in-sample-ratio-4" className="input" type="number" step="0.05" min="0.3" max="0.9" value={isRatio} onChange={e => setIsRatio(e.target.value)} />
              <span className="fhint">0.7 = train on 70% of each fold, test on the remaining 30%.</span>
            </div>
            <div className="field">
              <label htmlFor="optimizer-window-5">Window</label>
              <select id="optimizer-window-5" className="select" value={anchored ? "anchored" : "rolling"} onChange={e => setAnchored(e.target.value === "anchored")}>
                <option value="rolling">Rolling (fixed length)</option>
                <option value="anchored">Anchored (growing from start)</option>
              </select>
            </div>
          </>}
          <div className="field" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-primary" style={{ width: "100%" }} onClick={run} disabled={busy || !combos}>
              <Play size={15} aria-hidden="true" />{busy ? `Running… ${elapsed.toFixed(1)}s` : `Run (${combos} combos${oMode === "walkforward" ? ` × ${folds} folds` : ""})`}
            </button>
          </div>
        </div>

        {dims.length > 0 && grid && (
          <div className="opt-grid-pick">
            <div className="opt-gp-title">Search space <span className="dim">— click a value to include or exclude it</span></div>
            {dims.map(d => (
              <div className="opt-dim" key={d.key}>
                <span className="opt-dim-lbl">{d.label || d.key}</span>
                <div className="opt-vals">
                  {d.values.map(v => (
                    <button key={v} className={`opt-val ${(grid[d.key] || []).includes(v) ? "on" : ""}`}
                      onClick={() => toggleVal(d.key, v)}>{v}</button>
                  ))}
                </div>
              </div>
            ))}
            {combos > 800 && <div className="warn-line">{combos} combinations is a large sweep — expect this to take a while and to overfit more easily.</div>}
          </div>
        )}
        {!dims.length && meta && mode !== "pine" && (
          <div className="warn-line">No parameter grid is defined for “{strategy}”. Pick a strategy with tunable parameters, or use Pine mode with <code>input.*</code>.</div>
        )}
      </div>

      {err && <div className="err-box" role="alert"><AlertTriangle size={14} aria-hidden="true" /> {err}</div>}
      {busy && <div className="loading" role="status" aria-live="polite">Evaluating {combos} parameter combinations{oMode === "walkforward" ? ` across ${folds} folds` : ""}… {elapsed.toFixed(1)}s</div>}

      {res && res.mode === "grid" && <GridResults res={res} objLabel={objLabel} />}
      {res && res.mode === "walkforward" && <WalkForwardResults res={res} objLabel={objLabel} theme={theme} />}
    </div>
  );
}

// ── Grid sweep results ───────────────────────────────────────────────────────
function GridResults({ res, objLabel }) {
  const { meta, best, results, heatmap } = res;
  if (!best) return <div className="empty" role="status"><Sliders size={36} aria-hidden="true" /><span>No combination met the minimum-trades filter</span>
    <span className="dim" style={{ fontSize: 12 }}>Lower Min Trades, widen the range, or loosen the strategy.</span></div>;

  const scores = (heatmap?.cells || []).map(c => c.score).filter(s => s != null && isFinite(s));
  const lo = Math.min(...scores), hi = Math.max(...scores);
  const paramKeys = Object.keys(best.params);

  return (
    <>
      <div className="metric-grid bt-kpis">
        <div className="metric feature">
          <div className="m-lbl">Best Parameters</div>
          <div className="m-val" style={{ fontSize: 15, lineHeight: 1.45 }}>
            {paramKeys.map(k => <div key={k} className="mono">{k} = <b>{String(best.params[k])}</b></div>)}
          </div>
          <div className="m-sub">by {objLabel}</div>
        </div>
        <div className="metric"><div className="m-lbl">Score</div><div className="m-val lime">{f2(best.score, 3)}</div><div className="m-sub">{objLabel}</div></div>
        <div className="metric"><div className="m-lbl">Net Return</div><div className={`m-val ${best.metrics.netPnlPct >= 0 ? "green" : "red"}`}>{f2(best.metrics.netPnlPct)}%</div><div className="m-sub">{best.metrics.totalTrades} trades</div></div>
        <div className="metric"><div className="m-lbl">Profit Factor</div><div className={`m-val ${best.metrics.profitFactor >= 1 ? "green" : "red"}`}>{pf(best.metrics.profitFactor)}</div><div className="m-sub">win {f2(best.metrics.winRate, 1)}%</div></div>
        <div className="metric"><div className="m-lbl">Max Drawdown</div><div className="m-val red">−{f2(best.metrics.maxDrawdownPct)}%</div><div className="m-sub">Sharpe {f2(best.metrics.sharpe)}</div></div>
        <div className="metric"><div className="m-lbl">Search Space</div><div className="m-val">{meta.eligible}<span className="dim" style={{ fontSize: 13 }}>/{meta.combos}</span></div><div className="m-sub">passed min {meta.minTrades} trades</div></div>
      </div>

      {heatmap && heatmap.cells?.length > 0 && (
        <div className="card">
          <div className="card-h"><Grid3x3 size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Parameter Surface — {heatmap.xLabel || heatmap.xKey} vs {heatmap.yLabel || heatmap.yKey}</div>
          <div className="dim exc-intro">
            Each cell is the best score found at that pair of values. A broad warm region means the edge survives small
            parameter changes and is probably real. One bright cell surrounded by red is curve-fitting.
          </div>
          <div className="hm-wrap">
            <table className="hm">
              <thead>
                <tr><th scope="col" className="hm-corner">{heatmap.yLabel || heatmap.yKey} ↓ / {heatmap.xLabel || heatmap.xKey} →</th>
                  {heatmap.xValues.map(x => <th scope="col" key={x} className="mono">{x}</th>)}</tr>
              </thead>
              <tbody>
                {heatmap.yValues.map(y => (
                  <tr key={y}>
                    <th scope="col" className="mono hm-rowh">{y}</th>
                    {heatmap.xValues.map(x => {
                      const c = heatmap.cells.find(c => c.x === x && c.y === y);
                      const isBest = c && best.params[heatmap.xKey] === x && best.params[heatmap.yKey] === y;
                      return (
                        <td key={x} className={`hm-cell ${isBest ? "hm-best" : ""}`} style={heatColor(c?.score, lo, hi)}
                          title={c ? `${heatmap.xKey}=${x}, ${heatmap.yKey}=${y}\nscore ${f2(c.score, 3)}\nnet ${f2(c.netPnlPct)}%  PF ${pf(c.profitFactor)}  trades ${c.totalTrades}` : "no eligible result"}>
                          {c?.score == null ? "·" : f2(c.score, 2)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-h"><Gauge size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Top {results.length} Combinations</div>
        <div className="tbl-wrap" style={{ maxHeight: 420, overflow: "auto" }} tabIndex={0} role="region" aria-label="Parameter combination results (scrollable)">
          <table className="tbl">
            <thead><tr><th scope="col">#</th>{paramKeys.map(k => <th scope="col" key={k}>{k}</th>)}<th scope="col">Score</th><th scope="col">Trades</th><th scope="col">Win%</th><th scope="col">Net%</th><th scope="col">PF</th><th scope="col">Exp R</th><th scope="col">MaxDD%</th><th scope="col">Sharpe</th></tr></thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i} className={i === 0 ? "reg-best" : ""}>
                  <td className="dim mono">{i + 1}</td>
                  {paramKeys.map(k => <td key={k} className="mono">{String(r.params[k])}</td>)}
                  <td className="mono" style={{ fontWeight: 700 }}>{f2(r.score, 3)}</td>
                  <td className="mono">{r.metrics.totalTrades}</td>
                  <td className="mono">{f2(r.metrics.winRate, 1)}</td>
                  <td className={`mono ${r.metrics.netPnlPct >= 0 ? "green" : "red"}`}>{f2(r.metrics.netPnlPct)}</td>
                  <td className="mono">{pf(r.metrics.profitFactor)}</td>
                  <td className={`mono ${r.metrics.expectancyR == null ? "" : r.metrics.expectancyR >= 0 ? "green" : "red"}`}>{f2(r.metrics.expectancyR)}</td>
                  <td className="mono red">{f2(r.metrics.maxDrawdownPct)}</td>
                  <td className="mono">{f2(r.metrics.sharpe)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="warn-line">
          These are in-sample rankings over the entire history. Before trusting the top row, re-run in
          Walk-Forward mode — that is the test that separates a real edge from a well-fitted curve.
        </div>
      </div>
    </>
  );
}

// ── Walk-forward results ─────────────────────────────────────────────────────
function WalkForwardResults({ res, objLabel, theme }) {
  const { meta, folds, aggregate, overfit } = res;
  const good = folds.filter(f => !f.error);
  if (!good.length) return <div className="empty" role="status"><TrendingDown size={36} aria-hidden="true" /><span>No fold produced a usable result</span>
    <span className="dim" style={{ fontSize: 12 }}>{folds[0]?.error || "Try fewer folds, a longer range, or a lower Min Trades."}</span></div>;

  const paramKeys = Object.keys(good[0].bestParams || {});
  const deg = overfit?.degradationPct;
  const verdictTone = /^Fails/i.test(overfit?.verdict || "") ? "bad" : /caution|marginal|weak/i.test(overfit?.verdict || "") ? "warn" : "good";

  return (
    <>
      <div className={`wf-verdict ${verdictTone}`}>
        {verdictTone === "good" ? <CheckCircle2 size={18} aria-hidden="true" /> : <AlertTriangle size={18} aria-hidden="true" />}
        <div>
          <div className="wf-v-title">{overfit?.verdict}</div>
          <div className="wf-v-sub">
            In-sample average {f2(overfit?.isAvgReturnPct)}% per fold vs out-of-sample {f2(overfit?.osAvgReturnPct)}% —
            {deg == null ? " degradation not computable" : ` ${f2(deg, 0)}% of the in-sample edge did not survive`}.
            Parameter stability {f2((overfit?.paramStability?.stableFraction ?? 0) * 100, 0)}%.
          </div>
        </div>
      </div>

      <div className="metric-grid bt-kpis">
        <div className="metric feature"><div className="m-lbl">Out-of-Sample Return</div>
          <div className={`m-val ${aggregate.osNetPnlPct >= 0 ? "green" : "red"}`}>{f2(aggregate.osNetPnlPct)}%</div>
          <div className="m-sub">{inr0(aggregate.osNetPnl)} across {aggregate.osTrades} unseen trades</div></div>
        <div className="metric"><div className="m-lbl">OS Profit Factor</div><div className={`m-val ${aggregate.osProfitFactor >= 1 ? "green" : "red"}`}>{pf(aggregate.osProfitFactor)}</div><div className="m-sub">win {f2(aggregate.osWinRate, 1)}%</div></div>
        <div className="metric"><div className="m-lbl">OS Max Drawdown</div><div className="m-val red">−{f2(aggregate.osMaxDDPct)}%</div><div className="m-sub">chained across folds</div></div>
        <div className="metric"><div className="m-lbl">Profitable Folds</div><div className="m-val">{aggregate.profitableFolds}/{aggregate.totalFolds}</div><div className="m-sub">consistency across time</div></div>
        <div className="metric"><div className="m-lbl">OS Expectancy</div><div className={`m-val ${aggregate.osExpectancy >= 0 ? "green" : "red"}`}>{inr0(aggregate.osExpectancy)}</div><div className="m-sub">per unseen trade</div></div>
        <div className="metric"><div className="m-lbl">Bars</div><div className="m-val">{meta.bars}</div><div className="m-sub">{meta.interval} · {meta.range}</div></div>
      </div>

      {aggregate.equityCurve?.length > 1 && (
        <div className="card">
          <div className="card-h"><Gauge size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Out-of-Sample Equity (folds chained)</div>
          <div className="dim exc-intro">Only unseen data. This is the closest thing a backtest gives you to a track record.</div>
          <div className="bt-chart"><EquityChart curve={aggregate.equityCurve} initialCapital={aggregate.equityCurve[0].equity} theme={theme} /></div>
        </div>
      )}

      <div className="card">
        <div className="card-h"><Sliders size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Fold Detail</div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th scope="col">Fold</th><th scope="col">IS bars</th><th scope="col">OS bars</th>{paramKeys.map(k => <th scope="col" key={k}>{k}</th>)}
              <th scope="col">IS score</th><th scope="col">IS net%</th><th scope="col">OS net%</th><th scope="col">OS PF</th><th scope="col">OS trades</th><th scope="col">OS win%</th></tr></thead>
            <tbody>
              {folds.map(f => f.error ? (
                <tr key={f.fold}><td className="mono">{f.fold}</td><td colSpan={paramKeys.length + 9} className="dim">{f.error}</td></tr>
              ) : (
                <tr key={f.fold} className={f.osMetrics?.netPnlPct >= 0 ? "reg-best" : "reg-worst"}>
                  <td className="mono" style={{ fontWeight: 700 }}>{f.fold}</td>
                  <td className="mono dim">{f.isFrom}–{f.isTo}</td>
                  <td className="mono dim">{f.osFrom}–{f.osTo}</td>
                  {paramKeys.map(k => <td key={k} className="mono">{String(f.bestParams?.[k])}</td>)}
                  <td className="mono">{f2(f.isScore, 3)}</td>
                  <td className={`mono ${(f.isMetrics?.netPnlPct ?? 0) >= 0 ? "green" : "red"}`}>{f2(f.isMetrics?.netPnlPct)}</td>
                  <td className={`mono ${(f.osMetrics?.netPnlPct ?? 0) >= 0 ? "green" : "red"}`} style={{ fontWeight: 700 }}>{f2(f.osMetrics?.netPnlPct)}</td>
                  <td className="mono">{pf(f.osMetrics?.profitFactor)}</td>
                  <td className="mono">{f.osMetrics?.totalTrades ?? "—"}</td>
                  <td className="mono">{f2(f.osMetrics?.winRate, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {overfit?.paramStability?.perParam && (
        <div className="card">
          <div className="card-h"><Grid3x3 size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Parameter Stability</div>
          <div className="dim exc-intro">
            If the optimiser picks a wildly different value in every fold, there is no stable optimum to find —
            the parameter is fitting noise and you should either fix it by hand or drop it.
          </div>
          <table className="tbl">
            <thead><tr><th scope="col">Parameter</th><th scope="col">Chosen per fold</th><th scope="col">Distinct</th><th scope="col">Verdict</th></tr></thead>
            <tbody>
              {Object.entries(overfit.paramStability.perParam).map(([k, v]) => (
                <tr key={k}>
                  <td className="mono">{k}</td>
                  <td className="mono">{v.values.join(" → ")}</td>
                  <td className="mono">{v.distinct}</td>
                  <td className={v.stable ? "green" : "red"} style={{ fontWeight: 600 }}>{v.stable ? "Stable" : "Unstable"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
