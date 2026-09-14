// Keyless headline pipeline: Yahoo Finance per-ticker RSS + CNBC top news.
// Deterministic transmission-channel tagging. No LLM, no keys.
// "What printed while New York slept."
export interface Headline {
  title: string;
  link: string;
  pubDate: string; // ISO or ""
  source: string; // "Yahoo Finance" | "CNBC"
  tickers: string[]; // native symbols mentioned
  channels: string[]; // transmission channels
  weekendWindow: boolean; // published since last Friday 16:00 ET
}

export const CHANNELS: Record<string, string[]> = {
  FED_RATES: ["fed", "powell", "fomc", "rate cut", "rate hike", "interest rate", "inflation", "cpi", "ppi", "payrolls", "dot plot"],
  TRADE_POLICY: ["tariff", "china", "export ban", "export control", "trade war", "sanction", "taiwan"],
  AI_DEMAND: ["nvidia", "blackwell", "datacenter", "data center", "hyperscaler", "openai", "anthropic", "ai chip", "h100", "gpu"],
  EARNINGS: ["earnings", "guidance", "beats", "misses", "revenue", "outlook", "downgrade", "upgrade", "price target"],
  GEOPOLITICS: ["war", "strike", "missile", "opec", "oil", "gaza", "ukraine", "iran", "korea"],
  MARKET_STRESS: ["selloff", "sell-off", "plunge", "crash", "volatility", "vix", "recession", "default", "downgrade"],
};

const TICKER_ALIASES: Record<string, string[]> = {
  NVDA: ["nvidia", "nvda"],
  AAPL: ["apple", "aapl"],
  TSLA: ["tesla", "tsla", "musk"],
  MSFT: ["microsoft", "msft"],
  META: ["meta", "facebook", "instagram", "zuckerberg"],
  AMZN: ["amazon", "amzn", "aws"],
  GOOGL: ["alphabet", "google", "googl", "gemini"],
  AMD: ["amd", "lisa su"],
  MU: ["micron", "hbm", "dram"],
  SPY: ["s&p", "s&p 500", "wall street", "stocks slip", "stocks rise", "stock market", " Dow ", "nasdaq"],
  QQQ: ["nasdaq", "nasdaq 100", "tech stocks"],
  BTC: ["bitcoin", "btc", "crypto"],
};

/** Full HTML entity decoder: named + numeric (decimal & hex). */
function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const cp = parseInt(hex, 16);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : "";
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const cp = Number(dec);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : "";
    })
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

/** Minimal RSS item parser (no deps). Returns raw items. */
export function parseRss(xml: string): { title: string; link: string; pubDate: string }[] {
  const items: { title: string; link: string; pubDate: string }[] = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/g) ?? [];
  for (const b of blocks) {
    const title = decodeEntities(b.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
    const link = decodeEntities(b.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "");
    const pubDate = decodeEntities(b.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? "");
    if (title) items.push({ title, link, pubDate });
  }
  return items;
}

/** Last Friday 16:00 ET in ms. ET offset is coarse (EDT Apr–Sep, EST otherwise) and labeled in-UI. */
export function lastFridayCloseET(nowMs = Date.now()): number {
  const d = new Date(nowMs);
  const utcDay = d.getUTCDay();
  const month = d.getUTCMonth();
  const etOffsetH = month >= 3 && month <= 9 ? 4 : 5;
  // Friday 16:00 ET = Friday (16+offset) UTC
  const daysSinceFri = (utcDay + 7 - 5) % 7;
  const fridayUTC = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysSinceFri, 16 + etOffsetH, 0, 0));
  // If now is before this week's Friday close (Sat before? no—Sat/Sun after Fri), i.e. Mon–Fri morning: use this week's coming... actually past Friday:
  if (fridayUTC.getTime() > nowMs) fridayUTC.setUTCDate(fridayUTC.getUTCDate() - 7);
  return fridayUTC.getTime();
}

export function tagHeadline(title: string, pubDate: string, source: string, fridayCloseMs: number): Headline {
  const low = ` ${title.toLowerCase()} `;
  const tickers = Object.entries(TICKER_ALIASES)
    .filter(([, aliases]) => aliases.some((a) => low.includes(a)))
    .map(([t]) => t);
  const channels = Object.entries(CHANNELS)
    .filter(([, kws]) => kws.some((k) => low.includes(k)))
    .map(([c]) => c);
  const t = pubDate ? new Date(pubDate).getTime() : NaN;
  return {
    title,
    link: "",
    pubDate: Number.isFinite(t) ? new Date(t).toISOString() : "",
    source,
    tickers,
    channels,
    weekendWindow: Number.isFinite(t) ? t >= fridayCloseMs : false,
  };
}

/** Relevance to a proposal ticker: direct mention OR macro channel (moves everything). */
export function relevantHeadlines(all: Headline[], ticker: string, limit = 8): Headline[] {
  const t = ticker.toUpperCase();
  const macro = new Set(["FED_RATES", "TRADE_POLICY", "GEOPOLITICS", "MARKET_STRESS"]);
  const scored = all.map((h) => {
    let score = 0;
    if (h.tickers.includes(t)) score += 3;
    if (h.channels.some((c) => macro.has(c))) score += 1;
    if (h.weekendWindow) score += 2;
    if (h.tickers.includes("SPY") || h.tickers.includes("QQQ")) score += 1;
    return { h, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || (a.h.pubDate < b.h.pubDate ? 1 : -1))
    .slice(0, limit)
    .map((s) => s.h);
}
