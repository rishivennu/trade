import { Shield, AlertTriangle, CheckCircle2, Activity, Play, Dices } from "lucide-react";

const f2 = (n, d = 2) => n == null || !isFinite(n) ? "—" : Number(n).toFixed(d);
const inr0 = (n) => n == null ? "—" : "₹" + Math.round(n).toLocaleString("en-IN");

// A distribution strip: p5 ─ p25 ─ median ─ p75 ─ p95 laid out on a shared scale.
function DistStrip({ dist, unit = "%", zeroLine = true }) {
  if (!dist) return null;
  const keys = ["p5", "p25", "median", "p75", "p95"];
  const vals = keys.map(k => dist[k]).filter(v => v != null && isFinite(v));
  if (!vals.length) return null;
  const lo = Math.min(...vals, zeroLine ? 0 : Infinity);
  const hi = Math.max(...vals, zeroLine ? 0 : -Infinity);
  const span = hi - lo || 1;
  const pos = (v) => ((v - lo) / span) * 100;
  return (
    <div className="dist">
      <div className="dist-track">
        <div className="dist-box" style={{ left: `${pos(dist.p25)}%`, width: `${pos(dist.p75) - pos(dist.p25)}%` }} />
        <div className="dist-whisk" style={{ left: `${pos(dist.p5)}%`, width: `${pos(dist.p95) - pos(dist.p5)}%` }} />
        <div className="dist-med" style={{ left: `${pos(dist.median)}%` }} />
        {zeroLine && lo <= 0 && hi >= 0 && <div className="dist-zero" style={{ left: `${pos(0)}%` }} />}
      </div>
      <div className="dist-labels">
        <span>p5 {f2(dist.p5)}{unit}</span>
        <span>p25 {f2(dist.p25)}{unit}</span>
        <span className="dist-l-med">median {f2(dist.median)}{unit}</span>
        <span>p75 {f2(dist.p75)}{unit}</span>
        <span>p95 {f2(dist.p95)}{unit}</span>
      </div>
    </div>
  );
}

export default function Robustness({ res, busy, err, onRun, symbol, interval, range }) {
  return (
    <>
      <div className="card">
        <div className="card-h"><Shield size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Robustness Tests</div>
        <div className="opt-explain">
          A single backtest is one sample from a distribution of possible outcomes. These three tests ask different
          uncomfortable questions: what if the trades had arrived in a different order, is the entry timing better than
          random, and how wide is the real uncertainty around the average trade.
        </div>
        <button className="btn btn-primary" onClick={onRun} disabled={busy}>
          <Play size={15} aria-hidden="true" />{busy ? "Running simulations…" : "Run Robustness Tests"}
        </button>
        <span className="dim" style={{ marginLeft: 10, fontSize: 11.5 }}>{symbol} · {interval} · {range} — uses the current Backtest settings</span>
      </div>

      {err && <div className="err-box" role="alert"><AlertTriangle size={14} aria-hidden="true" /> {err}</div>}
      {busy && <div className="loading" role="status" aria-live="polite">Running Monte Carlo, permutation and bootstrap simulations…</div>}

      {res?.error && <div className="warn-line">{res.error}</div>}

      {res && !res.error && <>
        {/* ── Monte Carlo ─────────────────────────────────────────────── */}
        <div className="card">
          <div className="card-h"><Dices size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Monte Carlo — Trade Order Shuffle ({res.monteCarlo.runs} runs)</div>
          <div className="dim exc-intro">
            Your trades are re-dealt in random orders. The P&amp;L total never changes, but the <em>path</em> does — and the
            path is what forces you to stop trading. If the p5 drawdown is more than you can stomach, the strategy is
            untradeable for you even though the backtest was profitable.
          </div>
          <div className="rm-grid">
            <div className="rm-cell"><div className="rm-lbl">Chance of Profit</div>
              <div className={`rm-val ${res.monteCarlo.probProfitPct >= 50 ? "green" : "red"}`}>{f2(res.monteCarlo.probProfitPct, 1)}%</div></div>
            <div className="rm-cell" title="Share of shuffles that at some point lost half the starting capital.">
              <div className="rm-lbl">Risk of 50% Ruin</div>
              <div className={`rm-val ${res.monteCarlo.riskOfRuin50Pct > 1 ? "red" : "green"}`}>{f2(res.monteCarlo.riskOfRuin50Pct, 1)}%</div></div>
            <div className="rm-cell"><div className="rm-lbl">Median Return</div><div className="rm-val">{f2(res.monteCarlo.returnPct?.median)}%</div></div>
            <div className="rm-cell"><div className="rm-lbl">Median Max DD</div><div className="rm-val red">−{f2(res.monteCarlo.maxDDPct?.median)}%</div></div>
          </div>
          <div className="dist-title">Final return distribution</div>
          <DistStrip dist={res.monteCarlo.returnPct} />
          <div className="dist-title">Maximum drawdown distribution</div>
          <DistStrip dist={res.monteCarlo.maxDDPct} zeroLine={false} />
          <div className="warn-line">
            Plan around the p95 drawdown ({f2(res.monteCarlo.maxDDPct?.p95)}%), not the one your single backtest happened to produce.
          </div>
        </div>

        {/* ── Permutation test ────────────────────────────────────────── */}
        <div className="card">
          <div className="card-h"><Activity size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Permutation Test — Is the Timing Real?</div>
          {res.permutation?.error ? <div className="warn-line">{res.permutation.error}</div> : <>
            <div className="dim exc-intro">
              Random entries are generated with the same number of trades, the same long/short mix and the same holding
              periods as your strategy. If random timing beats your strategy often, your edge is position sizing or
              plain market drift, not signal quality.
            </div>
            <div className={`wf-verdict ${res.permutation.pValue <= 0.05 ? "good" : res.permutation.pValue <= 0.2 ? "warn" : "bad"}`}>
              {res.permutation.pValue <= 0.05 ? <CheckCircle2 size={18} aria-hidden="true" /> : <AlertTriangle size={18} aria-hidden="true" />}
              <div>
                <div className="wf-v-title">{res.permutation.verdict}</div>
                <div className="wf-v-sub">
                  p = {f2(res.permutation.pValue, 4)} — {f2(res.permutation.pValue * 100, 1)}% of {res.permutation.runs} random
                  entry sets matched or beat your result. Below 5% is the conventional bar for "unlikely to be luck".
                </div>
              </div>
            </div>
            <div className="rm-grid">
              <div className="rm-cell"><div className="rm-lbl">Your Return</div><div className={`rm-val ${res.permutation.actualReturnPct >= 0 ? "green" : "red"}`}>{f2(res.permutation.actualReturnPct)}%</div></div>
              <div className="rm-cell"><div className="rm-lbl">Random Median</div><div className="rm-val">{f2(res.permutation.randomReturnPct?.median)}%</div></div>
              <div className="rm-cell"><div className="rm-lbl">Random p95</div><div className="rm-val">{f2(res.permutation.randomReturnPct?.p95)}%</div></div>
              <div className="rm-cell"><div className="rm-lbl">p-value</div><div className={`rm-val ${res.permutation.pValue <= 0.05 ? "green" : "red"}`}>{f2(res.permutation.pValue, 4)}</div></div>
            </div>
            <div className="dist-title">Random-entry return distribution (your result marked)</div>
            <DistStrip dist={res.permutation.randomReturnPct} />
          </>}
        </div>

        {/* ── Bootstrap ───────────────────────────────────────────────── */}
        <div className="card">
          <div className="card-h"><Shield size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Bootstrap Expectancy ({res.bootstrap.runs} resamples)</div>
          <div className="dim exc-intro">
            Trades are resampled with replacement to build a confidence interval around your average trade. If the
            interval straddles zero, you cannot claim a positive expectancy from this sample size, however good the total looks.
          </div>
          <div className="rm-grid">
            <div className="rm-cell"><div className="rm-lbl">Point Estimate</div>
              <div className={`rm-val ${res.bootstrap.pointEstimate >= 0 ? "green" : "red"}`}>{inr0(res.bootstrap.pointEstimate)}</div></div>
            <div className="rm-cell"><div className="rm-lbl">Chance Positive</div>
              <div className={`rm-val ${res.bootstrap.probPositivePct >= 95 ? "green" : res.bootstrap.probPositivePct >= 80 ? "lime" : "red"}`}>{f2(res.bootstrap.probPositivePct, 1)}%</div></div>
            <div className="rm-cell"><div className="rm-lbl">90% CI</div><div className="rm-val" style={{ fontSize: 14 }}>{inr0(res.bootstrap.ci90?.[0])} … {inr0(res.bootstrap.ci90?.[1])}</div></div>
            <div className="rm-cell"><div className="rm-lbl">95% CI</div><div className="rm-val" style={{ fontSize: 14 }}>{inr0(res.bootstrap.ci95?.[0])} … {inr0(res.bootstrap.ci95?.[1])}</div></div>
          </div>
          <div className={`warn-line ${res.bootstrap.ci95?.[0] > 0 ? "ok" : ""}`}>
            {res.bootstrap.ci95?.[0] > 0
              ? `The whole 95% interval is above zero on ${res.trades} trades — the positive expectancy is statistically supported.`
              : `The 95% interval includes zero on ${res.trades} trades, so a true expectancy of zero cannot be ruled out. More trades or a bigger edge are needed before sizing up.`}
          </div>
        </div>
      </>}
    </>
  );
}
