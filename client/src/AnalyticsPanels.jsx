import { Gauge, Target, Layers, Clock, Activity } from "lucide-react";

const f2 = (n, d = 2) => n == null || !isFinite(n) ? "—" : Number(n).toFixed(d);
const pf = (n) => n === Infinity ? "∞" : n == null || !isFinite(n) ? "—" : n.toFixed(2);
const inr0 = (n) => n == null ? "—" : "₹" + Math.round(n).toLocaleString("en-IN");
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ── Risk-adjusted return metrics ─────────────────────────────────────────────
export function RiskMetrics({ m, meta }) {
  const cells = [
    ["Sharpe", f2(m.sharpe), "Return per unit of total volatility. Above 1 is good, above 2 is suspicious for a retail backtest."],
    ["Sortino", f2(m.sortino), "Like Sharpe but only punishes downside volatility."],
    ["Calmar", f2(m.calmar), "Annual return ÷ max drawdown. How much pain per unit of gain."],
    ["CAGR", m.cagr == null ? "—" : f2(m.cagr) + "%", "Compound annual growth rate implied by the equity curve."],
    ["Annual Vol", m.annualVolPct == null ? "—" : f2(m.annualVolPct) + "%", "Annualised standard deviation of bar returns."],
    ["Exposure", m.exposurePct == null ? "—" : f2(m.exposurePct, 1) + "%", "Share of bars with a position open. Low exposure with good returns means capital is free most of the time."],
    ["Longest DD", m.longestDDBars == null ? "—" : m.longestDDBars + " bars", "Longest stretch spent below a previous equity peak."],
    ["Max Win Streak", m.maxWinStreak ?? "—", "Consecutive winners."],
    ["Max Loss Streak", m.maxLossStreak ?? "—", "Consecutive losers. This is the number you must be able to sit through."],
    ["Total Charges", inr0(m.totalCharges), `Brokerage, taxes and fees actually deducted (${meta?.chargeLabel || "model"}).`],
    ["Expectancy (R)", f2(m.expectancyR), "Average trade measured in units of initial risk. The single most portable edge number."],
    ["Best / Worst", `${inr0(m.bestTrade)} / ${inr0(m.worstTrade)}`, "Largest single winner and loser."],
  ];
  return (
    <div className="card">
      <div className="card-h"><Gauge size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Risk-Adjusted Performance</div>
      <div className="rm-grid">
        {cells.map(([lbl, val, tip]) => (
          <div className="rm-cell" key={lbl} title={tip}>
            <div className="rm-lbl">{lbl}</div>
            <div className="rm-val">{val}</div>
          </div>
        ))}
      </div>
      {meta?.rejectedEntries > 0 && (
        <div className="warn-line">
          {meta.rejectedEntries} entry signal{meta.rejectedEntries === 1 ? " was" : "s were"} skipped because no position could be sized
          {meta.rejectReason ? ` — ${meta.rejectReason}` : ""}. Risk-% sizing needs a stop loss.
        </div>
      )}
    </div>
  );
}

// ── MAE / MFE excursion analysis ─────────────────────────────────────────────
export function ExcursionPanel({ ex }) {
  if (!ex || ex.count === 0) return null;
  const bars = ex.rDistribution || [];
  const maxN = Math.max(1, ...bars.map(b => b.count));
  return (
    <div className="card">
      <div className="card-h"><Target size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Trade Excursions (MAE / MFE)</div>
      <div className="dim exc-intro">
        MAE is how far a trade went against you before it resolved; MFE is how far it went in your favour.
        Together they tell you whether your stop is too tight and your target too far.
      </div>
      <div className="rm-grid">
        <div className="rm-cell" title="Average worst-case excursion across all trades, in R."><div className="rm-lbl">Avg MAE</div><div className="rm-val">{f2(ex.avgMaeR)}R</div></div>
        <div className="rm-cell" title="Average best-case excursion across all trades, in R."><div className="rm-lbl">Avg MFE</div><div className="rm-val">{f2(ex.avgMfeR)}R</div></div>
        <div className="rm-cell" title="How far winners ran at their best."><div className="rm-lbl">Winners' MFE</div><div className="rm-val green">{f2(ex.avgWinMfeR)}R</div></div>
        <div className="rm-cell" title="How far losers went against you. If this is far below 1R your stop is rarely the binding constraint."><div className="rm-lbl">Losers' MAE</div><div className="rm-val red">{f2(ex.avgLossMaeR)}R</div></div>
      </div>
      <div className="exc-advice">
        <div className="exc-rec">
          <span className="exc-rec-l">Suggested stop</span>
          <span className="exc-rec-v">{f2(ex.suggestedStopR)}R</span>
          <span className="dim">90th percentile of the heat winning trades took — a stop tighter than this kills trades that would have worked.</span>
        </div>
        <div className="exc-rec">
          <span className="exc-rec-l">Suggested target</span>
          <span className="exc-rec-v">{f2(ex.suggestedTargetR)}R</span>
          <span className="dim">Median peak a winner reached — asking for much more than this leaves profit on the table more often than it collects.</span>
        </div>
      </div>
      {bars.length > 0 && (
        <>
          <div className="rd-title">R-multiple distribution</div>
          <div className="rd-chart">
            {bars.map((b, i) => (
              <div className="rd-col" key={i} title={`${b.shortLabel}: ${b.count} trade${b.count === 1 ? "" : "s"}`}>
                <div className="rd-bar-wrap">
                  <div className={`rd-bar ${b.mid >= 0 ? "pos" : "neg"}`} style={{ height: `${(b.count / maxN) * 100}%` }} />
                </div>
                <div className="rd-lbl">{b.shortLabel}</div>
                <div className="rd-n">{b.count || ""}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Regime split tables ──────────────────────────────────────────────────────
function RegimeTable({ title, rows, hint }) {
  if (!rows || !rows.length) return null;
  const best = rows.reduce((a, b) => (b.netPnl > (a?.netPnl ?? -Infinity) ? b : a), null);
  const worst = rows.reduce((a, b) => (b.netPnl < (a?.netPnl ?? Infinity) ? b : a), null);
  return (
    <div className="reg-block">
      <div className="reg-title">{title}{hint && <span className="dim"> — {hint}</span>}</div>
      <table className="tbl reg-tbl">
        <thead><tr><th scope="col">Bucket</th><th scope="col">Trades</th><th scope="col">Win%</th><th scope="col">Net P&amp;L</th><th scope="col">Exp (R)</th><th scope="col">PF</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.bucket} className={r === best && rows.length > 1 ? "reg-best" : r === worst && rows.length > 1 ? "reg-worst" : ""}>
              <td>{r.bucket}</td>
              <td className="mono">{r.trades}</td>
              <td className="mono">{f2(r.winRate, 1)}%</td>
              <td className={`mono ${r.netPnl >= 0 ? "green" : "red"}`}>{inr0(r.netPnl)}</td>
              <td className={`mono ${r.expectancyR == null ? "" : r.expectancyR >= 0 ? "green" : "red"}`}>{f2(r.expectancyR)}</td>
              <td className="mono">{pf(r.profitFactor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RegimePanel({ regime }) {
  if (!regime) return null;
  const any = ["byAdx","byVol","bySide","byHour","byWeekday","byExitReason"].some(k => regime[k]?.length);
  if (!any) return null;
  return (
    <div className="card">
      <div className="card-h"><Layers size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Where the Edge Actually Lives</div>
      <div className="dim exc-intro">
        The same strategy is rarely equally good everywhere. A bucket with many trades and a negative expectancy
        is a filter you should add; a bucket with three trades is noise, not a discovery.
      </div>
      <div className="reg-grid">
        <RegimeTable title="Trend strength (ADX)" rows={regime.byAdx} hint="below 20 is chop, above 40 is a strong trend" />
        <RegimeTable title="Volatility regime (ATR percentile)" rows={regime.byVol} hint="ATR rank vs its own history" />
        <RegimeTable title="Direction" rows={regime.bySide} />
        <RegimeTable title="Exit reason" rows={regime.byExitReason} hint="how trades actually ended" />
        <RegimeTable title="Hour of day (IST)" rows={regime.byHour} />
        <RegimeTable title="Weekday" rows={regime.byWeekday} />
      </div>
    </div>
  );
}

// ── Monthly returns heatmap ──────────────────────────────────────────────────
export function MonthlyPanel({ monthly }) {
  if (!monthly || !monthly.length) return null;
  const byYear = {};
  for (const m of monthly) {
    const [y, mm] = m.month.split("-");
    (byYear[y] = byYear[y] || {})[+mm - 1] = m;
  }
  const years = Object.keys(byYear).sort();
  const mags = monthly.map(m => Math.abs(m.retPct));
  const cap = Math.max(1, ...mags);
  const cellStyle = (v) => {
    if (v == null) return {};
    const a = Math.min(1, Math.abs(v) / cap) * 0.82 + 0.08;
    return { background: v >= 0 ? `rgba(34,197,94,${a})` : `rgba(239,68,68,${a})`, color: a > 0.5 ? "#fff" : "inherit" };
  };
  return (
    <div className="card">
      <div className="card-h"><Clock size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Monthly Returns</div>
      <div className="tbl-wrap">
        <table className="tbl mo-tbl">
          <thead><tr><th scope="col">Year</th>{MONTHS.map(m => <th scope="col" key={m}>{m}</th>)}<th scope="col">Year</th></tr></thead>
          <tbody>
            {years.map(y => {
              const row = byYear[y];
              const tot = Object.values(row).reduce((s, m) => s * (1 + m.retPct / 100), 1);
              const totPct = (tot - 1) * 100;
              return (
                <tr key={y}>
                  <td className="mono" style={{ fontWeight: 700 }}>{y}</td>
                  {MONTHS.map((_, i) => (
                    <td key={i} className="mono mo-cell" style={cellStyle(row[i]?.retPct)}
                      title={row[i] ? `${y}-${String(i+1).padStart(2,"0")}: ${row[i].retPct.toFixed(2)}%` : ""}>
                      {row[i] ? row[i].retPct.toFixed(1) : ""}
                    </td>
                  ))}
                  <td className={`mono ${totPct >= 0 ? "green" : "red"}`} style={{ fontWeight: 700 }}>{totPct.toFixed(1)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="dim" style={{ fontSize: 11, marginTop: 6 }}>
        Percent change in equity within each calendar month. Year column compounds the months, so it will not equal their sum.
      </div>
    </div>
  );
}
