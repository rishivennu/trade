// NSE India public API — near-real-time LTP during market hours (09:15-15:30 IST).
// Requires a cookie handshake + browser-like headers. No API key.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const BASE_HEADERS = {
  "User-Agent": UA,
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.nseindia.com/",
};

let cookie = null;
let cookieTime = 0;
const COOKIE_TTL = 8 * 60 * 1000; // refresh every 8 min

async function ensureCookie(force = false) {
  if (!force && cookie && Date.now() - cookieTime < COOKIE_TTL) return cookie;
  try {
    const res = await fetch("https://www.nseindia.com/option-chain", {
      headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(10000),
    });
    const setCookies = res.headers.getSetCookie?.() || [];
    if (setCookies.length) {
      cookie = setCookies.map(c => c.split(";")[0]).join("; ");
      cookieTime = Date.now();
    }
  } catch (e) { /* keep old cookie */ }
  return cookie;
}

async function nseGet(path) {
  await ensureCookie();
  const url = `https://www.nseindia.com${path}`;
  let res = await fetch(url, { headers: { ...BASE_HEADERS, Cookie: cookie || "" }, signal: AbortSignal.timeout(10000) });
  if (res.status === 401 || res.status === 403) {
    await ensureCookie(true);
    res = await fetch(url, { headers: { ...BASE_HEADERS, Cookie: cookie || "" }, signal: AbortSignal.timeout(10000) });
  }
  if (!res.ok) throw new Error(`NSE ${res.status}`);
  return res.json();
}

// Yahoo symbol -> NSE index name
const IDX_MAP = {
  "^NSEI": "NIFTY 50",
  "^NSEBANK": "NIFTY BANK",
  "NIFTY_FIN_SERVICE.NS": "NIFTY FINANCIAL SERVICES",
  "^CNXIT": "NIFTY IT",
  "^INDIAVIX": "INDIA VIX",
};

let idxCache = { at: 0, data: null };
async function allIndices() {
  if (idxCache.data && Date.now() - idxCache.at < 1000) return idxCache.data;
  const json = await nseGet("/api/allIndices");
  const map = {};
  for (const row of json.data || []) {
    map[row.index] = { last: row.last, change: row.variation, pct: row.percentChange, prevClose: row.previousClose };
  }
  idxCache = { at: Date.now(), data: map };
  return map;
}

async function warmSymbol(nseSymbol) {
  try {
    const res = await fetch(`https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(nseSymbol)}`, {
      headers: { "User-Agent": UA, "Accept": "text/html", "Referer": "https://www.nseindia.com/", Cookie: cookie || "" },
      signal: AbortSignal.timeout(10000),
    });
    const sc = res.headers.getSetCookie?.() || [];
    if (sc.length) {
      const extra = sc.map(c => c.split(";")[0]);
      const have = new Set((cookie||"").split("; ").map(c=>c.split("=")[0]));
      const merged = (cookie ? cookie.split("; ") : []).concat(extra.filter(c=>!have.has(c.split("=")[0])));
      cookie = merged.join("; "); cookieTime = Date.now();
    }
  } catch (e) {}
}

async function equityQuote(nseSymbol) {
  const path = `/api/quote-equity?symbol=${encodeURIComponent(nseSymbol)}`;
  let json;
  try { json = await nseGet(path); }
  catch (e) { await warmSymbol(nseSymbol); json = await nseGet(path); }
  const p = json.priceInfo;
  if (!p) throw new Error("no priceInfo");
  return { last: p.lastPrice, change: p.change, pct: p.pChange, prevClose: p.previousClose };
}

export function isNSESymbol(sym) {
  return IDX_MAP[sym] != null || sym.endsWith(".NS");
}

// Returns { symbol, last, change, pct, source } or throws
export async function getLive(yahooSymbol) {
  if (IDX_MAP[yahooSymbol]) {
    const idx = await allIndices();
    const q = idx[IDX_MAP[yahooSymbol]];
    if (!q) throw new Error("index not found");
    return { symbol: yahooSymbol, ...q, source: "NSE" };
  }
  if (yahooSymbol.endsWith(".NS")) {
    const nseSym = yahooSymbol.replace(".NS", "");
    const q = await equityQuote(nseSym);
    return { symbol: yahooSymbol, ...q, source: "NSE" };
  }
  throw new Error("not an NSE symbol");
}

// Batch live for all index symbols (single allIndices call)
export async function getLiveIndices(symbols) {
  const idx = await allIndices();
  const out = [];
  for (const s of symbols) {
    if (IDX_MAP[s] && idx[IDX_MAP[s]]) out.push({ symbol: s, ...idx[IDX_MAP[s]], source: "NSE" });
  }
  return out;
}

// Market status from NSE (authoritative), cached 30s; falls back to IST time heuristic
let msCache = { at: 0, open: false };
export async function nseMarketOpen() {
  if (Date.now() - msCache.at < 30000) return msCache.open;
  try {
    const j = await nseGet('/api/marketStatus');
    const cap = (j.marketState || []).find(m => m.market === 'Capital Market');
    msCache = { at: Date.now(), open: cap ? cap.marketStatus === 'Open' : false };
  } catch (e) {
    const now = new Date();
    const mins = ((now.getUTCHours()*60+now.getUTCMinutes())+330)%1440;
    const day = new Date(now.getTime()+330*60000).getUTCDay();
    msCache = { at: Date.now(), open: day>=1 && day<=5 && mins>=(9*60+15) && mins<=(15*60+30) };
  }
  return msCache.open;
}
