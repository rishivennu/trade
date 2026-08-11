# Trading Analysis Terminal v4 — Deploy to Vercel

Everything needed is in this folder. No git repo required: the Vercel CLI uploads
the folder directly. `vercel.json` already configures the build and the API function.

---

## 1. Unzip and open a terminal in the folder

    cd path\to\trading-terminal

## 2. Log in and deploy

    npx vercel login      # email or GitHub — opens a browser / emails a code
    npx vercel            # first run asks a few questions -> gives a preview URL
    npx vercel --prod     # promote to your production URL

First-run prompts:

| Prompt | Answer |
|---|---|
| Set up and deploy? | **Y** |
| Which scope? | your account |
| Link to existing project? | **N** |
| Project name? | **trading-terminal** (or anything) |
| In which directory is your code? | **./** (just press Enter) |
| Modify settings? | **N** — `vercel.json` already handles it |

## 3. Add the AI key (enables the AI Signal button)

Vercel dashboard -> your project -> Settings -> Environment Variables:

    DEEPSEEK_API_KEY = <your key>        (or ANTHROPIC_API_KEY)

Then redeploy: `npx vercel --prod`. See `server/.env.example` for the full list.

---

## Alternative: GitHub -> Vercel

    git init && git add . && git commit -m "trading terminal v4"
    git remote add origin https://github.com/<you>/trading-terminal.git
    git push -u origin main

Then "Add New Project" on vercel.com and import the repo. `.gitignore` already
excludes `node_modules`, `.env`, the local JSON stores and build output.

---

## How the deployment is wired

- **Frontend** — Vite builds `client/` into `client/dist`, served as static files.
- **Backend** — `api/index.js` re-exports the Express app from `server/index.js`.
  `vercel.json` rewrites `/api/*` to that single serverless function, and Express
  matches the original path, so all routes work unchanged.
- **No server listen in production** — `server/index.js` only calls `app.listen()`
  when `process.env.VERCEL` is unset, so local dev and serverless share one file.
- `client/src/api.js` points at `http://localhost:3500/api` in dev and `/api` in
  production, so no URL changes are needed.

## Run it locally instead

    cd server && npm install && node index.js        # http://localhost:3500
    cd client && npm install && npm run dev          # http://localhost:5173

---

## What's in v4

Ten tabs: **Chart, Performance, Backtest, Optimiser, Portfolio, Forward Test,
Signals, Trades, Alerts, Config.**

- Candlestick charts with indicators, ICT concepts, and a bar-by-bar replay player
- Backtesting with next-open fills, slippage, brokerage presets (NSE equity
  intraday/delivery, futures), position sizing (all-in / risk-% / fixed / units),
  partial exits at TP1-3 with breakeven shift, and MAE/MFE excursion stats
- Risk metrics: Sharpe, Sortino, Calmar, CAGR, drawdown series, streaks,
  monthly returns, and regime splits by ADX / volatility / side / hour / weekday
- Robustness: Monte Carlo, permutation test, bootstrap expectancy
- Optimiser: grid search, walk-forward, and a parameter heatmap
- Portfolio backtest across multiple symbols
- Forward (paper) testing, alert rules, and a trade journal
- A Pine Script v5 subset with real higher-timeframe `request.security`

### Accessibility and UX (v4 focus)

Audited with axe-core 4.10 across all ten tabs in both themes: **zero violations**
against WCAG 2.0/2.1 A and AA plus best-practice rules.

- Full keyboard operation. Press `?` for the shortcut list. `1`-`9` and `0` jump
  to tabs, `/` focuses instrument search, `t` toggles theme, `g` analyzes,
  `b` runs a backtest, `a` opens alerts, `Escape` closes any overlay.
- Tab bar is a proper ARIA tablist with roving tabindex and arrow-key navigation.
- Visible focus rings everywhere, a skip-to-content link, and landmark regions.
- All colour pairs meet 4.5:1 contrast in both light and dark themes.
- Toasts announce results through live regions; loading and error states use
  `role="status"` / `role="alert"`.
- Scrollable tables are keyboard-reachable and labelled.
- Responsive down to phone width; 44px touch targets on coarse pointers;
  honours `prefers-reduced-motion` and `prefers-contrast: more`.
- Your tab, theme, symbol, interval, strategy and config persist in
  `localStorage`. Config -> "Saved session" clears them.

---

## Known limits on Vercel — please read

**Data stores are ephemeral.** On Vercel, `server/db.js` and `server/forward.js`
write to `/tmp`, which is per-lambda and wiped on cold start. Paper trades, the
trade journal, alert rules and forward tests **will disappear**. For real
persistence, add Vercel KV or Postgres from the Storage tab and repoint those two
files. Locally they use `server/trading.json` and `server/forward.json` and do
persist.

**The live NSE feed will almost certainly be blocked.** NSE's Akamai bot wall
rejects datacenter IPs, so the app falls back to Yahoo. Even locally, only NSE
*index* quotes are reachable; per-stock live quotes are not.

**Yahoo data is delayed.** During market hours the intraday endpoint returns the
previous close. Treat every price as delayed, not live.

**The broker tick feed is an unverified scaffold.** `server/broker.js` reports
`tested: false` and has never received a real tick. The Upstox protobuf decoder
is deliberately unimplemented. Do not rely on it.

**Do not expose the custom-formula engine publicly.** The Config tab's custom
signal formula is evaluated server-side with `new Function`, which means anyone
who can reach your deployment can run arbitrary JavaScript in your serverless
function. Either keep the deployment private (Vercel password protection, or
Preview-only), or delete the `custom` strategy from `server/backtest.js` before
going public.

**Backtest cold starts are slow.** The first request after idle pays a lambda
cold start plus a Yahoo fetch. `maxDuration` is set to 60s; wide optimiser grids
or long portfolio runs can still time out on the Hobby plan.

### Modelling caveats

- Within a single OHLC bar the stop is always tested before the target, so
  results are deliberately pessimistic.
- Portfolio equity is realised-at-exit, so its drawdown is a floor rather than a
  true mark-to-market figure.
- `request.security` resamples the chart symbol only; cross-symbol calls throw.
  Weekly bucketing is epoch-week aligned (Thursday), not calendar-week.

---

## Not financial advice

Backtested results are hypothetical and say nothing about future performance.
Data is delayed and may be wrong. This is a research tool. Do not trade real
money off it without independent verification.
