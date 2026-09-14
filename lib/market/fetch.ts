// Keyless market-data fetchers. Bitget public + Yahoo chart + Stooq fallback.
// All return normalized daily bars. Never throws — returns { bars, source, stale }.
import { yahooTicker } from "./symbols";

export interface DailyBar {
  date: string; // YYYY-MM-DD
  close: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
}

export interface FetchResult {
  symbol: string;
  bars: DailyBar[];
  source: "yahoo" | "stooq" | "bitget" | "snapshot" | "empty";
  fetchedAt: string;
}

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

async function fetchJson(url: string, timeoutMs = 12000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(url: string, timeoutMs = 12000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

/** Yahoo v8 chart API — no key. Returns daily closes. */
export async function fetchYahooDaily(native: string, range = "2y"): Promise<FetchResult> {
  const fetchedAt = new Date().toISOString();
  try {
    const data = (await fetchJson(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker(native))}?interval=1d&range=${range}`
    )) as {
      chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: (number | null)[]; open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; volume?: (number | null)[] }> } }> };
    };
    const r = data.chart?.result?.[0];
    const ts = r?.timestamp ?? [];
    const q = r?.indicators?.quote?.[0];
    const bars: DailyBar[] = [];
    for (let i = 0; i < ts.length; i++) {
      const c = q?.close?.[i];
      if (c == null || c <= 0) continue;
      bars.push({
        date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
        close: c,
        open: q?.open?.[i] ?? undefined,
        high: q?.high?.[i] ?? undefined,
        low: q?.low?.[i] ?? undefined,
        volume: q?.volume?.[i] ?? undefined,
      });
    }
    if (bars.length < 30) throw new Error("too few bars");
    return { symbol: native, bars, source: "yahoo", fetchedAt };
  } catch {
    return { symbol: native, bars: [], source: "empty", fetchedAt };
  }
}

/** Stooq daily CSV fallback — no key. */
export async function fetchStooqDaily(native: string): Promise<FetchResult> {
  const fetchedAt = new Date().toISOString();
  try {
    const sym = native === "BTC" ? "btc.usd" : `${native.toLowerCase()}.us`;
    const txt = await fetchText(`https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=d`);
    const lines = txt.trim().split("\n");
    const bars: DailyBar[] = [];
    for (let i = 1; i < lines.length; i++) {
      const [date, o, h, l, c, v] = lines[i].split(",");
      const close = Number(c);
      if (!date || !Number.isFinite(close) || close <= 0) continue;
      bars.push({ date, close, open: Number(o) || undefined, high: Number(h) || undefined, low: Number(l) || undefined, volume: Number(v) || undefined });
    }
    if (bars.length < 30) throw new Error("too few bars");
    return { symbol: native, bars, source: "stooq", fetchedAt };
  } catch {
    return { symbol: native, bars: [], source: "empty", fetchedAt };
  }
}

/** Bitget public server time — connectivity probe (also useful pin for receipts). */
export async function fetchBitgetTime(): Promise<number | null> {
  try {
    const data = (await fetchJson("https://api.bitget.com/api/v2/public/time", 8000)) as { data?: { serverTime?: string } };
    const t = Number(data.data?.serverTime);
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

/** Bitget public candles for an rToken spot symbol (e.g. NVDAUSDT spot product). Best-effort. */
export async function fetchBitgetCandles(symbol: string, granularity = "1D", limit = "200"): Promise<{ closes: number[]; source: string }> {
  try {
    const data = (await fetchJson(
      `https://api.bitget.com/api/v2/spot/market/candles?symbol=${encodeURIComponent(symbol)}&granularity=${granularity}&limit=${limit}`,
      10000
    )) as { code?: string; data?: string[][] };
    if (data.code !== "00000" || !Array.isArray(data.data)) return { closes: [], source: "empty" };
    const closes = data.data.map((row) => Number(row[4])).filter((n) => Number.isFinite(n) && n > 0).reverse();
    return { closes, source: closes.length ? "bitget" : "empty" };
  } catch {
    return { closes: [], source: "empty" };
  }
}

/** Tiered daily fetch: Yahoo -> Stooq. Returns first non-empty. */
export async function fetchDaily(native: string): Promise<FetchResult> {
  const y = await fetchYahooDaily(native);
  if (y.bars.length >= 30) return y;
  return fetchStooqDaily(native);
}
