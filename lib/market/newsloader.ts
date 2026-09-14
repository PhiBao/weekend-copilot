// Runtime headline loader: parses pinned news_raw.json, tags, filters fresh.
// Best-effort — an empty list is a valid state (labeled stale), never an error.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { lastFridayCloseET, parseRss, tagHeadline, type Headline } from "./news";

export interface NewsState {
  headlines: Headline[];
  fetchedAt: string | null;
  stale: boolean;
  feeds: number;
}

const FRESH_HOURS = 96;

export async function loadHeadlines(nowMs = Date.now()): Promise<NewsState> {
  try {
    const raw = JSON.parse(await readFile(join(process.cwd(), "data", "news_raw.json"), "utf8")) as {
      fetchedAt?: string;
      feeds?: { query?: string; source?: string; xml?: string }[];
    };
    const fridayClose = lastFridayCloseET(nowMs);
    const seen = new Set<string>();
    const headlines: Headline[] = [];
    for (const f of raw.feeds ?? []) {
      if (!f.xml || f.xml.length < 500) continue; // throttled/error bodies
      for (const item of parseRss(f.xml)) {
        const key = item.title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const h = tagHeadline(item.title, item.pubDate, f.source ?? "RSS", fridayClose);
        h.link = item.link;
        // drop ancient items
        if (h.pubDate && nowMs - new Date(h.pubDate).getTime() > FRESH_HOURS * 3600000) continue;
        headlines.push(h);
      }
    }
    headlines.sort((a, b) => (a.pubDate < b.pubDate ? 1 : -1));
    const ageH = raw.fetchedAt ? (nowMs - new Date(raw.fetchedAt).getTime()) / 3600000 : Infinity;
    return { headlines, fetchedAt: raw.fetchedAt ?? null, stale: ageH > 24, feeds: raw.feeds?.length ?? 0 };
  } catch {
    return { headlines: [], fetchedAt: null, stale: true, feeds: 0 };
  }
}
