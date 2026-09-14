// Headline snapshot (plain Node, zero npm deps): Yahoo per-ticker RSS + CNBC.
// Usage: pnpm news
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "data");
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
// NOTE: Yahoo per-ticker RSS is 429-walled from datacenter IPs (both Node and
// curl). These CNBC/MarketWatch feeds work keyless; ticker relevance is
// recovered at runtime by keyword tagging (lib/market/news.ts).

async function viaFetch(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function viaCurl(url) {
  return execFileSync("curl", ["-s", "--max-time", "20", "-A", UA, url], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
}

async function getXml(url) {
  try {
    return await viaFetch(url);
  } catch (e) {
    console.log(`fetch miss, curl fallback: ${url.slice(0, 80)} (${e.message})`);
    return viaCurl(url);
  }
}

const FEEDS = [
  { query: "TOP", source: "CNBC", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html" },
  { query: "TECH", source: "CNBC", url: "https://www.cnbc.com/id/10000664/device/rss/rss.html" },
  { query: "MARKETS", source: "CNBC", url: "https://www.cnbc.com/id/10000113/device/rss/rss.html" },
  { query: "TOP", source: "MarketWatch", url: "https://feeds.marketwatch.com/marketwatch/topstories/" },
];

const out = [];
for (const f of FEEDS) {
  try {
    const xml = await getXml(f.url);
    out.push({ query: f.query, source: f.source, xml });
    console.log(`ok ${f.source}/${f.query}: ${xml.length} chars`);
  } catch (e) {
    console.log(`MISS ${f.source}/${f.query}: ${e.message}`);
  }
  await sleep(2500);
}

await mkdir(dir, { recursive: true });
await writeFile(join(dir, "news_raw.json"), JSON.stringify({ fetchedAt: new Date().toISOString(), feeds: out }));
console.log("news_raw written");
