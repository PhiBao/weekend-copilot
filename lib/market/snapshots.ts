// Snapshot loader: reads pinned data/snapshots at runtime; best-effort live
// refresh with staleness flag. Snapshots are the source of truth for receipts.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DailyBar } from "./fetch";
import { fetchDaily } from "./fetch";

export interface SnapshotMeta {
  source: string;
  bars: number;
  sha: string;
  fetchedAt: string;
}

export interface SnapshotSet {
  closes: Record<string, number[]>;
  bars: Record<string, DailyBar[]>;
  /** rToken 24/7 prints (Bitget). May be sparse for new listings. */
  rCloses: Record<string, number[]>;
  rBars: Record<string, DailyBar[]>;
  rSymbols: Record<string, string>;
  meta: Record<string, SnapshotMeta>;
  builtAt: string | null;
  stale: boolean;
}

const SYMBOLS = ["NVDA", "AAPL", "TSLA", "MSFT", "META", "AMZN", "GOOGL", "AMD", "MU", "SPY", "QQQ", "BTC"];

function snapDir(): string {
  // works from both app runtime (cwd = app root) and scripts
  return join(process.cwd(), "data", "snapshots");
}

export async function loadSnapshots(): Promise<SnapshotSet> {
  const closes: Record<string, number[]> = {};
  const bars: Record<string, DailyBar[]> = {};
  const rCloses: Record<string, number[]> = {};
  const rBars: Record<string, DailyBar[]> = {};
  const rSymbols: Record<string, string> = {};
  const meta: Record<string, SnapshotMeta> = {};
  let builtAt: string | null = null;
  try {
    const manifest = JSON.parse(await readFile(join(snapDir(), "manifest.json"), "utf8")) as {
      builtAt?: string;
      symbols?: Record<string, SnapshotMeta>;
    };
    builtAt = manifest.builtAt ?? null;
    for (const sym of SYMBOLS) {
      try {
        const file = JSON.parse(await readFile(join(snapDir(), `${sym}.json`), "utf8")) as { bars?: DailyBar[]; source?: string; fetchedAt?: string; rBars?: DailyBar[]; rtoken?: string };
        if (file.bars && file.bars.length >= 30) {
          bars[sym] = file.bars;
          closes[sym] = file.bars.map((b) => b.close);
          if (file.rBars && file.rBars.length >= 5) {
            rBars[sym] = file.rBars;
            rCloses[sym] = file.rBars.map((b) => b.close);
            rSymbols[sym] = file.rtoken ?? "";
          }
          meta[sym] = { source: file.source ?? "snapshot", bars: file.bars.length, sha: manifest.symbols?.[sym]?.sha ?? "live-fallback", fetchedAt: file.fetchedAt ?? "" };
        }
      } catch {
        /* missing symbol — fallback below */
      }
    }
  } catch {
    /* no snapshots yet — fallback below */
  }

  // live fallback for any missing symbol (best-effort, flagged stale=false but source=live)
  let stale = builtAt == null;
  for (const sym of SYMBOLS) {
    if (closes[sym]) continue;
    try {
      const r = await fetchDaily(sym);
      if (r.bars.length >= 30) {
        bars[sym] = r.bars;
        closes[sym] = r.bars.map((b) => b.close);
        meta[sym] = { source: `${r.source}-live`, bars: r.bars.length, sha: "live-fallback", fetchedAt: r.fetchedAt };
      }
    } catch {
      /* leave missing */
    }
  }
  if (builtAt) {
    const ageH = (Date.now() - new Date(builtAt).getTime()) / 3600000;
    stale = ageH > 72;
  }
  return { closes, bars, rCloses, rBars, rSymbols, meta, builtAt, stale };
}
