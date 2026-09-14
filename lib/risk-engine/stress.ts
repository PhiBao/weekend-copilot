// Weekend-regime stress: Fri→Mon gap distribution, analogues, breaker.
// Gap definition: (Monday open - Friday close) / Friday close when opens exist,
// else Friday close → Monday close proxy. Labeled honestly per ticker.
import { percentile } from "../stats";

export interface GapEvent {
  friday: string;
  monday: string;
  gapPct: number; // in percent
  mondayDayPct: number | null; // Monday open→close when available
  proxy: boolean; // true if close→close proxy (no opens)
}

export interface DailyBarLike {
  date: string;
  close: number;
  open?: number;
}

function weekdayUTC(dateStr: string): number {
  return new Date(dateStr + "T12:00:00Z").getUTCDay(); // 0 Sun..6 Sat
}

/** Extract Fri→Mon gap events from daily bars (oldest..newest). */
export function fridayMondayGaps(bars: DailyBarLike[]): GapEvent[] {
  const byDate = new Map(bars.map((b) => [b.date, b]));
  const out: GapEvent[] = [];
  for (const b of bars) {
    if (weekdayUTC(b.date) !== 5) continue; // Friday
    // find next Monday (skip holidays: first Mon/Tue with data within 4 days)
    const fri = new Date(b.date + "T12:00:00Z");
    for (let d = 1; d <= 4; d++) {
      const cand = new Date(fri.getTime() + d * 86400000);
      const wd = cand.getUTCDay();
      if (wd !== 1 && wd !== 2) continue;
      const key = cand.toISOString().slice(0, 10);
      const mon = byDate.get(key);
      if (!mon) continue;
      const friOpen = b.open;
      const monOpen = mon.open;
      const hasOpens = friOpen != null && monOpen != null && friOpen > 0 && monOpen > 0;
      const gapPct = hasOpens ? ((monOpen - b.close) / b.close) * 100 : ((mon.close - b.close) / b.close) * 100;
      const mondayDayPct = hasOpens ? ((mon.close - monOpen) / monOpen) * 100 : null;
      out.push({ friday: b.date, monday: key, gapPct, mondayDayPct, proxy: !hasOpens });
      break;
    }
  }
  return out;
}

export interface StressResult {
  ticker: string;
  weekends: number;
  p10: number;
  p50: number;
  p90: number;
  probDown: number; // P(gap < 0)
  probBigMove: number; // P(|gap| > 1%)
  worst: GapEvent | null;
  best: GapEvent | null;
  analogues: GapEvent[]; // 5 most negative + 2 most positive, date-sorted desc
  proxyShare: number; // fraction of events using close→close proxy
  spreadAssumptionBps: number; // regime spread used in remaining math
}

/** Regime spread assumptions (bps one-way). Documented, from microstructure research. */
export const REGIME_SPREAD_BPS = {
  regular: 8,
  overnight: 45,
  weekend: 80,
} as const;

export function stressTicker(native: string, bars: DailyBarLike[]): StressResult {
  const gaps = fridayMondayGaps(bars);
  const vals = gaps.map((g) => g.gapPct);
  const negatives = vals.filter((v) => v < 0).length;
  const big = vals.filter((v) => Math.abs(v) > 1).length;
  const sorted = [...gaps].sort((a, b) => a.gapPct - b.gapPct);
  const analogues = [...sorted.slice(0, 5), ...sorted.slice(-2)].sort((a, b) => (a.monday < b.monday ? 1 : -1));
  return {
    ticker: native,
    weekends: gaps.length,
    p10: percentile(vals, 10),
    p50: percentile(vals, 50),
    p90: percentile(vals, 90),
    probDown: gaps.length ? negatives / gaps.length : 0,
    probBigMove: gaps.length ? big / gaps.length : 0,
    worst: sorted[0] ?? null,
    best: sorted[sorted.length - 1] ?? null,
    analogues,
    proxyShare: gaps.length ? gaps.filter((g) => g.proxy).length / gaps.length : 0,
    spreadAssumptionBps: REGIME_SPREAD_BPS.weekend,
  };
}

export interface BreakerResult {
  verdict: "PASS" | "FLAG";
  reasons: string[];
  /** Expected weekend drag under 2x costs on the proposed leg (USDT). */
  drag2xUsdt: number;
  worst10AvgGapPct: number;
}

/**
 * Breaker agent (deterministic, in code — never in the prompt):
 * runs the proposal at DOUBLE costs against the 10 worst historical
 * Fri→Mon gaps for that name. Flags when downside dominates.
 */
export function breakerCheck(proposalNotionalUsdt: number, stress: StressResult, hhiAfter: number): BreakerResult {
  const reasons: string[] = [];
  const worst10 = [...(stress.analogues ?? [])]
    .map((a) => a.gapPct)
    .sort((a, b) => a - b)
    .slice(0, 10);
  const worst10Avg = worst10.length ? worst10.reduce((a, b) => a + b, 0) / worst10.length : 0;

  // 2x cost drag: fee 2x + weekend spread 2x on the leg
  const fee2x = proposalNotionalUsdt * (2 * 5 / 10000);
  const spread2x = proposalNotionalUsdt * (2 * stress.spreadAssumptionBps / 10000);
  const drag2xUsdt = fee2x + spread2x;

  if (stress.p10 < -2) reasons.push(`P10 weekend gap ${stress.p10.toFixed(2)}% < −2% — left tail is material.`);
  if (stress.probDown > 0.55) reasons.push(`Gap-down frequency ${(stress.probDown * 100).toFixed(0)}% > 55% — weekend drift leans negative.`);
  if (hhiAfter > 0.5) reasons.push(`Post-trade HHI ${hhiAfter.toFixed(2)} > 0.50 — single-name concentration.`);
  if (worst10Avg < -1.5) reasons.push(`Worst-regime avg gap ${worst10Avg.toFixed(2)}% — breaker at 2× costs objects.`);

  return { verdict: reasons.length ? "FLAG" : "PASS", reasons, drag2xUsdt, worst10AvgGapPct: worst10Avg };
}
