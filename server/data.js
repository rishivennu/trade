// Yahoo Finance public API wrapper. No key required.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) TradingTerminal/1.0";

export async function fetchCandles(symbol, interval = "5m", range = "1d") {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Yahoo ${res.status}: ${res.statusText}`);
  const data = await res.json();
  const r = data?.chart?.result?.[0];
  if (!r || !r.timestamp) throw new Error(data?.chart?.error?.description || "No data returned");
  const q = r.indicators.quote[0];
  const candles = r.timestamp.map((t, i) => ({
    time: t, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume?.[i] ?? 0,
  })).filter(c => c.open != null && c.close != null);
  return {
    symbol: r.meta.symbol, currency: r.meta.currency, exchange: r.meta.fullExchangeName,
    timezone: r.meta.exchangeTimezoneName, interval, range,
    lastPrice: r.meta.regularMarketPrice, prevClose: r.meta.chartPreviousClose, candles,
  };
}

// Quote snapshot for multiple symbols (watchlist)
export async function fetchQuotes(symbols) {
  const out = [];
  const CHUNK = 6;
  for (let i = 0; i < symbols.length; i += CHUNK) {
    const batch = symbols.slice(i, i + CHUNK);
    const results = await Promise.allSettled(batch.map(async s => {
      const d = await fetchCandles(s, "1d", "5d");
      const last = d.candles[d.candles.length - 1];
      const prev = d.prevClose || d.candles[d.candles.length - 2]?.close;
      return { symbol: s, price: last?.close, change: last?.close - prev, changePct: ((last?.close - prev) / prev) * 100 };
    }));
    out.push(...results.filter(r => r.status === "fulfilled").map(r => r.value));
    if (i + CHUNK < symbols.length) await new Promise(r => setTimeout(r, 120));
  }
  return out;
}

export const INSTRUMENTS = [
  // F&O Indices
  { symbol: "^NSEI",        name: "NIFTY 50",             group: "F&O Indices" },
  { symbol: "^NSEBANK",     name: "BANK NIFTY",           group: "F&O Indices" },
  { symbol: "NIFTY_FIN_SERVICE.NS", name: "FIN NIFTY",    group: "F&O Indices" },
  { symbol: "^CNXIT",       name: "NIFTY IT",             group: "F&O Indices" },
  { symbol: "^BSESN",       name: "BSE SENSEX",           group: "F&O Indices" },
  { symbol: "^INDIAVIX",    name: "India VIX",            group: "F&O Indices" },
  // F&O Banking/Financials
  { symbol: "HDFCBANK.NS",  name: "HDFC Bank",            group: "F&O · Banking" },
  { symbol: "ICICIBANK.NS", name: "ICICI Bank",           group: "F&O · Banking" },
  { symbol: "SBIN.NS",      name: "State Bank of India",  group: "F&O · Banking" },
  { symbol: "KOTAKBANK.NS", name: "Kotak Mahindra Bank",  group: "F&O · Banking" },
  { symbol: "AXISBANK.NS",  name: "Axis Bank",            group: "F&O · Banking" },
  { symbol: "BAJFINANCE.NS",name: "Bajaj Finance",        group: "F&O · Banking" },
  { symbol: "BAJAJFINSV.NS",name: "Bajaj Finserv",        group: "F&O · Banking" },
  // F&O IT
  { symbol: "TCS.NS",       name: "TCS",                  group: "F&O · IT" },
  { symbol: "INFY.NS",      name: "Infosys",              group: "F&O · IT" },
  { symbol: "WIPRO.NS",     name: "Wipro",                group: "F&O · IT" },
  { symbol: "HCLTECH.NS",   name: "HCL Technologies",     group: "F&O · IT" },
  { symbol: "TECHM.NS",     name: "Tech Mahindra",        group: "F&O · IT" },
  // F&O Energy/Metals
  { symbol: "RELIANCE.NS",  name: "Reliance Industries",  group: "F&O · Energy" },
  { symbol: "ONGC.NS",      name: "ONGC",                 group: "F&O · Energy" },
  { symbol: "NTPC.NS",      name: "NTPC",                 group: "F&O · Energy" },
  { symbol: "POWERGRID.NS", name: "Power Grid",           group: "F&O · Energy" },
  { symbol: "TATASTEEL.NS", name: "Tata Steel",           group: "F&O · Metals" },
  { symbol: "HINDALCO.NS",  name: "Hindalco",             group: "F&O · Metals" },
  { symbol: "JSWSTEEL.NS",  name: "JSW Steel",            group: "F&O · Metals" },
  { symbol: "COALINDIA.NS", name: "Coal India",           group: "F&O · Metals" },
  // F&O Auto
  { symbol: "TATAMOTORS.NS",name: "Tata Motors",          group: "F&O · Auto" },
  { symbol: "M&M.NS",       name: "Mahindra & Mahindra",  group: "F&O · Auto" },
  { symbol: "MARUTI.NS",    name: "Maruti Suzuki",        group: "F&O · Auto" },
  { symbol: "BAJAJ-AUTO.NS",name: "Bajaj Auto",           group: "F&O · Auto" },
  { symbol: "EICHERMOT.NS", name: "Eicher Motors",        group: "F&O · Auto" },
  // F&O FMCG/Pharma
  { symbol: "ITC.NS",       name: "ITC",                  group: "F&O · FMCG" },
  { symbol: "HINDUNILVR.NS",name: "Hindustan Unilever",   group: "F&O · FMCG" },
  { symbol: "NESTLEIND.NS", name: "Nestle India",         group: "F&O · FMCG" },
  { symbol: "SUNPHARMA.NS", name: "Sun Pharma",           group: "F&O · Pharma" },
  { symbol: "DRREDDY.NS",   name: "Dr Reddy's",           group: "F&O · Pharma" },
  { symbol: "CIPLA.NS",     name: "Cipla",                group: "F&O · Pharma" },
  // F&O Others
  { symbol: "BHARTIARTL.NS",name: "Bharti Airtel",        group: "F&O · Others" },
  { symbol: "LT.NS",        name: "Larsen & Toubro",      group: "F&O · Others" },
  { symbol: "ADANIENT.NS",  name: "Adani Enterprises",    group: "F&O · Others" },
  { symbol: "ADANIPORTS.NS",name: "Adani Ports",          group: "F&O · Others" },
  { symbol: "ASIANPAINT.NS",name: "Asian Paints",         group: "F&O · Others" },
  { symbol: "TITAN.NS",     name: "Titan Company",        group: "F&O · Others" },
  { symbol: "DMART.NS",     name: "Avenue Supermarts",    group: "F&O · Others" },
  // Global Futures
  { symbol: "ES=F",         name: "S&P 500 E-mini",       group: "Global Futures" },
  { symbol: "NQ=F",         name: "Nasdaq 100 E-mini",    group: "Global Futures" },
  // Crypto
  { symbol: "BTC-USD",      name: "Bitcoin",              group: "Crypto" },
  { symbol: "ETH-USD",      name: "Ethereum",             group: "Crypto" },
  // ── Forex Majors ──
  { symbol: "EURUSD=X",     name: "EUR / USD",            group: "Forex · Majors" },
  { symbol: "GBPUSD=X",     name: "GBP / USD",            group: "Forex · Majors" },
  { symbol: "USDJPY=X",     name: "USD / JPY",            group: "Forex · Majors" },
  { symbol: "USDCHF=X",     name: "USD / CHF",            group: "Forex · Majors" },
  { symbol: "AUDUSD=X",     name: "AUD / USD",            group: "Forex · Majors" },
  { symbol: "USDCAD=X",     name: "USD / CAD",            group: "Forex · Majors" },
  { symbol: "NZDUSD=X",     name: "NZD / USD",            group: "Forex · Majors" },
  { symbol: "USDINR=X",     name: "USD / INR",            group: "Forex · Majors" },
  // ── Forex Crosses ──
  { symbol: "EURGBP=X",     name: "EUR / GBP",            group: "Forex · Crosses" },
  { symbol: "EURJPY=X",     name: "EUR / JPY",            group: "Forex · Crosses" },
  { symbol: "GBPJPY=X",     name: "GBP / JPY",            group: "Forex · Crosses" },
  { symbol: "AUDJPY=X",     name: "AUD / JPY",            group: "Forex · Crosses" },
  { symbol: "EURAUD=X",     name: "EUR / AUD",            group: "Forex · Crosses" },
  { symbol: "GBPINR=X",     name: "GBP / INR",            group: "Forex · Crosses" },
  { symbol: "EURINR=X",     name: "EUR / INR",            group: "Forex · Crosses" },
  // ── Commodities · Metals ──
  { symbol: "GC=F",         name: "Gold · XAU/USD",       group: "Commodities · Metals" },
  { symbol: "SI=F",         name: "Silver (COMEX)",       group: "Commodities · Metals" },
  { symbol: "HG=F",         name: "Copper",               group: "Commodities · Metals" },
  { symbol: "PL=F",         name: "Platinum",             group: "Commodities · Metals" },
  { symbol: "PA=F",         name: "Palladium",            group: "Commodities · Metals" },
  // ── Commodities · Energy ──
  { symbol: "CL=F",         name: "Crude Oil (WTI)",      group: "Commodities · Energy" },
  { symbol: "BZ=F",         name: "Brent Crude",          group: "Commodities · Energy" },
  { symbol: "NG=F",         name: "Natural Gas",          group: "Commodities · Energy" },
  { symbol: "RB=F",         name: "RBOB Gasoline",        group: "Commodities · Energy" },
  { symbol: "HO=F",         name: "Heating Oil",          group: "Commodities · Energy" },
  // ── Commodities · Agriculture ──
  { symbol: "ZC=F",         name: "Corn",                 group: "Commodities · Ags" },
  { symbol: "ZW=F",         name: "Wheat",                group: "Commodities · Ags" },
  { symbol: "ZS=F",         name: "Soybeans",             group: "Commodities · Ags" },
  { symbol: "KC=F",         name: "Coffee",               group: "Commodities · Ags" },
  { symbol: "SB=F",         name: "Sugar",                group: "Commodities · Ags" },
  { symbol: "CT=F",         name: "Cotton",               group: "Commodities · Ags" },
  { symbol: "CC=F",         name: "Cocoa",                group: "Commodities · Ags" },
  // ── Global Indices ──
  { symbol: "^GSPC",        name: "S&P 500",              group: "Global · Indices" },
  { symbol: "^DJI",         name: "Dow Jones",            group: "Global · Indices" },
  { symbol: "^IXIC",        name: "Nasdaq Composite",     group: "Global · Indices" },
  { symbol: "^FTSE",        name: "FTSE 100 (UK)",        group: "Global · Indices" },
  { symbol: "^GDAXI",       name: "DAX (Germany)",        group: "Global · Indices" },
  { symbol: "^N225",        name: "Nikkei 225 (Japan)",   group: "Global · Indices" },
  { symbol: "^HSI",         name: "Hang Seng (HK)",       group: "Global · Indices" },
  { symbol: "000001.SS",    name: "Shanghai Composite",   group: "Global · Indices" },
  { symbol: "^VIX",         name: "CBOE VIX",             group: "Global · Indices" },
  // ── Global Futures (extra) ──
  { symbol: "YM=F",         name: "Dow E-mini",           group: "Global Futures" },
  { symbol: "RTY=F",        name: "Russell 2000 E-mini",  group: "Global Futures" },
  { symbol: "DX=F",         name: "US Dollar Index",      group: "Global Futures" },
  { symbol: "ZB=F",         name: "US T-Bond",            group: "Global Futures" },
  // ── Crypto (extra) ──
  { symbol: "BNB-USD",      name: "BNB",                  group: "Crypto" },
  { symbol: "SOL-USD",      name: "Solana",               group: "Crypto" },
  { symbol: "XRP-USD",      name: "XRP",                  group: "Crypto" },
  { symbol: "DOGE-USD",     name: "Dogecoin",             group: "Crypto" },
  { symbol: "ADA-USD",      name: "Cardano",              group: "Crypto" },
];
