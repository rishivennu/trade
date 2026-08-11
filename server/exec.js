// Execution model: fills, slippage, transaction charges and position sizing.
// Kept separate from the simulator so the optimizer can vary it cheaply.

// ── Transaction charge presets ───────────────────────────────────────────────
// Rates are the published Indian retail rates at time of writing and are meant
// to be EDITED to match your own broker/segment. `pct` values are percent of
// turnover (0.025 = 0.025%). Verify against your contract note before trusting
// any net-P&L figure.
export const CHARGE_PRESETS = {
  none: { label: "No charges", brokPct: 0, brokCap: 0, sttBuyPct: 0, sttSellPct: 0, txnPct: 0, sebiPct: 0, stampBuyPct: 0, gstPct: 0 },
  bps: { label: "Flat bps (both sides)", flatBps: true },
  nse_equity_intraday: {
    label: "NSE equity intraday",
    brokPct: 0.03, brokCap: 20, sttBuyPct: 0, sttSellPct: 0.025,
    txnPct: 0.00297, sebiPct: 0.0001, stampBuyPct: 0.003, gstPct: 18,
  },
  nse_equity_delivery: {
    label: "NSE equity delivery",
    brokPct: 0, brokCap: 0, sttBuyPct: 0.1, sttSellPct: 0.1,
    txnPct: 0.00297, sebiPct: 0.0001, stampBuyPct: 0.015, gstPct: 18,
  },
  nse_futures: {
    label: "NSE index/stock futures",
    brokPct: 0.03, brokCap: 20, sttBuyPct: 0, sttSellPct: 0.02,
    txnPct: 0.00173, sebiPct: 0.0001, stampBuyPct: 0.002, gstPct: 18,
  },
};

// Cost of ONE leg (buy or sell) in currency terms.
export function legCost(turnover, isBuy, model, feeBps = 0) {
  if (!model || model.flatBps) return turnover * (+feeBps) / 10000;
  const brok = model.brokCap > 0
    ? Math.min(turnover * model.brokPct / 100, model.brokCap)
    : turnover * model.brokPct / 100;
  const stt = turnover * (isBuy ? model.sttBuyPct : model.sttSellPct) / 100;
  const txn = turnover * model.txnPct / 100;
  const sebi = turnover * model.sebiPct / 100;
  const stamp = isBuy ? turnover * model.stampBuyPct / 100 : 0;
  const gst = (brok + txn + sebi) * model.gstPct / 100;
  return brok + stt + txn + sebi + stamp + gst;
}

// Slippage: price moves against you by `slipBps` on both entry and exit.
export function applySlippage(price, side, isEntry, slipBps) {
  if (!slipBps) return price;
  const adverse = (side === "BUY") === isEntry ? 1 : -1; // buying in / selling out
  return price * (1 + adverse * (+slipBps) / 10000);
}

// ── Position sizing ─────────────────────────────────────────────────────────
// allin  : the legacy behaviour — whole equity into one position
// risk   : quantity such that a stop-out loses exactly riskPct of equity
// fixed  : a fixed cash notional per trade
// units  : a fixed share/lot count
export function sizePosition({ mode = "allin", equity, price, stop, riskPct = 1, notional = 0, units = 0, maxLeverage = 1 }) {
  const cap = Math.floor((equity * maxLeverage) / price);
  let qty;
  if (mode === "risk") {
    const perUnit = stop != null ? Math.abs(price - stop) : 0;
    if (!perUnit) return { qty: 0, reason: "risk sizing needs a stop-loss (set slAtr > 0)" };
    qty = Math.floor((equity * riskPct / 100) / perUnit);
  } else if (mode === "fixed") {
    qty = Math.floor(notional / price);
  } else if (mode === "units") {
    qty = Math.floor(units);
  } else {
    qty = cap;
  }
  qty = Math.min(qty, cap);            // never exceed available buying power
  if (!(qty > 0)) return { qty: 0, reason: "position size rounded to zero" };
  return { qty, reason: null };
}
