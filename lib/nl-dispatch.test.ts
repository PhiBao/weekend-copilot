import { describe, expect, it } from "vitest";
// The runner's .env may carry a live key — unit tests must never touch the network.
delete process.env.TYPESAFE_API_KEY;
import {
  AUTO_GRADE_CHIP_BELOW,
  composeDispatch,
  dispatchIntent,
  shouldBypassFastPath,
  type JevDispatchAnswers,
} from "./nl-dispatch";
import type { BookLine } from "./types";

const BOOK: BookLine[] = [
  { symbol: "rNVDA", qty: 40 },
  { symbol: "rAAPL", qty: 10 },
  { symbol: "rTSLA", qty: 20 },
];

const J = (action: JevDispatchAnswers["action"], actionConf: number, symbol: string, symbolConf: number): JevDispatchAnswers => ({
  action,
  actionConf,
  symbol,
  symbolConf,
});

describe("dispatch fast path (no network)", () => {
  it("grades exact input via regex without Jev", async () => {
    const o = await dispatchIntent("add 10 rNVDA", BOOK);
    expect(o.kind).toBe("proposal");
    if (o.kind !== "proposal") return;
    expect(o.source).toBe("regex");
    expect(o.proposal).toMatchObject({ side: "BUY", symbol: "RNVDA", qty: 10 });
    expect(o.confidence).toBe(1);
  });

  it("falls back to today's hint when regex fails and no key is set", async () => {
    // Test env has no TYPESAFE_API_KEY → callJevDispatch returns null.
    expect(process.env.TYPESAFE_API_KEY).toBeUndefined();
    const o = await dispatchIntent("blargh xyzzy", BOOK);
    expect(o.kind).toBe("hint");
  });
});

describe("compose: paraphrases become proposals", () => {
  it("'buy 5 tesla' → BUY 5 RTSLA", () => {
    const o = composeDispatch("buy 5 tesla", BOOK, J("grade_buy", 0.99, "TSLA", 1.0));
    expect(o.kind).toBe("proposal");
    if (o.kind !== "proposal") return;
    expect(o.proposal).toMatchObject({ side: "BUY", symbol: "RTSLA", qty: 5 });
    expect(o.source).toBe("jev");
    expect(o.confidence).toBe(0.99);
  });

  it("'dump my entire apple position' → SELL the held line", () => {
    const o = composeDispatch("dump my entire apple position", BOOK, J("grade_sell", 0.75, "AAPL", 1.0));
    expect(o.kind).toBe("proposal");
    if (o.kind !== "proposal") return;
    expect(o.proposal).toMatchObject({ side: "SELL", symbol: "RAAPL", qty: 10 });
  });

  it("'sell all my meta' → clarify (not held)", () => {
    const o = composeDispatch("sell all my meta", BOOK, J("grade_sell", 0.95, "META", 0.98));
    expect(o.kind).toBe("clarify");
    if (o.kind !== "clarify") return;
    expect(o.question).toContain("hold no RMETA");
  });

  it("'add a little more microsoft' → clarify qty", () => {
    const o = composeDispatch("add a little more microsoft", BOOK, J("grade_buy", 0.65, "MSFT", 0.99));
    expect(o.kind).toBe("clarify");
    if (o.kind !== "clarify") return;
    expect(o.question).toContain("How much RMSFT?");
    expect(o.confidence).toBe(0.65);
  });
});

describe("compose: missing info becomes a targeted question", () => {
  it("symbol only → ask for the action", () => {
    const o = composeDispatch("nvda", BOOK, J("unclear", 0.59, "NVDA", 1.0));
    expect(o.kind).toBe("clarify");
    if (o.kind !== "clarify") return;
    expect(o.question).toContain("RNVDA");
    expect(o.question).toMatch(/add|trim|hold/i);
  });

  it("action without symbol → ask which asset", () => {
    for (const [text, action] of [["should I buy?", "grade_buy"], ["reduce exposure", "grade_sell"]] as const) {
      const o = composeDispatch(text, BOOK, J(action, 0.9, "none", 0.9));
      expect(o.kind).toBe("clarify");
      if (o.kind !== "clarify") return;
      expect(o.question).toContain("Which asset");
    }
  });

  it("nothing parseable → today's hint", () => {
    const o = composeDispatch("what's the weather like?", BOOK, J("unclear", 1.0, "none", 0.96));
    expect(o.kind).toBe("hint");
  });

  it("unsupported comparison → targeted question, not a dead end", () => {
    const o = composeDispatch("compare adding NVDA vs trimming TSLA", BOOK, J("unclear", 0.22, "NVDA", 0.75));
    expect(o.kind).toBe("clarify");
    if (o.kind !== "clarify") return;
    expect(o.confidence).toBe(0.22);
  });
});

describe("compose: hold probes scope to the named line", () => {
  it("hold-check on a held symbol probes that line", () => {
    const o = composeDispatch("is Tesla safe to hold?", BOOK, J("hold_check", 0.9, "TSLA", 0.95));
    expect(o.kind).toBe("proposal");
    if (o.kind !== "proposal") return;
    expect(o.proposal).toMatchObject({ side: "SELL", symbol: "RTSLA", qty: 5, probe: true });
    expect(o.interpretation).toContain("hold-check on RTSLA");
  });

  it("hold-check on an unheld symbol falls back to the largest line", () => {
    const o = composeDispatch("should I hold my bitcoin?", BOOK, J("hold_check", 0.88, "BTC", 0.97));
    expect(o.kind).toBe("proposal");
    if (o.kind !== "proposal") return;
    expect(o.proposal).toMatchObject({ side: "SELL", symbol: "RNVDA", qty: 10, probe: true });
  });

  it("empty book → hint", () => {
    const o = composeDispatch("should I hold?", [], J("hold_check", 0.9, "none", 0.8));
    expect(o.kind).toBe("hint");
  });
});

describe("fast-path bypass for mis-scoped hold probes", () => {
  it("bypasses when the text names a different held line", () => {
    expect(
      shouldBypassFastPath("is Tesla safe to hold?", BOOK, { side: "SELL", symbol: "RNVDA", qty: 10, probe: true })
    ).toBe(true);
  });
  it("keeps the fast path when no symbol is named", () => {
    expect(
      shouldBypassFastPath("should I hold over the weekend?", BOOK, { side: "SELL", symbol: "RNVDA", qty: 10, probe: true })
    ).toBe(false);
  });
  it("keeps the fast path when the named line is already the target", () => {
    expect(
      shouldBypassFastPath("should I hold my nvda?", BOOK, { side: "SELL", symbol: "RNVDA", qty: 10, probe: true })
    ).toBe(false);
  });
});

describe("interpretation chip threshold", () => {
  it("flags sub-threshold Jev proposals for the UI chip", () => {
    expect(AUTO_GRADE_CHIP_BELOW).toBe(0.85);
    const o = composeDispatch("buy 5 tesla", BOOK, J("grade_buy", 0.65, "TSLA", 0.99));
    expect(o.kind).toBe("proposal");
    if (o.kind !== "proposal") return;
    expect(o.confidence).toBeLessThan(AUTO_GRADE_CHIP_BELOW);
    expect(o.interpretation).toContain("0.65");
  });
});
