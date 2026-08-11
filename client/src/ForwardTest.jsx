import { useState, useEffect, useCallback } from "react";
import { api } from "./api.js";
import EquityChart from "./EquityChart.jsx";
import {
  Radio, Play, Pause, RefreshCw, Trash2, AlertTriangle, CheckCircle2, Plus, History, Clock,
} from "lucide-react";

const f2 = (n, d = 2) => n == null || !isFinite(n) ? "—" : Number(n).toFixed(d);
const pf = (n) => n === null || n === undefined ? "—" : (n === Infinity ? "∞" : Number(n).toFixed(2));
const inr = (n) => n == null ? "—" : "₹" + Math.round(n).toLocaleString("en-IN");
const sgn = (n) => n == null ? "—" : (n >= 0 ? "+" : "−") + "₹" + Math.abs(Math.round(n)).toLocaleString("en-IN");
const ago = (iso) => {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
const dt = (t) => t == null ? "—" : new Date(t * 1000).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });

// Rows shown side by side: history (before you pressed start) vs live (after).
const ROWS = [
  ["Trades",         (d) => d.trades,               (d) => d.trades, false],
  ["Win rate",       (d) => `${f2(d.winRate, 1)}%`, (d) => d.winRate, true],
  ["Net P&L",        (d) => sgn(d.netPnl),          (d) => d.netPnl, true],
  ["Return on capital", (d) => `${f2(d.netPnlPct)}%`, (d) => d.netPnlPct, true],
  ["Profit factor",  (d) => pf(d.profitFactor),     (d) => d.profitFactor - 1, true],
  ["Expectancy / trade", (d) => sgn(d.expectancy),  (d) => d.expectancy, true],
  ["Expectancy (R)", (d) => d.expectancyR == null ? "—" : f2(d.expectancyR), (d) => d.expectancyR, true],
  ["Avg win ÷ avg loss", (d) => pf(d.plRatio),      (d) => d.plRatio - 1, true],
  ["Max drawdown",   (d) => `${f2(d.maxDrawdownPct)}%`, (d) => -d.maxDrawdownPct, true],
  ["Worst losing streak", (d) => d.maxLossStreak,   (d) => -d.maxLossStreak, true],
  ["Avg bars held",  (d) => f2(d.avgBars, 0),       (d) => null, false],
  ["Costs paid",     (d) => inr(d.charges),         (d) => null, false],
];

function TestCard({ t, theme, onRefresh, onToggle, onDelete, busyId }) {
  const [showTrades, setShowTrades] = useState(false);
  const s = t.snapshot;
  const busy = busyId === t.id;

  if (!s || s.error) {
    return (
      <div className="card fwd-card">
        <div className="fwd-head">
          <div>
            <div className="fwd-name">{t.name}</div>
            <div className="fwd-sub">{t.symbolName} · {t.interval} · {t.range}</div>
          </div>
          <div className="fwd-actions">
            <button className="btn btn-sm" onClick={() => onRefresh(t.id)} disabled={busy}><RefreshCw size={13} aria-hidden="true" /> Refresh</button>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => onDelete(t.id)} aria-label={`Delete forward test ${t.name}`} title="Delete forward test"><Trash2 size={13} aria-hidden="true" /></button>
          </div>
        </div>
        <div className="err-box" role="alert"><AlertTriangle size={14} aria-hidden="true" /> {s?.error || "Never refreshed"}</div>
      </div>
    );
  }

  const b = s.baseline, f = s.forward;
  return (
    <div className="card fwd-card">
      <div className="fwd-head">
        <div>
          <div className="fwd-name">
            {t.name}
            <span className={`fwd-pill ${t.status}`}>{t.status === "active" ? "LIVE" : "PAUSED"}</span>
          </div>
          <div className="fwd-sub">
            {t.symbolName} · {t.interval} · {t.range} · started {dt(t.startTime)} at {f2(t.startPrice)}
            {" · "}{t.daysLive < 1 ? "under a day" : `${f2(t.daysLive, 1)} days live`}
            {" · updated "}{ago(s.updatedAt)}
          </div>
        </div>
        <div className="fwd-actions">
          <button className="btn btn-sm" onClick={() => onRefresh(t.id)} disabled={busy}>
            <RefreshCw size={13} aria-hidden="true" className={busy ? "spin" : ""} /> {busy ? "…" : "Refresh"}
          </button>
          <button className="btn btn-sm" onClick={() => onToggle(t)}>
            {t.status === "active" ? <><Pause size={13} aria-hidden="true" /> Pause</> : <><Play size={13} aria-hidden="true" /> Resume</>}
          </button>
          <button type="button" className="btn btn-sm btn-danger" onClick={() => onDelete(t.id)} aria-label={`Delete forward test ${t.name}`} title="Delete forward test"><Trash2 size={13} aria-hidden="true" /></button>
        </div>
      </div>

      {t.verdict && (
        <div className={`wf-verdict ${t.verdict.tone}`} style={{ marginBottom: 14 }}>
          {t.verdict.tone === "good" ? <CheckCircle2 size={18} aria-hidden="true" /> : <AlertTriangle size={18} aria-hidden="true" />}
          <div>
            <div className="wf-v-title">{t.verdict.title}</div>
            <div className="wf-v-sub">{t.verdict.detail}</div>
          </div>
        </div>
      )}

      <div className="fwd-cmp">
        <table className="tbl fwd-tbl">
          <thead>
            <tr>
              <th scope="col"><span className="sr-only">Actions</span></th>
              <th scope="col">Backtested history<div className="fwd-th-sub">up to {dt(t.startTime)}</div></th>
              <th scope="col">Forward (live)<div className="fwd-th-sub">since {dt(t.startTime)}</div></th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([label, fmtFn, cmpFn, colour]) => {
              const bv = cmpFn(b), fv = cmpFn(f);
              let cls = "mono";
              if (colour && bv != null && fv != null && isFinite(bv) && isFinite(fv)) {
                cls += fv >= bv ? " green" : " red";
              }
              return (
                <tr key={label}>
                  <td className="fwd-lbl">{label}</td>
                  <td className="mono dim">{fmtFn(b)}</td>
                  <td className={cls} style={{ fontWeight: 600 }}>{fmtFn(f)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="dim fwd-note">
        Green in the right column means live is at least as good as history on that measure. Both columns come from the
        identical engine and settings — the only difference is which bars are counted. A trade opened before you pressed
        Start counts entirely as history even if it closed afterwards, and both columns are expressed as a percentage of
        the original capital so they stay directly comparable.
      </div>

      {s.forwardCurve?.length > 1 && (
        <>
          <div className="rd-title">Forward equity (realised, stamped at each exit)</div>
          <div className="bt-chart" style={{ height: 220 }}>
            <EquityChart curve={s.forwardCurve} initialCapital={s.initialCapital} theme={theme} />
          </div>
        </>
      )}

      {f.trades > 0 && (
        <>
          <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => setShowTrades(v => !v)}>
            <History size={13} aria-hidden="true" /> {showTrades ? "Hide" : "Show"} {f.trades} forward trade{f.trades === 1 ? "" : "s"}
          </button>
          {showTrades && (
            <div className="tbl-wrap" style={{ maxHeight: 300, overflow: "auto", marginTop: 10 }} tabIndex={0} role="region" aria-label="Forward test trade list (scrollable)">
              <table className="tbl">
                <thead><tr><th scope="col">Entry</th><th scope="col">Exit</th><th scope="col">Side</th><th scope="col">In</th><th scope="col">Out</th><th scope="col">Bars</th><th scope="col">Reason</th><th scope="col">R</th><th scope="col">P&amp;L</th></tr></thead>
                <tbody>{[...s.forwardTrades].reverse().map((x, i) => (
                  <tr key={i}>
                    <td className="mono dim">{dt(x.entryTime)}</td>
                    <td className="mono dim">{dt(x.exitTime)}</td>
                    <td className={x.side === "BUY" ? "green" : "red"} style={{ fontWeight: 700 }}>{x.side}</td>
                    <td className="mono">{f2(x.entry)}</td>
                    <td className="mono">{f2(x.exit)}</td>
                    <td className="mono dim">{x.bars}</td>
                    <td><span className="sig NEUTRAL" style={{ fontSize: 10 }}>{x.exitReason}</span></td>
                    <td className={`mono ${(x.rMultiple ?? 0) >= 0 ? "green" : "red"}`}>{x.rMultiple == null ? "—" : f2(x.rMultiple)}</td>
                    <td className={`mono ${x.pnl >= 0 ? "green" : "red"}`} style={{ fontWeight: 600 }}>{sgn(x.pnl)}</td>
                  </tr>))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <div className="fwd-cfg dim">
        Assumptions: fills {s.fillMode === "nextOpen" ? "next bar open" : "signal bar close"} · costs {s.chargeLabel} · sizing {s.sizing}
      </div>
    </div>
  );
}

export default function ForwardTest({ symbol, symbolName, interval, range, strategy, strategyName, mode, pine, formula, execCfg, theme }) {
  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async (refresh = true) => {
    setLoading(true); setErr(null);
    try { setTests(await api.forwardTests(refresh)); }
    catch (e) { setErr(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => { load(true); }, [load]);

  const create = async () => {
    setCreating(true); setErr(null);
    try {
      await api.createForward({
        name: name.trim() || undefined,
        symbol, interval, range, mode, strategy, formula, pine, cfg: execCfg,
      });
      setName("");
      await load(false);
    } catch (e) { setErr(e.message); }
    setCreating(false);
  };

  const refreshOne = async (id) => {
    setBusyId(id);
    try { const t = await api.refreshForward(id); setTests(ts => ts.map(x => x.id === id ? t : x)); }
    catch (e) { setErr(e.message); }
    setBusyId(null);
  };
  const toggle = async (t) => {
    try {
      const u = await api.setForwardStatus(t.id, t.status === "active" ? "paused" : "active");
      setTests(ts => ts.map(x => x.id === t.id ? u : x));
    } catch (e) { setErr(e.message); }
  };
  const remove = async (id) => {
    try { await api.deleteForward(id); setTests(ts => ts.filter(x => x.id !== id)); }
    catch (e) { setErr(e.message); }
  };

  return (
    <div className="bt-wrap">
      <div className="card">
        <div className="card-h"><Radio size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Forward Test Logger</div>
        <div className="opt-explain">
          A backtest tells you what a strategy did on data you already used to build it. A forward test only counts bars
          that closed <b>after</b> you pressed Start, so it cannot be tuned after the fact. Both sides run through the
          exact same engine and settings, which means any gap between them is the market or over-fitting — never a code
          difference.
          <br /><br />
          <b>What this is not:</b> tick-by-tick execution. Fills still use your configured bar assumptions
          (next bar open by default) and when a bar contains both your stop and your target the stop is assumed to hit
          first. Treat it as an honest paper record, not a broker statement.
        </div>

        <div className="bt-meta-line" style={{ marginBottom: 12 }}>
          <span>{symbolName || symbol}</span><span className="dot">·</span>
          <span>{mode === "pine" ? "Pine Script" : (strategyName || strategy)}</span><span className="dot">·</span>
          <span>{interval}</span><span className="dot">·</span>
          <span>{range}</span>
          <span className="dim" style={{ marginLeft: "auto", fontSize: 11 }}>Captured from the top bar and the Backtest tab</span>
        </div>

        <div className="fwd-create">
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="forwardtest-name-span-classname-fhint-optional-span-1">Name <span className="fhint">optional</span></label>
            <input id="forwardtest-name-span-classname-fhint-optional-span-1" className="input" value={name} onChange={e => setName(e.target.value)}
              placeholder={`${symbolName || symbol} · ${mode === "pine" ? "Pine" : strategy} · ${interval}`} />
          </div>
          <button className="btn btn-primary" onClick={create} disabled={creating}>
            <Plus size={15} aria-hidden="true" />{creating ? "Starting…" : "Start Forward Test"}
          </button>
          <button className="btn" onClick={() => load(true)} disabled={loading}>
            <RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh all
          </button>
        </div>
        <div className="dim" style={{ fontSize: 11, marginTop: 8 }}>
          The clock starts at the most recent closed bar. Range controls how much history is loaded on each refresh, so
          keep it wide enough to still contain your start point as time passes.
        </div>
      </div>

      {err && <div className="err-box" role="alert"><AlertTriangle size={14} aria-hidden="true" /> {err}</div>}
      {loading && !tests.length && <div className="loading" role="status" aria-live="polite">Loading forward tests…</div>}

      {!loading && !tests.length && !err && (
        <div className="empty" role="status"><Clock size={40} aria-hidden="true" /><span>No forward tests running</span>
          <span className="dim" style={{ fontSize: 12 }}>Start one above, then leave it alone and let the market vote</span></div>
      )}

      {tests.map(t => (
        <TestCard key={t.id} t={t} theme={theme} onRefresh={refreshOne} onToggle={toggle} onDelete={remove} busyId={busyId} />
      ))}
    </div>
  );
}
