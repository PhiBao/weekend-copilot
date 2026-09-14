// Canonical symbols, rToken mapping, sectors. No I/O.
export const NATIVE_SYMBOLS = ["NVDA", "AAPL", "TSLA", "MSFT", "META", "AMZN", "GOOGL", "AMD", "MU", "SPY", "QQQ", "BTC"] as const;
export type NativeSymbol = (typeof NATIVE_SYMBOLS)[number];

/** rToken -> native mapping (rNVDA -> NVDA). ETFs map to themselves. */
export function toNative(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  if (s.startsWith("R") && s.length > 1) {
    const inner = s.slice(1);
    if ((NATIVE_SYMBOLS as readonly string[]).includes(inner)) return inner;
  }
  return s;
}

export function toRToken(native: string): string {
  const s = native.trim().toUpperCase();
  return s.startsWith("R") ? s : `R${s}`;
}

export function isKnownSymbol(symbol: string): boolean {
  const n = toNative(symbol);
  return (NATIVE_SYMBOLS as readonly string[]).includes(n);
}

/** GICS-ish sector buckets for concentration math. */
export const SECTORS: Record<string, string> = {
  NVDA: "Semis",
  AMD: "Semis",
  MU: "Semis",
  AAPL: "Devices",
  MSFT: "Software",
  META: "Internet",
  GOOGL: "Internet",
  AMZN: "Internet",
  TSLA: "Auto",
  SPY: "Broad",
  QQQ: "Broad",
  BTC: "Crypto",
};

/** Yahoo ticker for native symbol (BTC uses BTC-USD). */
export function yahooTicker(native: string): string {
  if (native === "BTC") return "BTC-USD";
  return native;
}

/** Demo books — presets that always resolve (reliability first). */
export interface DemoHolding {
  symbol: string;
  qty: number;
}
export interface DemoBook {
  id: string;
  name: string;
  blurb: string;
  holdings: DemoHolding[];
  cash: number;
}

export const DEMO_BOOKS: DemoBook[] = [
  {
    id: "concentrated-nvda",
    name: "Concentrated NVDA holder",
    blurb: "63% NVDA, weekend ahead. The classic concentration trap.",
    holdings: [
      { symbol: "rNVDA", qty: 40 },
      { symbol: "rAAPL", qty: 10 },
      { symbol: "rTSLA", qty: 5 },
    ],
    cash: 5000,
  },
  {
    id: "balanced-qqq",
    name: "Balanced QQQ tracker",
    blurb: "39/33/28 across QQQ, MSFT, AMZN asking the same question.",
    holdings: [
      { symbol: "rQQQ", qty: 10 },
      { symbol: "rMSFT", qty: 12 },
      { symbol: "rAMZN", qty: 20 },
    ],
    cash: 20000,
  },
  {
    id: "weekend-degen",
    name: "TSLA + BTC barbell",
    blurb: "48/52 high-beta barbell into weekend volatility.",
    holdings: [
      { symbol: "rTSLA", qty: 20 },
      { symbol: "BTC", qty: 0.1 },
    ],
    cash: 3000,
  },
];
