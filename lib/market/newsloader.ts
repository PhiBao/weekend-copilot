// Runtime headline loader.
//   1) live keyless RSS from the request path (verified reachable from Vercel
//      egress: CNBC + MarketWatch answer in ~100ms), cached per instance;
//   2) committed snapshot fallback (data/news_raw.json) so the demo survives
//      a feed outage and the receipt signature stays reproducible.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { lastFridayCloseET, parseRss, tagHeadline, type Headline } from "./news";

export interface NewsState {
  headlines: Headline[];
  fetchedAt: string | null;
  stale: boolean;
  feeds: number;
  origin: "live" | "snapshot" | "empty";
}

const FRESH_HOURS = 96;
const LIVE_TTL_MS = 30 * 60 * 1000; // positive cache: 30 min per instance
const LIVE_FAIL_TTL_MS = 10 * 60 * 1000; // negative cache: don't retry a hung feed every request
const FEED_TIMEOUT_MS = 6000;

const FEEDS = [
  { source: "CNBC", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html" },
  { source: "CNBC Tech", url: "https://www.cnbc.com/id/10000664/device/rss/rss.html" },
  { source: "CNBC Markets", url: "https://www.cnbc.com/id/10000113/device/rss/rss.html" },
  { source: "MarketWatch", url: "https://feeds.marketwatch.com/marketwatch/topstories/" },
];

let liveCache: { at: number; state: NewsState } | null = null;
let liveFailUntil = 0;

async function fetchFeed(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FEED_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; WeekendCopilot/1.0)" } });
    if (!res.ok) return null;
    const text = await res.text();
    return text.length > 500 ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function buildHeadlines(sources: { source: string; xml: string }[], nowMs: number): Headline[] {
  const fridayClose = lastFridayCloseET(nowMs);
  const seen = new Set<string>();
  const headlines: Headline[] = [];
  for (const s of sources) {
    for (const item of parseRss(s.xml)) {
      const key = item.title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const h = tagHeadline(item.title, item.pubDate, s.source, fridayClose);
      h.link = item.link;
      if (h.pubDate && nowMs - new Date(h.pubDate).getTime() > FRESH_HOURS * 3600000) continue;
      headlines.push(h);
    }
  }
  headlines.sort((a, b) => (a.pubDate < b.pubDate ? 1 : -1));
  return headlines;
}

/** Live fetch across all feeds in parallel; null when nothing usable came back. */
async function liveHeadlines(nowMs: number): Promise<NewsState | null> {
  const settled = await Promise.all(
    FEEDS.map(async (f) => {
      const xml = await fetchFeed(f.url);
      return xml ? { source: f.source, xml } : null;
    })
  );
  const ok = settled.filter((x): x is { source: string; xml: string } => x !== null);
  if (ok.length === 0) return null;
  const headlines = buildHeadlines(ok, nowMs);
  const usable = headlines.filter((h) => h.tickers.length > 0 || h.channels.length > 0);
  if (usable.length < 8) return null;
  return { headlines, fetchedAt: new Date(nowMs).toISOString(), stale: false, feeds: ok.length, origin: "live" };
}

/** Committed snapshot — reproducible fallback, age-labelled. */
async function snapshotHeadlines(nowMs: number): Promise<NewsState> {
  try {
    const raw = JSON.parse(await readFile(join(process.cwd(), "data", "news_raw.json"), "utf8")) as {
      fetchedAt?: string;
      feeds?: { query?: string; source?: string; xml?: string }[];
    };
    const sources = (raw.feeds ?? [])
      .filter((f) => (f.xml ?? "").length > 500)
      .map((f) => ({ source: f.source ?? "RSS", xml: f.xml as string }));
    const headlines = buildHeadlines(sources, nowMs);
    const ageH = raw.fetchedAt ? (nowMs - new Date(raw.fetchedAt).getTime()) / 3600000 : Infinity;
    return {
      headlines,
      fetchedAt: raw.fetchedAt ?? null,
      stale: ageH > 24,
      feeds: sources.length,
      origin: headlines.length ? "snapshot" : "empty",
    };
  } catch {
    return { headlines: [], fetchedAt: null, stale: true, feeds: 0, origin: "empty" };
  }
}

export async function loadHeadlines(nowMs = Date.now()): Promise<NewsState> {
  if (liveFailUntil && nowMs < liveFailUntil) return snapshotHeadlines(nowMs);
  if (liveCache && nowMs - liveCache.at < LIVE_TTL_MS) return liveCache.state;

  const live = await liveHeadlines(nowMs);
  if (live) {
    liveCache = { at: nowMs, state: live };
    liveFailUntil = 0;
    return live;
  }
  liveFailUntil = nowMs + LIVE_FAIL_TTL_MS;
  return snapshotHeadlines(nowMs);
}
