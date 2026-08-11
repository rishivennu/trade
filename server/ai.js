// AI trade-signal engine — provider-agnostic (DeepSeek or Anthropic Claude).
// Reads the market snapshot (price + indicators + ICT structure) and returns a
// reasoned, structured trade signal. No SDK — plain fetch. Key from .env.
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Minimal .env loader (no dotenv dependency)
(function loadEnv() {
  const p = join(__dirname, ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
})();

export function aiProvider() {
  if (process.env.DEEPSEEK_API_KEY) return "deepseek";
  if (process.env.ANTHROPIC_API_KEY) return "claude";
  return null;
}

function buildPrompt(s) {
  const ind = s.indicators || {};
  const ict = s.ict || null;
  const lines = [];
  lines.push(`Instrument: ${s.symbol}  |  Timeframe: ${s.interval}  |  Current price: ${s.price}`);
  if (s.prevClose != null) lines.push(`Prev close: ${s.prevClose}  |  Day change: ${(((s.price - s.prevClose) / s.prevClose) * 100).toFixed(2)}%`);
  lines.push("");
  lines.push("INDICATORS (latest):");
  for (const [k, v] of Object.entries(ind)) if (v != null) lines.push(`  ${k}: ${typeof v === "number" ? v.toFixed(2) : v}`);
  if (ict) {
    lines.push("");
    lines.push("ICT / SMART-MONEY STRUCTURE:");
    lines.push(`  Trend: ${ict.trend}`);
    lines.push(`  Last Break of Structure: ${ict.lastBoS}`);
    lines.push(`  Killzone: ${ict.killzone || "off-session"} (in killzone: ${ict.inKillzone})`);
    lines.push(`  Active Demand OB (support): ${ict.activeDemand ? ict.activeDemand.proximal : "none"}`);
    lines.push(`  Active Supply OB (resistance): ${ict.activeSupply ? ict.activeSupply.proximal : "none"}`);
    lines.push(`  Confluence score  Long: ${ict.confluenceLong}/5   Short: ${ict.confluenceShort}/5`);
    lines.push(`  ATR(14): ${ict.atr}`);
  }
  if (s.recentCandles?.length) {
    lines.push("");
    lines.push("RECENT CANDLES (oldest→newest, O/H/L/C):");
    for (const c of s.recentCandles) lines.push(`  ${c.o}/${c.h}/${c.l}/${c.c}`);
  }
  return lines.join("\n");
}

const SYSTEM = `You are an elite intraday futures & options trader specialising in ICT / Smart Money Concepts and classical technical analysis for Indian (NSE) and global markets.
Analyse the provided market snapshot and issue ONE actionable trade decision.
Weigh: market structure & trend, break of structure, order blocks (demand=support, supply=resistance), killzone timing, and indicator confluence (EMA, RSI, MACD, Bollinger, VWAP). Respect risk: never suggest a trade with reward:risk below 1.5 unless confidence is very high.
Respond with STRICT JSON only, no markdown, no prose outside JSON:
{
  "signal": "BUY" | "SELL" | "HOLD",
  "confidence": <integer 0-100>,
  "entry": <number>,
  "stopLoss": <number>,
  "target": <number>,
  "riskReward": <number, one decimal>,
  "timeframe": "<intraday|swing>",
  "rationale": "<2-4 sentence explanation citing the strongest confluences>",
  "keyLevels": "<brief note of key support/resistance>"
}`;

async function callDeepSeek(prompt, model) {
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
    body: JSON.stringify({
      model: model || "deepseek-chat",
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }],
      temperature: 0.3,
      response_format: { type: "json_object" },
      max_tokens: 700,
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return j.choices?.[0]?.message?.content || "";
}

async function callClaude(prompt, model) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: model || "claude-3-5-sonnet-20241022",
      max_tokens: 700,
      temperature: 0.3,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt + "\n\nRespond with the JSON object only." }],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return j.content?.[0]?.text || "";
}

function parseJSON(txt) {
  let t = txt.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return JSON.parse(t);
}

export async function getAISignal(snapshot) {
  const provider = aiProvider();
  if (!provider) {
    const e = new Error("No AI key configured. Add DEEPSEEK_API_KEY or ANTHROPIC_API_KEY to server/.env");
    e.code = "NO_KEY";
    throw e;
  }
  const prompt = buildPrompt(snapshot);
  const raw = provider === "deepseek"
    ? await callDeepSeek(prompt, snapshot.model)
    : await callClaude(prompt, snapshot.model);
  let parsed;
  try { parsed = parseJSON(raw); }
  catch (e) { throw new Error("AI returned unparseable output: " + raw.slice(0, 160)); }
  return { provider, ...parsed, at: new Date().toISOString() };
}
