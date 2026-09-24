// Confidence-aware NL dispatch (TypeSafe Jev + deterministic fallback).
//
// The regex parser (nl.ts) is the fast path: exact inputs never touch the
// network and cost nothing. Jev handles everything the regex can't, returning
// TYPED judgments (never prose): action + symbol + confidence. Code validates
// every value against the allowlist, extracts quantities deterministically,
// and computes everything. Numbers never come from a model — same discipline
// as the Qwen number-lock.
//
// Confidence gating (thresholds tuned on the 16-case spike, 2026-09-24):
//   conf >= 0.85  → auto-grade (no chip)
//   0.60 <= conf  → auto-grade + "interpreted as …" chip
//   conf < 0.60   → ask one targeted clarifying question instead of grading
import { request as httpsRequest } from "node:https";
import { EXAMPLES, findQty, findSymbol, parseProposal, resolveQty, type ParsedProposal } from "./nl";
import type { BookLine } from "./types";

export type DispatchAction = "grade_buy" | "grade_sell" | "hold_check" | "unclear";

export interface DispatchOutcomeProposal {
  kind: "proposal";
  proposal: ParsedProposal;
  confidence: number;
  source: "regex" | "jev";
  interpretation?: string;
}
export interface DispatchOutcomeClarify {
  kind: "clarify";
  question: string;
  confidence: number;
}
export interface DispatchOutcomeHint {
  kind: "hint";
  hint: string;
}
export type DispatchOutcome = DispatchOutcomeProposal | DispatchOutcomeClarify | DispatchOutcomeHint;

/** Show the "interpreted as …" chip for Jev-sourced proposals below this confidence. */
export const AUTO_GRADE_CHIP_BELOW = 0.85;

const SPEC = {
  action: {
    type: "choice",
    instructions: "What does the user want the trading desk to do with a position?",
    criteria: {
      grade_buy: "grade adding to a position or buying more of an asset",
      grade_sell: "grade reducing, trimming, selling or exiting a position",
      hold_check: "asking whether to keep holding through the weekend, a close, or an event",
      unclear: "no trade grading request can be determined, or the request is off-topic",
    },
  },
  symbol: {
    type: "choice",
    instructions: "Which asset is the proposal about? Match company names, tickers and slang to the right asset.",
    criteria: {
      NVDA: "Nvidia, NVDA, rNVDA, chips, Jensen, AI chips",
      AAPL: "Apple, AAPL, rAAPL, iPhone",
      TSLA: "Tesla, TSLA, rTSLA, Musk, Elon",
      MSFT: "Microsoft, MSFT, rMSFT",
      META: "Meta, META, Facebook, Instagram, Zuckerberg",
      AMZN: "Amazon, AMZN, rAMZN, AWS",
      GOOGL: "Alphabet, Google, GOOGL, Gemini",
      AMD: "AMD, Lisa Su",
      MU: "Micron, MU, memory, HBM",
      SPY: "S&P 500, SPY, the market, index",
      QQQ: "Nasdaq 100, QQQ, tech index",
      BTC: "Bitcoin, BTC, crypto",
      none: "no specific asset is named",
    },
  },
};

export interface JevDispatchAnswers {
  action: DispatchAction;
  actionConf: number;
  symbol: string;
  symbolConf: number;
}

function httpsPostJson(url: string, headers: Record<string, string>, body: string, timeoutMs: number): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = httpsRequest(
      { hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: "POST", headers: { ...headers, "Content-Length": Buffer.byteLength(body) } },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: data }));
      }
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

const VALID_ACTIONS: DispatchAction[] = ["grade_buy", "grade_sell", "hold_check", "unclear"];

/** Raw Jev call. Returns null on any failure (key missing, timeout, bad shape). */
export async function callJevDispatch(text: string, book: BookLine[]): Promise<JevDispatchAnswers | null> {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) return null;
  const model = process.env.TYPESAFE_MODEL ?? "jev-latest";
  const holdings = book.length ? book.map((b) => `${b.symbol.toUpperCase()} ${b.qty}`).join(", ") : "empty";
  try {
    const res = await httpsPostJson(
      "https://api.typesafe.ai/v1/systemone",
      { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      JSON.stringify({ state: `Command: "${text}". Book holds: ${holdings}.`, model, questions: SPEC }),
      6000
    );
    if (res.status < 200 || res.status >= 300) return null;
    const j = JSON.parse(res.text) as {
      answers?: {
        action?: { choice?: string; confidence?: number };
        symbol?: { choice?: string; confidence?: number };
      };
    };
    const action = j.answers?.action?.choice ?? "unclear";
    const symbol = j.answers?.symbol?.choice ?? "none";
    if (!VALID_ACTIONS.includes(action as DispatchAction)) return null;
    if (typeof symbol !== "string" || symbol.length > 8) return null;
    return {
      action: action as DispatchAction,
      actionConf: Number(j.answers?.action?.confidence ?? 0),
      symbol,
      symbolConf: Number(j.answers?.symbol?.confidence ?? 0),
    };
  } catch {
    return null;
  }
}

function toRTokenSymbol(native: string): string {
  return native === "BTC" ? "BTC" : `R${native}`;
}

/**
 * Pure composition: Jev judgments + deterministic book rules → outcome.
 * No network here, so this is fully unit-testable with recorded fixtures.
 */
export function composeDispatch(text: string, book: BookLine[], jev: JevDispatchAnswers | null): DispatchOutcome {
  if (!jev) {
    // Fallback path: exactly today's behavior.
    const r = parseProposal(text, book);
    if (r.ok && r.proposal) return { kind: "proposal", proposal: r.proposal, confidence: 1, source: "regex" };
    return { kind: "hint", hint: r.hint ?? EXAMPLES };
  }

  const conf = Math.min(jev.actionConf, jev.symbol === "none" ? 1 : jev.symbolConf);
  const rounded = Math.round(conf * 100) / 100;

  if (jev.action === "unclear" && jev.symbol === "none") {
    return { kind: "hint", hint: EXAMPLES };
  }
  if (jev.action === "unclear") {
    return {
      kind: "clarify",
      question: `I see ${toRTokenSymbol(jev.symbol)} — should I add to it, trim it, or check holding it into the weekend?`,
      confidence: rounded,
    };
  }
  if (jev.action === "hold_check") {
    // Probe 25% of the named line when held, else the largest line (existing semantics).
    const target =
      jev.symbol !== "none"
        ? (book.find((b) => b.symbol.toUpperCase() === toRTokenSymbol(jev.symbol)) ?? [...book].sort((a, b) => b.qty - a.qty)[0])
        : [...book].sort((a, b) => b.qty - a.qty)[0];
    if (!target || book.length === 0) return { kind: "hint", hint: `Your book is empty — add a holding first. ${EXAMPLES}` };
    const qty = Math.max(1, Math.round(target.qty * 0.25));
    return {
      kind: "proposal",
      proposal: {
        side: "SELL",
        symbol: target.symbol.toUpperCase(),
        qty,
        probe: true,
        note: `Hold-check probe: grades trimming 25% of ${target.symbol.toUpperCase()}. Edit freely — nothing is ordered, ever.`,
      },
      confidence: rounded,
      source: "jev",
      interpretation: `Interpreted as a weekend hold-check on ${target.symbol.toUpperCase()} (${rounded.toFixed(2)})`,
    };
  }

  // grade_buy / grade_sell
  const side = jev.action === "grade_sell" ? "SELL" : "BUY";
  if (jev.symbol === "none") {
    return { kind: "clarify", question: `Which asset should I grade — for example, "add 10 rNVDA"?`, confidence: rounded };
  }
  const symbol = toRTokenSymbol(jev.symbol);
  const r = resolveQty(findQty(` ${text.toLowerCase()} `), symbol, side, book);
  if (!r.ok || r.qty == null) {
    return { kind: "clarify", question: r.hint ?? `How much ${symbol}?`, confidence: rounded };
  }
  const proposal: ParsedProposal = { side: r.side ?? side, symbol, qty: r.qty };
  // Always auto-grade when action + symbol + qty resolve: the interpretation
  // chip (shown below AUTO_GRADE_CHIP_BELOW) lets the user spot a misread and
  // correct it via the manual controls. Clarify only when info is missing.
  return {
    kind: "proposal",
    proposal,
    confidence: rounded,
    source: "jev",
    interpretation: `Interpreted as ${proposal.side} ${proposal.qty} ${proposal.symbol} (${rounded.toFixed(2)})`,
  };
}

/**
 * A regex hold probe on the wrong line is worse than a 500ms Jev call:
 * bypass the fast path when the text names a held symbol that is not the
 * probe target, so Jev can scope the probe to the named line. Pure.
 */
export function shouldBypassFastPath(text: string, book: BookLine[], probe: ParsedProposal): boolean {
  const named = findSymbol(` ${text.toLowerCase().trim()} `);
  return !!named && book.some((b) => b.symbol.toUpperCase() === named) && named !== probe.symbol;
}

/** Full dispatch: regex fast path → Jev → deterministic fallback. Never throws. */
export async function dispatchIntent(text: string, book: BookLine[]): Promise<DispatchOutcome> {
  const t = text.trim().slice(0, 500);
  if (!t) return { kind: "hint", hint: EXAMPLES };
  const fast = parseProposal(t, book);
  if (fast.ok && fast.proposal && (!fast.proposal.probe || !shouldBypassFastPath(t, book, fast.proposal))) {
    return { kind: "proposal", proposal: fast.proposal, confidence: 1, source: "regex" };
  }
  const jev = await callJevDispatch(t, book);
  return composeDispatch(t, book, jev);
}
