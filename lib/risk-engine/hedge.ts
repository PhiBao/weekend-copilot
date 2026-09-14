// Hedge/FCN comparator (deterministic, illustrative — not a live quote).
// Compares three ways to express the same view, priced with the same
// weekend-stress distribution so the judge compares apples to apples.
import type { DeltaResult } from "./delta";
import type { StressResult } from "./stress";
import { REGIME_SPREAD_BPS } from "./stress";

export interface HedgeOption {
  id: "full" | "half" | "fcn_proxy";
  name: string;
  description: string;
  weekendP50Usdt: number; // expected weekend move at P50 gap on exposed notional
  weekendP10Usdt: number; // left-tail at P10
  costUsdt: number; // fees + spread to put on
  couponUsdt: number; // illustrative FCN coupon only
  netP10Usdt: number; // P10 + coupon - cost
  assumptions: string[];
}

/** Illustrative FCN coupon: 20% annualized over a 3-day weekend hold. */
const FCN_COUPON_ANNUAL = 0.2;
const WEEKEND_YEARS = 3 / 365;

export function compareHedges(
  proposalNotionalUsdt: number,
  _delta: DeltaResult,
  stress: StressResult
): HedgeOption[] {
  const spreadBps = REGIME_SPREAD_BPS.weekend;
  const feeBps = 5;
  const costRate = (feeBps + spreadBps) / 10000;
  const p50 = stress.p50 / 100;
  const p10 = stress.p10 / 100;

  const full: HedgeOption = {
    id: "full",
    name: "Full size now",
    description: "Take the whole proposal into the weekend.",
    weekendP50Usdt: proposalNotionalUsdt * p50,
    weekendP10Usdt: proposalNotionalUsdt * p10,
    costUsdt: proposalNotionalUsdt * costRate,
    couponUsdt: 0,
    netP10Usdt: proposalNotionalUsdt * p10 - proposalNotionalUsdt * costRate,
    assumptions: [`weekend spread ${spreadBps}bp one-way`, `fee ${feeBps}bp`, `gap distribution from ${stress.weekends} Fri→Mon events`],
  };
  const half: HedgeOption = {
    id: "half",
    name: "Half now, half Monday",
    description: "Halve weekend exposure; Monday half pays regular spread.",
    weekendP50Usdt: (proposalNotionalUsdt / 2) * p50,
    weekendP10Usdt: (proposalNotionalUsdt / 2) * p10,
    costUsdt: (proposalNotionalUsdt / 2) * costRate + (proposalNotionalUsdt / 2) * ((feeBps + 8) / 10000),
    couponUsdt: 0,
    netP10Usdt: (proposalNotionalUsdt / 2) * p10 - ((proposalNotionalUsdt / 2) * costRate + (proposalNotionalUsdt / 2) * ((feeBps + 8) / 10000)),
    assumptions: ["Monday half pays regular 8bp spread", "no Monday gap surprise on second half (optimistic — flagged)"],
  };
  const coupon = proposalNotionalUsdt * FCN_COUPON_ANNUAL * WEEKEND_YEARS;
  const fcn: HedgeOption = {
    id: "fcn_proxy",
    name: "Earn-while-you-wait (FCN-style)",
    description: "Illustrative fixed-coupon proxy: accept a below-market strike, earn coupon over the weekend.",
    weekendP50Usdt: 0,
    weekendP10Usdt: -(proposalNotionalUsdt * 0.05), // assigned at -5% strike discount proxy
    costUsdt: 0,
    couponUsdt: coupon,
    netP10Usdt: -(proposalNotionalUsdt * 0.05) + coupon,
    assumptions: [
      `illustrative coupon ${(FCN_COUPON_ANNUAL * 100).toFixed(0)}% annualized × 3d — NOT a live Bitget quote`,
      "assignment proxy at −5% strike discount",
      "non-principal-protected: you can end up holding the dip",
    ],
  };
  return [full, half, fcn];
}
