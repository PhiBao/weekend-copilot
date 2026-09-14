// Hypothesis Graveyard: persistent memory of rejected ideas, regime-tagged.
// "Negative results are the most undervalued asset in quant research."
// Pattern credit: az9713/self-improving-trading-agent (Hypothesis Graveyard),
// nullh0/trading-strategy-postmortem (shelving discipline).
export interface Hypothesis {
  id: string;
  title: string;
  status: "REJECTED" | "CONFIRMED_BULL_ONLY" | "UNTESTED" | "CONFIRMED";
  regime: string;
  evidence: string;
  date: string;
  source: "seed" | "critic" | "verify";
}

const SEED: Hypothesis[] = [
  {
    id: "h_arb_overnight",
    title: "Overnight rToken vs native spread arbitrage, net of costs",
    status: "REJECTED",
    regime: "overnight/regular",
    evidence: "Weekday spreads ~8bp vs 2×5bp fees + taker routing; redeem gated (KYC/min/1–3d). HFT-only. Do not pitch as retail alpha.",
    date: "2026-09-14",
    source: "seed",
  },
  {
    id: "h_weekend_drift_signal",
    title: "Weekend 24/7 prints as Monday-gap sentiment proxy (not fills)",
    status: "CONFIRMED_BULL_ONLY",
    regime: "weekend",
    evidence: "Indicative prints + ±20% bands + auto-cancel + frozen oracles: usable as gap-direction context with spread filter; not a fill basis.",
    date: "2026-09-14",
    source: "seed",
  },
  {
    id: "h_single_name_add_concentrated",
    title: "Adding to an already->50% name improves risk-adjusted book",
    status: "REJECTED",
    regime: "all",
    evidence: "HHI/beta math: marginal beta and left-tail dominate. Prefer trim or FCN-at-discount alternative.",
    date: "2026-09-14",
    source: "seed",
  },
];

const extra: Hypothesis[] = [];

export function listHypotheses(): Hypothesis[] {
  return [...SEED, ...extra];
}

export function recordHypothesis(h: Omit<Hypothesis, "date" | "source"> & { source?: Hypothesis["source"] }): Hypothesis {
  const full: Hypothesis = { ...h, date: new Date().toISOString().slice(0, 10), source: h.source ?? "critic" };
  const i = extra.findIndex((x) => x.id === full.id);
  if (i >= 0) extra[i] = full;
  else extra.push(full);
  return full;
}

export function relevantHypotheses(ticker: string, regime = "weekend"): Hypothesis[] {
  const t = ticker.toUpperCase();
  return listHypotheses().filter(
    (h) => h.regime === "all" || h.regime.includes(regime) || h.title.toUpperCase().includes(t) || h.title.toLowerCase().includes("concentration")
  );
}
