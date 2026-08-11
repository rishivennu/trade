import { useState, useMemo } from "react";
import { api } from "./api.js";
import EquityChart from "./EquityChart.jsx";
import { Layers, Play, AlertTriangle, Gauge, Wallet, Activity } from "lucide-react";

const f2 = (n, d = 2) => n == null || !isFinite(n) ? "—" : Number(n).toFixed(d);
const pf = (n) => n === Infinity ? "∞" : n == null || !isFinite(n) ? "—" : n.toFixed(2);
const inr0 = (n) => n == null ? "—" : "₹" + Math.round(n).toLocaleString("en-IN");

const PRESETS = [
  { name: "Indian indices", syms: ["^NSEI", "^NSEBANK", "^CNXIT", "NIFTY_FIN_SERVICE.NS"] },
  { name: "Global indices", syms: ["^NSEI", "^GSPC", "^IXIC", "^N225", "^FTSE"] },
  { name: "Cross-asset", syms: ["^NSEI", "GC=F", "CL=F", "EURUSD=X", "BTC-USD"] },
  { name: "Commodities", syms: ["GC=F", "SI=F", "CL=F", "NG=F"] },
];

function corrColor(v) {
  if (v == null) return { background: "var(--bg-2)", color: "var(--dim)" };
  const a = Math.min(1, Math.abs(v)) * 0.7 + 0.08;
  return { background: v >= 0 ? `rgba(239,68,68,${a})` : `rgba(59,130,246,${a})`, color: a > 0.5 ? "#fff" : "inherit" };
}

export default function PortfolioBacktest({ instruments, interval, range, strategy, formula, mode, pine, execCfg, theme }) {
  const [picked, setPicked] = useState(["^NSEI", "^NSEBANK", "^CNXIT"]);
  const [maxOpen, setMaxOpen] = useState(0);
  const [maxHeat, setMaxHeat] = useState(0);
  const [capital, setCapital] = useState(1000000);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [search, setSearch] = useState("");

  const options = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = instruments || [];
    return q ? list.filter(i => i.symbol.toLowerCase().includes(q) || (i.name || "").toLowerCase().includes(q)) : list;
  }, [instruments, search]);

  const toggle = (sym) => setPicked(p => p.includes(sym) ? p.filter(s => s !== sym) : p.length >= 20 ? p : [...p, sym]);

  const run = async () => {
    setBusy(true); setErr(null); setRes(null);
    try {
      setRes(await api.portfolioBacktest({
        ...execCfg, symbols: picked, interval, range, initialCapital: +capital,
        strategy: mode === "pine" ? "pine" : strategy,
        pineScript: mode === "pine" ? pine : undefined,
        formula: strategy === "custom" ? formula : undefined,
        maxOpenPositions: +maxOpen, maxHeatPct: +maxHeat,
      }));
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const p = res?.portfolio;

  return (
    <div className="bt-wrap">
      <div className="card bt-controls">
        <div className="card-h"><Layers size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Portfolio Backtest</div>
        <div className="bt-meta-line">
          <span>{picked.length} symbols</span><span className="dot">·</span>
          <span>{mode === "pine" ? "Pine Script" : strategy}</span><span className="dot">·</span>
          <span>{interval}</span><span className="dot">·</span><span>{range}</span>
          <span className="dim" style={{ marginLeft: "auto", fontSize: 11 }}>Execution model comes from the Backtest tab</span>
        </div>
        <div className="opt-explain">
          Runs the same strategy independently on every symbol, each on its own slice of capital, then adds the equity
          curves together. Because the slices are smaller, portfolio drawdown is usually far below any single leg —
          but only if the legs are genuinely uncorrelated, which the matrix below checks.
        </div>

        <div className="pf-presets">
          <span className="dim">Presets:</span>
          {PRESETS.map(pr => (
            <button key={pr.name} className="opt-val" onClick={() => setPicked(pr.syms)}>{pr.name}</button>
          ))}
        </div>

        <div className="pf-picker">
          <input className="input" placeholder="Search instruments…" value={search} onChange={e => setSearch(e.target.value)} />
          <div className="pf-chosen">
            {picked.map(s => <button key={s} className="opt-val on" onClick={() => toggle(s)} title="Remove">{s} ×</button>)}
            {!picked.length && <span className="dim">Pick at least 2 symbols</span>}
          </div>
          <div className="pf-list">
            {options.slice(0, 120).map(i => (
              <button key={i.symbol} className={`pf-opt ${picked.includes(i.symbol) ? "on" : ""}`} onClick={() => toggle(i.symbol)}>
                <span className="mono">{i.symbol}</span><span className="dim">{i.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="bt-form">
          <div className="field"><label htmlFor="portfoliobacktest-total-capital-1">Total Capital (₹)</label>
            <input id="portfoliobacktest-total-capital-1" className="input" type="number" step="100000" value={capital} onChange={e => setCapital(e.target.value)} />
            <span className="fhint">Split equally across the chosen symbols.</span></div>
          <div className="field"><label htmlFor="portfoliobacktest-max-open-positions-2">Max Open Positions</label>
            <input id="portfoliobacktest-max-open-positions-2" className="input" type="number" value={maxOpen} onChange={e => setMaxOpen(e.target.value)} placeholder="0 = unlimited" />
            <span className="fhint">Caps how many legs may be in the market at once.</span></div>
          <div className="field"><label htmlFor="portfoliobacktest-max-portfolio-heat-3">Max Portfolio Heat (%)</label>
            <input id="portfoliobacktest-max-portfolio-heat-3" className="input" type="number" step="0.5" value={maxHeat} onChange={e => setMaxHeat(e.target.value)} placeholder="0 = unlimited" />
            <span className="fhint">Total risk of all open positions, as % of portfolio. Needs risk-based sizing and a stop.</span></div>
          <div className="field" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-primary" style={{ width: "100%" }} onClick={run} disabled={busy || picked.length < 2}>
              <Play size={15} aria-hidden="true" />{busy ? "Running…" : `Run ${picked.length} Symbols`}
            </button>
          </div>
        </div>
      </div>

      {err && <div className="err-box" role="alert"><AlertTriangle size={14} aria-hidden="true" /> {err}</div>}
      {busy && <div className="loading" role="status" aria-live="polite">Backtesting {picked.length} symbols over {range} of {interval} candles…</div>}

      {res && p && <>
        {res.meta.failed?.length > 0 && (
          <div className="warn-line">
            Skipped: {res.meta.failed.map(f => `${f.symbol} (${f.error})`).join(", ")}. Capital was redistributed across the rest.
          </div>
        )}

        <div className="metric-grid bt-kpis">
          <div className="metric feature"><div className="m-lbl">Portfolio Net P&amp;L</div>
            <div className={`m-val ${p.netPnl >= 0 ? "green" : "red"}`}>{inr0(p.netPnl)}</div>
            <div className="m-sub">{f2(p.netPnlPct)}% on {inr0(res.meta.deployedCapital)} deployed</div></div>
          <div className="metric"><div className="m-lbl">Max Drawdown</div><div className="m-val red">−{f2(p.maxDrawdownPct)}%</div>
            <div className="m-sub">worst leg −{f2(Math.max(...res.legs.map(l => l.metrics.maxDrawdownPct)))}%</div></div>
          <div className="metric"><div className="m-lbl">Profit Factor</div><div className={`m-val ${p.profitFactor >= 1 ? "green" : "red"}`}>{pf(p.profitFactor)}</div><div className="m-sub">win {f2(p.winRate, 1)}%</div></div>
          <div className="metric"><div className="m-lbl">Sharpe</div><div className="m-val">{f2(p.sharpe)}</div><div className="m-sub">Sortino {f2(p.sortino)}</div></div>
          <div className="metric"><div className="m-lbl">Trades</div><div className="m-val">{p.totalTrades}</div><div className="m-sub">max {res.concurrency.maxConcurrent} concurrent</div></div>
          <div className="metric"><div className="m-lbl">Avg Correlation</div>
            <div className={`m-val ${(res.correlation.avgStrategyCorr ?? 0) < 0.4 ? "green" : (res.correlation.avgStrategyCorr ?? 0) < 0.7 ? "lime" : "red"}`}>
              {f2(res.correlation.avgStrategyCorr)}</div>
            <div className="m-sub">between strategy returns</div></div>
        </div>

        <div className={`wf-verdict ${(res.correlation.avgStrategyCorr ?? 1) < 0.4 ? "good" : (res.correlation.avgStrategyCorr ?? 1) < 0.7 ? "warn" : "bad"}`}>
          <Activity size={18} aria-hidden="true" />
          <div><div className="wf-v-title">{res.diversification.verdict}</div>
            <div className="wf-v-sub">
              Best leg {f2(res.diversification.bestLegPct)}% · worst leg {f2(res.diversification.worstLegPct)}% ·
              portfolio {f2(res.diversification.portfolioPct)}%. Each leg trades only its own slice, so the portfolio
              figure is the capital-weighted blend, not the average of the percentages.
            </div></div>
        </div>

        <div className="card">
          <div className="card-h"><Gauge size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Portfolio Equity</div>
          <div className="bt-chart"><EquityChart curve={res.equityCurve} initialCapital={res.meta.deployedCapital} theme={theme} /></div>
        </div>

        {res.meta.heatApplied && res.filtered && (
          <div className="card">
            <div className="card-h"><Wallet size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> With Heat Cap Applied</div>
            <div className="dim exc-intro">
              {res.concurrency.skippedTrades} of {p.totalTrades} entries were declined because the portfolio was already
              at its position or risk limit. Peak heat actually reached: {f2(res.concurrency.maxHeatPctSeen)}%.
              This curve is realised-at-exit rather than mark-to-market, so treat its drawdown as a floor.
            </div>
            <div className="rm-grid">
              <div className="rm-cell"><div className="rm-lbl">Trades taken</div><div className="rm-val">{res.filtered.totalTrades}</div></div>
              <div className="rm-cell"><div className="rm-lbl">Net</div><div className={`rm-val ${res.filtered.netPnlPct >= 0 ? "green" : "red"}`}>{f2(res.filtered.netPnlPct)}%</div></div>
              <div className="rm-cell"><div className="rm-lbl">Profit Factor</div><div className="rm-val">{pf(res.filtered.profitFactor)}</div></div>
              <div className="rm-cell"><div className="rm-lbl">Max DD</div><div className="rm-val red">−{f2(res.filtered.maxDrawdownPct)}%</div></div>
              <div className="rm-cell"><div className="rm-lbl">Win Rate</div><div className="rm-val">{f2(res.filtered.winRate, 1)}%</div></div>
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-h"><Layers size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Per-Symbol Legs</div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th scope="col">Symbol</th><th scope="col">Weight</th><th scope="col">Allocation</th><th scope="col">Trades</th><th scope="col">Win%</th><th scope="col">Net%</th><th scope="col">PF</th><th scope="col">Exp R</th><th scope="col">MaxDD%</th><th scope="col">Sharpe</th></tr></thead>
              <tbody>{res.legs.map(l => (
                <tr key={l.symbol}>
                  <td className="mono" style={{ fontWeight: 700 }}>{l.symbol}<div className="dim" style={{ fontSize: 10.5, fontWeight: 400 }}>{l.name}</div></td>
                  <td className="mono">{f2(l.weight * 100, 0)}%</td>
                  <td className="mono dim">{inr0(l.allocation)}</td>
                  <td className="mono">{l.metrics.totalTrades}</td>
                  <td className="mono">{f2(l.metrics.winRate, 1)}</td>
                  <td className={`mono ${l.metrics.netPnlPct >= 0 ? "green" : "red"}`} style={{ fontWeight: 600 }}>{f2(l.metrics.netPnlPct)}</td>
                  <td className="mono">{pf(l.metrics.profitFactor)}</td>
                  <td className={`mono ${l.metrics.expectancyR == null ? "" : l.metrics.expectancyR >= 0 ? "green" : "red"}`}>{f2(l.metrics.expectancyR)}</td>
                  <td className="mono red">{f2(l.metrics.maxDrawdownPct)}</td>
                  <td className="mono">{f2(l.metrics.sharpe)}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
        </div>

        {["strategy", "price"].map(kind => (
          <div className="card" key={kind}>
            <div className="card-h"><Activity size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> {kind === "strategy" ? "Strategy Return Correlation" : "Underlying Price Correlation"}</div>
            <div className="dim exc-intro">
              {kind === "strategy"
                ? "Correlation between the legs' equity curves. This is the number that decides whether diversification is real: two profitable legs that lose money on the same days do not reduce risk."
                : "Correlation of the instruments themselves. High price correlation with low strategy correlation means the strategy is trading them at different times, which is genuine diversification."}
              {" "}Computed only on bars the pair actually shares, so instruments on different exchange calendars are compared fairly.
            </div>
            <div className="hm-wrap">
              <table className="hm">
                <thead><tr><th scope="col" className="hm-corner" /> {res.correlation[kind].map(r => <th scope="col" key={r.symbol} className="mono">{r.symbol}</th>)}</tr></thead>
                <tbody>{res.correlation[kind].map(row => (
                  <tr key={row.symbol}>
                    <th scope="col" className="mono hm-rowh">{row.symbol}</th>
                    {row.values.map((v, i) => (
                      <td key={i} className="hm-cell" style={corrColor(v)}
                        title={v == null ? "not enough overlapping bars" : `${row.symbol} vs ${res.correlation[kind][i].symbol}: ${v.toFixed(3)} (${row.overlap?.[i] ?? "?"} shared bars)`}>
                        {v == null ? "·" : v.toFixed(2)}
                      </td>
                    ))}
                  </tr>))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        <div className="card">
          <div className="card-h"><Layers size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Combined Trade Tape ({res.trades.length} shown)</div>
          <div className="tbl-wrap" style={{ maxHeight: 380, overflow: "auto" }} tabIndex={0} role="region" aria-label="Portfolio trade list (scrollable)">
            <table className="tbl">
              <thead><tr><th scope="col">Symbol</th><th scope="col">Side</th><th scope="col">Entry</th><th scope="col">Exit</th><th scope="col">Bars</th><th scope="col">Reason</th><th scope="col">R</th><th scope="col">P&amp;L</th></tr></thead>
              <tbody>{res.trades.map((t, i) => (
                <tr key={i}>
                  <td className="mono">{t.symbol}</td>
                  <td className={t.side === "BUY" ? "green" : "red"} style={{ fontWeight: 700 }}>{t.side}</td>
                  <td className="mono">{f2(t.entry)}</td>
                  <td className="mono">{f2(t.exit)}</td>
                  <td className="mono dim">{t.bars}</td>
                  <td><span className="sig NEUTRAL" style={{ fontSize: 10 }}>{t.exitReason}</span></td>
                  <td className={`mono ${(t.rMultiple ?? 0) >= 0 ? "green" : "red"}`}>{f2(t.rMultiple)}</td>
                  <td className={`mono ${t.pnl >= 0 ? "green" : "red"}`} style={{ fontWeight: 600 }}>{inr0(t.pnl)}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
        </div>
      </>}
    </div>
  );
}
