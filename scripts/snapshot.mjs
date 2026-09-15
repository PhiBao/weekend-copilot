// Snapshot builder (plain Node, zero npm deps): dual-source market cache.
//   - rToken leg: Bitget public candles (keyless, no bot-wall) — real 24/7 prints.
//   - native leg: Yahoo daily 2y via curl subprocess (Node fetch is bot-walled).
// Usage: pnpm snapshot
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "data", "snapshots");
const UNIVERSE = ["NVDA", "AAPL", "TSLA", "MSFT", "META", "AMZN", "GOOGL", "AMD", "MU", "SPY", "QQQ", "BTC"];
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

function rtokenSymbol(native) {
  return native === "BTC" ? "BTCUSDT" : `R${native}USDT`;
}

/** Bitget spot candles -> daily bars (oldest..newest). Rows: [ts, o, h, l, c, volBase, volQuote, ...] */
async function bitgetDaily(symbol) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`https://api.bitget.com/api/v2/spot/market/candles?symbol=${encodeURIComponent(symbol)}&granularity=1day&limit=200`, { signal: ctrl.signal });
    const data = await res.json();
    if (data.code !== "00000" || !Array.isArray(data.data)) throw new Error(`bitget ${data.code} ${data.msg ?? ""}`);
    const bars = data.data
      .map((row) => ({ ts: Number(row[0]), date: new Date(Number(row[0])).toISOString().slice(0, 10), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]) }))
      .filter((b) => Number.isFinite(b.close) && b.close > 0)
      .sort((a, b) => a.ts - b.ts)
      .map(({ date, open, high, low, close }) => ({ date, open, high, low, close }));
    // de-dupe by date (keep last)
    const seen = new Map();
    for (const b of bars) seen.set(b.date, b);
    return [...seen.values()];
  } finally {
    clearTimeout(t);
  }
}

/** Yahoo daily via curl (curl's TLS fingerprint passes; Node fetch gets 429). */
function yahooDaily(native) {
  const yahooSym = native === "BTC" ? "BTC-USD" : native;
  const out = execFileSync(
    "curl",
    ["-s", "--max-time", "25", "-A", "Mozilla/5.0", `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=2y`],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
  );
  const data = JSON.parse(out);
  const r = data?.chart?.result?.[0];
  if (!r) throw new Error("yahoo empty result");
  const ts = r.timestamp ?? [];
  const q = r.indicators?.quote?.[0];
  const bars = [];
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
  if (bars.length < 30) throw new Error(`too few bars (${bars.length})`);
  return bars;
}

// Merge with the previous manifest: a symbol that fails to refresh on this run
// keeps its last good entry instead of vanishing (CI runners get throttled).
let manifest = {};
try {
  const { readFile: rf } = await import("node:fs/promises");
  const prev = JSON.parse(await rf(join(dir, "manifest.json"), "utf8"));
  manifest = prev.symbols ?? {};
  console.log(`merged previous manifest (${Object.keys(manifest).length} symbols)`);
} catch {
  console.log("no previous manifest — starting fresh");
}
await mkdir(dir, { recursive: true });

for (const sym of UNIVERSE) {
  // rToken leg (best-effort)
  let rBars = [];
  let rSource = "empty";
  try {
    rBars = await bitgetDaily(rtokenSymbol(sym));
    rSource = "bitget";
  } catch (e) {
    console.log(`bitget miss ${sym}: ${e.message}`);
  }
  // native leg (required)
  let nBars = [];
  let nSource = "empty";
  try {
    nBars = yahooDaily(sym);
    nSource = "yahoo-curl";
  } catch (e) {
    console.log(`yahoo miss ${sym}: ${e.message}`);
  }
  if (nBars.length >= 30) {
    const fetchedAt = new Date().toISOString();
    const payload = JSON.stringify({
      symbol: sym,
      rtoken: rtokenSymbol(sym),
      rSource,
      rBars,
      nSource,
      fetchedAt,
      bars: nBars,
    });
    await writeFile(join(dir, `${sym}.json`), payload);
    manifest[sym] = {
      source: nSource + (rBars.length ? "+bitget" : ""),
      bars: nBars.length,
      rBars: rBars.length,
      sha: sha(payload),
      fetchedAt,
      ...(rBars.length >= 5 ? { rFetchedAt: fetchedAt } : {}),
    };
    console.log(`ok ${sym}: native ${nBars.length} + rToken ${rBars.length}`);
  } else {
    console.log(`MISS ${sym}: no native data (keeps previous snapshot if any)`);
  }
  await sleep(2500);
}

await writeFile(join(dir, "manifest.json"), JSON.stringify({ builtAt: new Date().toISOString(), symbols: manifest }, null, 2));
const total = Object.keys(manifest).length;
const within = (t) => t && Date.now() - new Date(t).getTime() < 6 * 3600 * 1000;
const freshNative = UNIVERSE.filter((s) => manifest[s] && within(manifest[s].fetchedAt)).length;
const freshRtoken = UNIVERSE.filter((s) => manifest[s] && within(manifest[s].rFetchedAt)).length;
console.log(`manifest written: ${total} symbols total | native refreshed ${freshNative}/${UNIVERSE.length} | rToken refreshed ${freshRtoken}/${UNIVERSE.length}`);
if (freshNative + freshRtoken === 0) {
  console.error("nothing refreshed — every feed refused this run");
  process.exit(1);
}
if (freshNative === 0) {
  console.warn("native leg refused everywhere (likely datacenter throttling) — rToken leg still refreshed; keeping previous native bars");
}
