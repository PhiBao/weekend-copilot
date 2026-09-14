// Portfolio delta engine. Deterministic. LLM never touches these numbers.
import { betaToMarket, correlation, logReturns } from "../stats";
import { SECTORS, toNative } from "../market/symbols";

export interface HoldingInput {
  symbol: string;
  qty: number;
}
export interface ProposalInput {
  side: "BUY" | "SELL";
  symbol: string;
  qty: number;
}

export interface DeltaResult {
  notionalBefore: number;
  notionalAfter: number;
  weightsBefore: Record<string, number>;
  weightsAfter: Record<string, number>;
  betaBefore: number;
  betaAfter: number;
  betaDelta: number;
  hhiBefore: number;
  hhiAfter: number;
  sectorAfter: Record<string, number>;
  topSector: { sector: string; weight: number };
  maxCorrelation: { pair: [string, string]; value: number };
  feeBps: number;
  feeUsdt: number;
  unknownSymbols: string[];
  pricesUsed: Record<string, number>;
}

export const FEE_BPS_PER_SIDE = 5; // Bitget rToken promo 0.05%

/** Herfindahl-Hirschman Index over weights (1 = single-name). */
export function hhi(weights: number[]): number {
  return weights.reduce((a, w) => a + w * w, 0);
}

export function computeDelta(
  holdings: HoldingInput[],
  proposal: ProposalInput,
  closes: Record<string, number[]>, // native -> daily closes (oldest..newest)
  marketNative = "SPY"
): DeltaResult {
  const priceOf = (sym: string): number | null => {
    const nat = toNative(sym);
    const series = closes[nat];
    if (!series || series.length === 0) return null;
    const px = series[series.length - 1];
    return px > 0 ? px : null;
  };

  const unknownSymbols: string[] = [];
  const valueOf = (h: HoldingInput): number => {
    const px = priceOf(h.symbol);
    if (px == null) {
      if (!unknownSymbols.includes(h.symbol)) unknownSymbols.push(h.symbol);
      return 0;
    }
    return h.qty * px;
  };

  const before = holdings.filter((h) => h.qty !== 0);
  const notionalBefore = before.reduce((a, h) => a + valueOf(h), 0);

  // Apply proposal
  const afterMap = new Map<string, number>();
  for (const h of before) afterMap.set(h.symbol.toUpperCase(), (afterMap.get(h.symbol.toUpperCase()) ?? 0) + h.qty);
  const key = proposal.symbol.toUpperCase();
  const dir = proposal.side === "BUY" ? 1 : -1;
  afterMap.set(key, (afterMap.get(key) ?? 0) + dir * proposal.qty);
  const after: HoldingInput[] = [...afterMap.entries()].filter(([, q]) => q !== 0).map(([symbol, qty]) => ({ symbol, qty }));
  const notionalAfter = after.reduce((a, h) => a + valueOf(h), 0);

  const weights = (list: HoldingInput[], notional: number): Record<string, number> => {
    const w: Record<string, number> = {};
    if (notional <= 0) return w;
    for (const h of list) w[h.symbol.toUpperCase()] = valueOf(h) / notional;
    return w;
  };
  const weightsBefore = weights(before, notionalBefore);
  const weightsAfter = weights(after, notionalAfter);

  // Beta: weight-blended asset betas vs market (native-mapped, return space)
  const marketRets = logReturns(closes[marketNative] ?? []);
  const betaOfNative = (nat: string): number => {
    const r = logReturns(closes[nat] ?? []);
    if (r.length < 20 || marketRets.length < 20) return 1;
    return betaToMarket(r, marketRets);
  };
  const bookBeta = (list: HoldingInput[], notional: number): number => {
    if (notional <= 0) return 0;
    let b = 0;
    for (const h of list) {
      const nat = toNative(h.symbol);
      const w = valueOf(h) / notional;
      b += w * (closes[nat] && closes[nat].length >= 20 ? betaOfNative(nat) : 1);
    }
    return b;
  };
  const betaBefore = bookBeta(before, notionalBefore);
  const betaAfter = bookBeta(after, notionalAfter);

  const hhiBefore = hhi(Object.values(weightsBefore));
  const hhiAfter = hhi(Object.values(weightsAfter));

  // Sector concentration after
  const sectorAfter: Record<string, number> = {};
  if (notionalAfter > 0) {
    for (const h of after) {
      const sec = SECTORS[toNative(h.symbol)] ?? "Other";
      sectorAfter[sec] = (sectorAfter[sec] ?? 0) + valueOf(h) / notionalAfter;
    }
  }
  let topSector = { sector: "—", weight: 0 };
  for (const [sector, weight] of Object.entries(sectorAfter)) {
    if (weight > topSector.weight) topSector = { sector, weight };
  }

  // Max pairwise correlation among names in book-after (native return space)
  let maxCorrelation = { pair: ["—", "—"] as [string, string], value: 0 };
  const names = [...new Set(after.map((h) => toNative(h.symbol)))].filter((n) => (closes[n] ?? []).length >= 20);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const c = Math.abs(correlation(logReturns(closes[names[i]]), logReturns(closes[names[j]])));
      if (c > maxCorrelation.value) maxCorrelation = { pair: [names[i], names[j]], value: c };
    }
  }

  // Fee on proposed leg only (promo taker), USDT
  const px = priceOf(proposal.symbol) ?? 0;
  const feeUsdt = Math.abs(proposal.qty * px) * (FEE_BPS_PER_SIDE / 10000);

  const pricesUsed: Record<string, number> = {};
  for (const h of [...before, ...after]) {
    const p = priceOf(h.symbol);
    if (p != null) pricesUsed[h.symbol.toUpperCase()] = p;
  }

  return {
    notionalBefore,
    notionalAfter,
    weightsBefore,
    weightsAfter,
    betaBefore,
    betaAfter,
    betaDelta: betaAfter - betaBefore,
    hhiBefore,
    hhiAfter,
    sectorAfter,
    topSector,
    maxCorrelation,
    feeBps: FEE_BPS_PER_SIDE,
    feeUsdt,
    unknownSymbols,
    pricesUsed,
  };
}
