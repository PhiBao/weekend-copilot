// True-24/7 weekend drift from real rToken prints (Bitget).
// Native markets close Fri 16:00 ET; rTokens keep printing. We measure what
// actually happened over the weekend IN THE TOKEN, not via Monday proxy.
// Segments: Friday close -> Sunday close (or last weekend print available).
import { percentile } from "../stats";

export interface WeekendPrint {
  friday: string;
  sunday: string;
  driftPct: number; // Fri close -> Sun close in the rToken
  weekendRangePct: number; // (weekend high - low) / Fri close
}

export interface DriftResult {
  ticker: string;
  rSymbol: string;
  weekendsMeasured: number;
  p10: number;
  p50: number;
  p90: number;
  probDown: number;
  maxAbs: number;
  prints: WeekendPrint[]; // newest first, capped at 12
  confidence: "high" | "medium" | "low";
}

function weekdayUTC(dateStr: string): number {
  return new Date(dateStr + "T12:00:00Z").getUTCDay();
}

/** rToken daily bars (oldest..newest, must include weekend prints). */
export function weekendDrifts(ticker: string, rSymbol: string, bars: { date: string; close: number; high?: number; low?: number }[]): DriftResult {
  const byDate = new Map(bars.map((b) => [b.date, b]));
  const prints: WeekendPrint[] = [];
  for (const b of bars) {
    if (weekdayUTC(b.date) !== 5 || b.close <= 0) continue; // Friday anchor
    const fri = new Date(b.date + "T12:00:00Z");
    // find Sunday (or Saturday if Sunday missing) print within 3 days
    for (const d of [2, 1, 3]) {
      const cand = new Date(fri.getTime() + d * 86400000).toISOString().slice(0, 10);
      const wd = new Date(cand + "T12:00:00Z").getUTCDay();
      if (wd !== 0 && wd !== 6 && wd !== 1) continue;
      const w = byDate.get(cand);
      if (!w || w.close <= 0) continue;
      // weekend range: min low / max high across Fri->cand window
      let hi = b.close;
      let lo = b.close;
      for (let k = 0; k <= d; k++) {
        const day = byDate.get(new Date(fri.getTime() + k * 86400000).toISOString().slice(0, 10));
        if (!day) continue;
        if (day.high != null) hi = Math.max(hi, day.high);
        if (day.low != null) lo = Math.min(lo, day.low);
      }
      prints.push({
        friday: b.date,
        sunday: cand,
        driftPct: ((w.close - b.close) / b.close) * 100,
        weekendRangePct: ((hi - lo) / b.close) * 100,
      });
      break;
    }
  }
  const vals = prints.map((p) => p.driftPct);
  const n = prints.length;
  return {
    ticker,
    rSymbol,
    weekendsMeasured: n,
    p10: percentile(vals, 10),
    p50: percentile(vals, 50),
    p90: percentile(vals, 90),
    probDown: n ? vals.filter((v) => v < 0).length / n : 0,
    maxAbs: n ? Math.max(...vals.map(Math.abs)) : 0,
    prints: [...prints].reverse().slice(0, 12),
    confidence: n >= 8 ? "high" : n >= 4 ? "medium" : "low",
  };
}
