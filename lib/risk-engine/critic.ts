// Critic agent (deterministic): reads a graded decision and proposes exactly
// ONE reusable checklist rule. Hermes/cornelius one-variable pattern:
// one change, one hypothesis, regime-tagged, written to the graveyard.
// LLM may rephrase; it may never invent the rule.
import type { DeltaResult } from "./delta";
import type { BreakerResult, StressResult } from "./stress";

export interface CriticRule {
  rule: string;
  hypothesis: string;
  regime: string;
  triggeredBy: string[];
}

export function criticize(delta: DeltaResult, stress: StressResult, breaker: BreakerResult, side: string): CriticRule {
  const triggered: string[] = [];
  if (delta.hhiAfter > 0.5) triggered.push("concentration");
  if (delta.betaDelta > 0.1 && side === "BUY") triggered.push("beta-add");
  if (stress.p10 < -2) triggered.push("left-tail");
  if (stress.probDown > 0.55) triggered.push("drift-down");
  if (breaker.verdict === "FLAG") triggered.push("breaker-flag");
  if (delta.maxCorrelation.value > 0.85) triggered.push("correlation");

  if (triggered.includes("concentration")) {
    return {
      rule: `Never add to a name already above 50% weight without writing the trim alternative first (post-trade HHI ${delta.hhiAfter.toFixed(2)}).`,
      hypothesis: "Marginal concentration adds left-tail faster than expected return in weekend regimes.",
      regime: "all",
      triggeredBy: triggered,
    };
  }
  if (triggered.includes("breaker-flag") || triggered.includes("left-tail")) {
    return {
      rule: `Require 2×-cost breaker PASS before sizing any ${stress.ticker} weekend add (current P10 ${stress.p10.toFixed(2)}%, drag $${breaker.drag2xUsdt.toFixed(2)} at 2×).`,
      hypothesis: "Weekend left-tail survives fees only when explicitly priced at double costs.",
      regime: "weekend",
      triggeredBy: triggered,
    };
  }
  if (triggered.includes("beta-add")) {
    return {
      rule: `Cap single-trade beta adds at +0.10 when book beta already exceeds 1.2 (this trade: ${delta.betaDelta >= 0 ? "+" : ""}${delta.betaDelta.toFixed(2)} → ${delta.betaAfter.toFixed(2)}).`,
      hypothesis: "Stacked beta is the quiet way concentrated books blow up on Monday re-anchors.",
      regime: "all",
      triggeredBy: triggered,
    };
  }
  if (triggered.includes("correlation")) {
    const [a, b] = delta.maxCorrelation.pair;
    return {
      rule: `Treat ${a}×${b} correlation (${delta.maxCorrelation.value.toFixed(2)}) as one exposure when sizing — diversification assumed is diversification denied.`,
      hypothesis: "High pairwise correlation voids naive position-count diversification.",
      regime: "all",
      triggeredBy: triggered,
    };
  }
  return {
    rule: `Log this ${stress.ticker} decision with its preregistered gap expectation (P50 ${stress.p50.toFixed(2)}%) and compare Monday — no moved goalposts.`,
    hypothesis: "Preregistered expectations are the cheapest overfit defense available.",
    regime: "weekend",
    triggeredBy: triggered.length ? triggered : ["none — clean pass"],
  };
}
