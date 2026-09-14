// Deterministic plain-English proposal parser. No LLM, no guessing:
// every output is derived verbatim from the text + book. Unparseable input
// returns a hint, never a hallucinated trade.
import { isKnownSymbol, toNative, toRToken } from "./market/symbols";
import type { BookLine } from "./types";

export interface ParsedProposal {
  side: "BUY" | "SELL";
  symbol: string;
  qty: number;
  probe?: boolean;
  note?: string;
}

export interface ParseResult {
  ok: boolean;
  proposal?: ParsedProposal;
  hint?: string;
}

const COMPANY_NAMES: Record<string, string> = {
  nvidia: "NVDA",
  apple: "AAPL",
  tesla: "TSLA",
  microsoft: "MSFT",
  meta: "META",
  facebook: "META",
  amazon: "AMZN",
  alphabet: "GOOGL",
  google: "GOOGL",
  amd: "AMD",
  micron: "MU",
  qqq: "QQQ",
  spy: "SPY",
  bitcoin: "BTC",
  btc: "BTC",
};

const EXAMPLES = 'Try "add 10 rNVDA", "trim half my TSLA", "sell all rMETA", or "should I hold over the weekend?"';

function findSymbol(text: string): string | null {
  // rTOKEN / TOKEN / company name, in that priority
  const rtok = text.match(/\br([a-z]{1,5})\b/);
  if (rtok) {
    const cand = toRToken(rtok[1]);
    if (isKnownSymbol(cand)) return cand;
  }
  const words = text.replace(/[^a-z0-9\s]/g, " ").split(/\s+/);
  for (const w of words) {
    const up = w.toUpperCase();
    if (isKnownSymbol(up)) return toRToken(toNative(up));
    if (COMPANY_NAMES[w]) return toRToken(COMPANY_NAMES[w]);
  }
  return null;
}

function findQty(text: string): number | "half" | "all" | null {
  if (/\b(half|50%)\b/.test(text)) return "half";
  if (/\b(all|everything|entire|whole)\b/.test(text)) return "all";
  const m = text.match(/(\d+(?:\.\d+)?)\s*(shares?|contracts?|coins?|rtokens?|tokens?)?\b/);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0 && n <= 1e6) return n;
  }
  return null;
}

export function parseProposal(text: string, book: BookLine[]): ParseResult {
  const t = ` ${text.toLowerCase().trim()} `;
  if (!t.trim()) return { ok: false, hint: EXAMPLES };

  const isHold = /\b(hold|holding|keep|weekend\?|over the weekend)\b/.test(t) && !/\b(buy|sell|add|trim|reduce|take|close)\b/.test(t);
  const isSell = /\b(sell|trim|reduce|short|dump|exit|close|take profit)\b/.test(t);
  const isBuy = /\b(buy|add|long|accumulate|pick up|load)\b/.test(t);

  if (!isHold && !isSell && !isBuy) return { ok: false, hint: `No action found (buy/sell/hold). ${EXAMPLES}` };

  if (isHold) {
    // HOLD → hold-check probe: price trimming 25% of the largest line.
    if (book.length === 0) return { ok: false, hint: `Your book is empty — add a holding first. ${EXAMPLES}` };
    const top = [...book].sort((a, b) => b.qty - a.qty)[0];
    const qty = Math.max(1, Math.round(top.qty * 0.25));
    return {
      ok: true,
      proposal: {
        side: "SELL",
        symbol: top.symbol.toUpperCase(),
        qty,
        probe: true,
        note: `Hold-check probe: grades trimming 25% of your largest line (${top.symbol.toUpperCase()}). Edit freely — nothing is ordered, ever.`,
      },
    };
  }

  const side = isSell ? "SELL" : "BUY";
  const symbol = findSymbol(t);
  if (!symbol) return { ok: false, hint: `No known symbol found (rNVDA, rTSLA, BTC…). ${EXAMPLES}` };

  const q = findQty(t);
  if (typeof q === "number") return { ok: true, proposal: { side, symbol, qty: q } };
  const line = book.find((b) => b.symbol.toUpperCase() === symbol);
  if (q === "all") {
    if (!line) return { ok: false, hint: `You hold no ${symbol} to sell it all of. ${EXAMPLES}` };
    return { ok: true, proposal: { side: "SELL", symbol, qty: line.qty } };
  }
  if (q === "half") {
    if (!line) return { ok: false, hint: `You hold no ${symbol} — "half" needs a book line. Name a quantity instead. ${EXAMPLES}` };
    return { ok: true, proposal: { side, symbol, qty: Math.max(1, Math.round(line.qty / 2)) } };
  }
  return { ok: false, hint: `How many ${symbol}? ${EXAMPLES}` };
}
