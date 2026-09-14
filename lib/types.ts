// Shared client-side types mirroring the /api/delta response. Type-only usage.
export interface DeltaView {
  notionalBefore: number;
  notionalAfter: number;
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

export interface GapView {
  friday: string;
  monday: string;
  gapPct: number;
  mondayDayPct: number | null;
  proxy: boolean;
}

export interface StressView {
  ticker: string;
  weekends: number;
  p10: number;
  p50: number;
  p90: number;
  probDown: number;
  probBigMove: number;
  worst: GapView | null;
  best: GapView | null;
  analogues: GapView[];
  proxyShare: number;
  spreadAssumptionBps: number;
}

export interface DriftPrint {
  friday: string;
  sunday: string;
  driftPct: number;
  weekendRangePct: number;
}

export interface DriftView {
  ticker: string;
  rSymbol: string;
  weekendsMeasured: number;
  p10: number;
  p50: number;
  p90: number;
  probDown: number;
  maxAbs: number;
  prints: DriftPrint[];
  confidence: "high" | "medium" | "low";
}

export interface BreakerView {
  verdict: "PASS" | "FLAG";
  reasons: string[];
  drag2xUsdt: number;
  worst10AvgGapPct: number;
}

export interface HedgeView {
  id: string;
  name: string;
  description: string;
  weekendP50Usdt: number;
  weekendP10Usdt: number;
  costUsdt: number;
  couponUsdt: number;
  netP10Usdt: number;
  assumptions: string[];
}

export interface CriticView {
  rule: string;
  hypothesis: string;
  regime: string;
  triggeredBy: string[];
}

export interface HypothesisView {
  id: string;
  title: string;
  status: string;
  regime: string;
  evidence: string;
  date: string;
  source: string;
}

export interface HeadlineView {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  tickers: string[];
  channels: string[];
  weekendWindow: boolean;
}

export interface DeskResult {
  delta: DeltaView;
  stress: StressView;
  drift: DriftView;
  breaker: BreakerView;
  audit: {
    subject: string;
    observations: number;
    sharpeAnnualized: number;
    psr: number;
    nTrials: number | null;
    expectedMaxSharpeAnnualized: number | null;
    dsr: number | null;
    minTrackRecordMonths: number | null;
    flags: string[];
    verdict: string;
    note?: string;
  };
  hedges: HedgeView[];
  headlines: HeadlineView[];
  newsAsOf: string | null;
  newsStale: boolean;
  rule: CriticView;
  recommendation: "TRIM_OR_WAIT" | "PROCEED_WITH_LIMITS";
  hypotheses: HypothesisView[];
  narrative: string;
  dataAsOf: string | null;
  stale: boolean;
}

export interface ReceiptView {
  id: string;
  ts: string;
  prevHash: string;
  hash: string;
  methodVersion: string;
  kind: string;
  inputs: unknown;
  outputs: unknown;
  dataSha: string;
  confidence: string;
  notes: string[];
}

export interface DeltaResponse {
  ok: boolean;
  receiptId?: string;
  hash?: string;
  receipt?: ReceiptView;
  result?: DeskResult;
  error?: string;
}

export interface BookLine {
  symbol: string;
  qty: number;
}

export const PRESETS: { id: string; name: string; blurb: string; book: BookLine[] }[] = [
  {
    id: "concentrated-nvda",
    name: "Concentrated NVDA holder",
    blurb: "60% NVDA into the weekend — the concentration trap.",
    book: [
      { symbol: "rNVDA", qty: 40 },
      { symbol: "rAAPL", qty: 10 },
      { symbol: "rTSLA", qty: 5 },
    ],
  },
  {
    id: "balanced-qqq",
    name: "Balanced QQQ tracker",
    blurb: "39/33/28 across QQQ, MSFT, AMZN asking the same question.",
    book: [
      { symbol: "rQQQ", qty: 10 },
      { symbol: "rMSFT", qty: 12 },
      { symbol: "rAMZN", qty: 20 },
    ],
  },
  {
    id: "weekend-degen",
    name: "TSLA + BTC barbell",
    blurb: "48/52 high-beta barbell into weekend volatility.",
    book: [
      { symbol: "rTSLA", qty: 20 },
      { symbol: "BTC", qty: 0.1 },
    ],
  },
];
