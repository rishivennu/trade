import { Wallet, Gauge, Shield, Target, Layers } from "lucide-react";

// Everything that decides HOW a signal becomes a filled, sized, charged trade.
// Kept separate from signal generation so you can hold the strategy fixed and
// see exactly what execution realism costs you.
export const CHARGE_OPTIONS = [
  ["none", "None (frictionless)"],
  ["bps", "Flat bps per side"],
  ["nse_equity_intraday", "NSE equity intraday"],
  ["nse_equity_delivery", "NSE equity delivery"],
  ["nse_futures", "NSE futures"],
];

export default function ExecutionPanel({ cfg, set, open, setOpen }) {
  const num = (k, label, step, ph, hint) => (
    <div className="field">
      <label htmlFor="executionpanel-f-1">{label}</label>
      <input id="executionpanel-f-1" className="input" type="number" step={step} value={cfg[k] ?? ""} placeholder={ph}
        onChange={e => set(k, e.target.value === "" ? 0 : +e.target.value)} />
      {hint && <span className="fhint">{hint}</span>}
    </div>
  );

  return (
    <div className="exec-panel">
      <button type="button" className="exec-toggle" onClick={() => setOpen(!open)}
        aria-expanded={open} aria-controls="exec-body">
        <Shield size={13} aria-hidden="true" /> Execution &amp; Risk Model
        <span className="exec-summary">
          {cfg.fillMode === "close" ? "close fill" : "next-bar open"} · {cfg.slipBps || 0}bps slip ·{" "}
          {cfg.sizing === "risk" ? `${cfg.riskPct}% risk` : cfg.sizing === "fixed" ? "fixed notional" : cfg.sizing === "units" ? "fixed units" : "all-in"}
          {cfg.useTargets ? " · scale-out" : ""}
        </span>
        <span className="exec-chev" aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="exec-body" id="exec-body">
          <div className="exec-group">
            <div className="exec-gh"><Layers size={12} aria-hidden="true" /> Fills &amp; Costs</div>
            <div className="bt-form">
              <div className="field">
                <label htmlFor="executionpanel-fill-mode-2">Fill Mode</label>
                <select id="executionpanel-fill-mode-2" className="select" value={cfg.fillMode || "nextOpen"} onChange={e => set("fillMode", e.target.value)}>
                  <option value="nextOpen">Next bar open (realistic)</option>
                  <option value="close">Signal bar close (legacy)</option>
                </select>
                <span className="fhint">A signal is only known once the bar closes, so the earliest honest fill is the next open. This is what TradingView does.</span>
              </div>
              <div className="field">
                <label htmlFor="executionpanel-charges-3">Charges</label>
                <select id="executionpanel-charges-3" className="select" value={cfg.chargeModel || "bps"} onChange={e => set("chargeModel", e.target.value)}>
                  {CHARGE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <span className="fhint">Indian presets include brokerage, STT, exchange txn, SEBI, stamp duty and GST. Verify the rates against your own broker.</span>
              </div>
              {num("feeBps", "Fee (bps / side)", 0.5, "0", "Only used by the flat-bps model.")}
              {num("slipBps", "Slippage (bps / side)", 0.5, "0", "Applied against you on entry and exit.")}
            </div>
          </div>

          <div className="exec-group">
            <div className="exec-gh"><Wallet size={12} aria-hidden="true" /> Position Sizing</div>
            <div className="bt-form">
              <div className="field">
                <label htmlFor="executionpanel-sizing-mode-4">Sizing Mode</label>
                <select id="executionpanel-sizing-mode-4" className="select" value={cfg.sizing || "allin"} onChange={e => set("sizing", e.target.value)}>
                  <option value="allin">All-in (whole equity)</option>
                  <option value="risk">Risk % per trade (needs a stop)</option>
                  <option value="fixed">Fixed notional</option>
                  <option value="units">Fixed units</option>
                </select>
                <span className="fhint">Risk-based sizing is the only mode where drawdown is actually controlled.</span>
              </div>
              {num("riskPct", "Risk per Trade (%)", 0.25, "1", "Fraction of current equity lost if the stop is hit.")}
              {num("notional", "Fixed Notional (₹)", 10000, "0", "Used by fixed-notional mode.")}
              {num("units", "Fixed Units", 1, "0", "Used by fixed-units mode.")}
              {num("maxLeverage", "Max Leverage", 0.5, "1", "Caps size at equity × leverage.")}
            </div>
          </div>

          <div className="exec-group">
            <div className="exec-gh"><Shield size={12} aria-hidden="true" /> Stops &amp; Exits</div>
            <div className="bt-form">
              {num("slAtr", "Stop Loss (ATR ×)", 0.25, "0 = off", "Also defines 1R, which every R-multiple metric depends on.")}
              {num("tpAtr", "Take Profit (ATR ×)", 0.25, "0 = off", "Ignored when scale-out targets are on.")}
              {num("trailAtr", "Trailing Stop (ATR ×)", 0.25, "0 = off", "Ratchets behind the best price reached.")}
              {num("maxBars", "Time Stop (bars)", 1, "0 = off", "Force-exit a trade that goes nowhere.")}
              <div className="field">
                <label htmlFor="executionpanel-allow-short-5">Allow Short</label>
                <select id="executionpanel-allow-short-5" className="select" value={cfg.allowShort ? "yes" : "no"} onChange={e => set("allowShort", e.target.value === "yes")}>
                  <option value="yes">Yes (long + short)</option>
                  <option value="no">No (long only)</option>
                </select>
              </div>
            </div>
          </div>

          <div className="exec-group">
            <div className="exec-gh"><Target size={12} aria-hidden="true" /> Scale-Out Targets</div>
            <div className="bt-form">
              <div className="field">
                <label htmlFor="executionpanel-partial-exits-6">Partial Exits</label>
                <select id="executionpanel-partial-exits-6" className="select" value={cfg.useTargets ? "yes" : "no"} onChange={e => set("useTargets", e.target.value === "yes")}>
                  <option value="no">Off (single exit)</option>
                  <option value="yes">On (TP1 / TP2 / TP3)</option>
                </select>
                <span className="fhint">Targets are in R, so they need a stop to be meaningful.</span>
              </div>
              {num("tp1R", "TP1 (R)", 0.25, "1")}
              {num("tp1Pct", "TP1 size (%)", 5, "40")}
              {num("tp2R", "TP2 (R)", 0.25, "2")}
              {num("tp2Pct", "TP2 size (%)", 5, "30")}
              {num("tp3R", "TP3 (R)", 0.25, "3")}
              {num("tp3Pct", "TP3 size (%)", 5, "30")}
              <div className="field">
                <label htmlFor="executionpanel-breakeven-after-tp1-7">Breakeven after TP1</label>
                <select id="executionpanel-breakeven-after-tp1-7" className="select" value={cfg.beAfterTp1 ? "yes" : "no"} onChange={e => set("beAfterTp1", e.target.value === "yes")}>
                  <option value="no">No</option>
                  <option value="yes">Yes (move stop to entry)</option>
                </select>
              </div>
            </div>
          </div>

          <div className="exec-note">
            <Gauge size={12} aria-hidden="true" /> Within a single OHLC bar the true order of the high and the low is unknown.
            This engine always tests the stop before the target, so results are pessimistic rather than flattering.
          </div>
        </div>
      )}
    </div>
  );
}
