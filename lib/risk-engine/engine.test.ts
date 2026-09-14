import { describe, expect, it } from "vitest";
import { auditBacktest } from "../audit";
import { logReturns, mean, percentile, sharpeAnnualized } from "../stats";
import { computeDelta } from "./delta";
import { breakerCheck, fridayMondayGaps, stressTicker } from "./stress";
import { weekendDrifts } from "./weekend";
import { createReceipt, tamperPreview, tamperStateless, verifyChain, verifyReceipt } from "./receipts";
import { criticize } from "./critic";
import { numbersLocked } from "./numberlock";
import { parseProposal } from "../nl";
import { lastFridayCloseET, parseRss, relevantHeadlines, tagHeadline } from "../market/news";
import { listHypotheses, relevantHypotheses } from "./graveyard";
import { toNative } from "../market/symbols";

// Synthetic deterministic price paths (no network).
function risingCloses(n: number, start = 100, drift = 0.002): number[] {
  const out = [start];
  for (let i = 1; i < n; i++) out.push(out[i - 1] * (1 + drift + (i % 7 === 0 ? -0.004 : 0.001)));
  return out;
}

const closes: Record<string, number[]> = {
  SPY: risingCloses(300, 400, 0.0008),
  NVDA: risingCloses(300, 120, 0.002),
  AAPL: risingCloses(300, 200, 0.001),
  TSLA: risingCloses(300, 250, 0.0005),
};

describe("symbols", () => {
  it("maps rTokens to natives", () => {
    expect(toNative("rNVDA")).toBe("NVDA");
    expect(toNative("NVDA")).toBe("NVDA");
    expect(toNative("BTC")).toBe("BTC");
  });
});

describe("stats", () => {
  it("sharpe is finite on synthetic data", () => {
    expect(Number.isFinite(sharpeAnnualized(logReturns(closes.SPY)))).toBe(true);
  });
  it("percentile interpolates", () => {
    expect(percentile([1, 2, 3, 4], 50)).toBeCloseTo(2.5);
    expect(mean([])).toBe(0);
  });
});

describe("delta engine", () => {
  const book = [
    { symbol: "rNVDA", qty: 40 },
    { symbol: "rAAPL", qty: 10 },
  ];
  it("is deterministic", () => {
    const a = computeDelta(book, { side: "BUY", symbol: "rNVDA", qty: 10 }, closes);
    const b = computeDelta(book, { side: "BUY", symbol: "rNVDA", qty: 10 }, closes);
    expect(a).toEqual(b);
  });
  it("buying concentration raises HHI and beta delta is finite", () => {
    const d = computeDelta(book, { side: "BUY", symbol: "rNVDA", qty: 10 }, closes);
    expect(d.hhiAfter).toBeGreaterThan(d.hhiBefore);
    expect(Number.isFinite(d.betaDelta)).toBe(true);
    expect(d.feeBps).toBe(5);
    expect(d.unknownSymbols).toEqual([]);
  });
  it("flags unknown symbols instead of crashing", () => {
    const d = computeDelta([{ symbol: "rFAKE", qty: 1 }], { side: "BUY", symbol: "rFAKE", qty: 1 }, closes);
    expect(d.unknownSymbols).toContain("rFAKE");
  });
});

describe("weekend stress", () => {
  // Build 30 weeks of Fri/Mon bars deterministically from 2024-01-05 (a Friday).
  const bars: { date: string; close: number; open: number }[] = [];
  const start = new Date("2024-01-05T12:00:00Z").getTime();
  for (let w = 0; w < 30; w++) {
    const fri = new Date(start + w * 7 * 86400000).toISOString().slice(0, 10);
    const mon = new Date(start + (w * 7 + 3) * 86400000).toISOString().slice(0, 10);
    const fc = 100 + w;
    bars.push({ date: fri, close: fc, open: fc - 0.5 });
    bars.push({ date: mon, close: fc * 1.001, open: fc * (w % 5 === 0 ? 0.97 : 1.002) });
  }
  it("extracts Fri→Mon gaps", () => {
    const gaps = fridayMondayGaps(bars);
    expect(gaps.length).toBe(30);
    expect(gaps.some((g) => g.gapPct < -1)).toBe(true);
  });
  it("stress + breaker flag concentration", () => {
    const s = stressTicker("NVDA", bars);
    expect(s.weekends).toBe(30);
    const br = breakerCheck(10000, s, 0.65);
    expect(br.verdict).toBe("FLAG");
    expect(br.drag2xUsdt).toBeGreaterThan(0);
  });
});

describe("in-token weekend drift", () => {
  // 6 weekends of Fri/Sat/Sun rToken prints from 2024-01-05 (Friday).
  const rbars: { date: string; close: number; high: number; low: number }[] = [];
  const start = new Date("2024-01-05T12:00:00Z").getTime();
  for (let w = 0; w < 6; w++) {
    const fri = new Date(start + w * 7 * 86400000).toISOString().slice(0, 10);
    const sat = new Date(start + (w * 7 + 1) * 86400000).toISOString().slice(0, 10);
    const sun = new Date(start + (w * 7 + 2) * 86400000).toISOString().slice(0, 10);
    const fc = 100 + w;
    rbars.push({ date: fri, close: fc, high: fc + 1, low: fc - 1 });
    if (w !== 2) rbars.push({ date: sat, close: fc * 1.005, high: fc * 1.01, low: fc * 0.999 }); // missing Sat handled
    rbars.push({ date: sun, close: fc * (w % 2 === 0 ? 0.985 : 1.01), high: fc * 1.02, low: fc * 0.98 });
  }
  it("measures Fri→Sun drift incl. missing Saturdays", () => {
    const d = weekendDrifts("NVDA", "RNVDAUSDT", rbars);
    expect(d.weekendsMeasured).toBe(6);
    expect(d.probDown).toBeCloseTo(0.5);
    expect(d.prints.length).toBe(6);
    expect(d.confidence).toBe("medium");
  });
  it("reports low confidence on thin history", () => {
    const d = weekendDrifts("NVDA", "RNVDAUSDT", rbars.slice(0, 3));
    expect(d.confidence).toBe("low");
  });
});

describe("audit (backcheck port)", () => {
  it("withholds DSR without trial count", () => {
    const r = auditBacktest({ returns: [0.01, -0.005, 0.02] });
    expect(r.dsr).toBeNull();
    expect(r.flags.some((f) => f.startsWith("TRIALS_UNKNOWN"))).toBe(true);
  });
  it("flags overfit on noise with many trials", () => {
    const rets = Array.from({ length: 600 }, (_, i) => (i % 2 === 0 ? 0.002 : -0.00195));
    const r = auditBacktest({ returns: rets, nTrials: 5000 });
    expect(r.verdict).toBe("LIKELY_OVERFIT");
  });
  it("calls a middling edge inconclusive, not robust", () => {
    const rets = Array.from({ length: 600 }, (_, i) => (i % 2 === 0 ? 0.002 : -0.0018));
    const r = auditBacktest({ returns: rets, nTrials: 5000 });
    expect(r.verdict).toBe("INCONCLUSIVE");
    expect(r.flags.some((f) => f.startsWith("LIKELY_OVERFIT"))).toBe(true);
  });
});

describe("receipts", () => {
  it("chains and verifies; tamper fails", () => {
    const r1 = createReceipt({ kind: "delta", inputs: { a: 1 }, outputs: { b: 2 }, dataSha: "abc", confidence: "high", notes: [] });
    const r2 = createReceipt({ kind: "delta", inputs: { a: 2 }, outputs: { b: 3 }, dataSha: "def", confidence: "medium", notes: [] });
    expect(r2.prevHash).toBe(r1.hash);
    expect(verifyChain().every((l) => l.ok)).toBe(true);
    expect(tamperPreview(r1.id).ok).toBe(false);
  });
  it("verifies statelessly (instance-free) and rejects doctored copies", () => {
    const r1 = createReceipt({ kind: "delta", inputs: { a: 1 }, outputs: { betaAfter: 1.74 }, dataSha: "abc", confidence: "high", notes: [] });
    expect(verifyReceipt(r1)).toBe(true);
    const demo = tamperStateless(r1);
    expect(demo.ok).toBe(false);
    const forged = { ...r1, hash: "0".repeat(64) };
    expect(verifyReceipt(forged)).toBe(false);
  });
});

describe("plain-English parser", () => {
  const book = [
    { symbol: "rNVDA", qty: 40 },
    { symbol: "rTSLA", qty: 20 },
  ];
  it("parses add/buy with qty", () => {
    expect(parseProposal("add 10 rNVDA", book)).toEqual({ ok: true, proposal: { side: "BUY", symbol: "RNVDA", qty: 10 } });
    expect(parseProposal("buy 5 tesla", book).proposal).toMatchObject({ side: "BUY", symbol: "RTSLA", qty: 5 });
  });
  it("resolves half/all against the book", () => {
    expect(parseProposal("trim half my tsla", book).proposal).toMatchObject({ side: "SELL", symbol: "RTSLA", qty: 10 });
    expect(parseProposal("sell all rNVDA", book).proposal).toMatchObject({ side: "SELL", symbol: "RNVDA", qty: 40 });
  });
  it("turns hold into a labeled probe, never a guess", () => {
    const r = parseProposal("should I hold over the weekend?", book);
    expect(r.ok).toBe(true);
    expect(r.proposal?.probe).toBe(true);
    expect(r.proposal?.side).toBe("SELL");
  });
  it("refuses instead of hallucinating", () => {
    expect(parseProposal("buy some stonks", book).ok).toBe(false);
    expect(parseProposal("trim half my mu", book).ok).toBe(false); // not held
    expect(parseProposal("", book).ok).toBe(false);
  });
});

describe("headlines", () => {
  const xml = `<rss><channel><item><title><![CDATA[Nvidia Blackwell demand surges as Fed holds rates]]></title><link>https://x.test/1</link><pubDate>Mon, 14 Sep 2026 10:00:00 GMT</pubDate></item><item><title>Local sports results</title><link>https://x.test/2</link><pubDate>Mon, 14 Sep 2026 09:00:00 GMT</pubDate></item></channel></rss>`;
  it("parses RSS and tags tickers + channels", () => {
    const items = parseRss(xml);
    expect(items.length).toBe(2);
    const h = tagHeadline(items[0].title, items[0].pubDate, "TEST", lastFridayCloseET(new Date("2026-09-14T12:00:00Z").getTime()));
    expect(h.tickers).toContain("NVDA");
    expect(h.channels).toEqual(expect.arrayContaining(["AI_DEMAND", "FED_RATES"]));
    expect(h.weekendWindow).toBe(true); // Monday after Sep 11 Friday close
  });
  it("ranks direct mentions above macro noise", () => {
    const now = new Date("2026-09-14T12:00:00Z").getTime();
    const fri = lastFridayCloseET(now);
    const all = [
      tagHeadline("Fed holds rates steady", new Date(now - 3600000).toISOString(), "T", fri),
      tagHeadline("Tesla deliveries miss sparks downgrade", new Date(now - 7200000).toISOString(), "T", fri),
    ];
    const rel = relevantHeadlines(all, "TSLA", 2);
    expect(rel[0].tickers).toContain("TSLA");
  });
  it("decodes named and numeric HTML entities in titles", () => {
    const xml = `<rss><channel><item><title>Novo drops &#x2018;Nordisk&#x2019; &amp; CEOs&apos; calls &lt;test&gt;</title><link>https://x.test/3</link><pubDate>Mon, 14 Sep 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
    const items = parseRss(xml);
    expect(items[0].title).toBe("Novo drops ‘Nordisk’ & CEOs' calls <test>");
  });
});

describe("number-lock validator", () => {
  const facts = [1.72, 1.74, 0.52, -2.24, 0.27, 99, 31];
  it("passes prose reusing locked numbers", () => {
    expect(numbersLocked("Beta 1.72 → 1.74, HHI 0.52, P10 -2.24% across 99 weekends.", facts).ok).toBe(true);
  });
  it("refuses invented numbers", () => {
    const r = numbersLocked("Beta 1.72 → 1.90 with 85% confidence looks great.", facts);
    expect(r.ok).toBe(false);
    expect(r.offenders.length).toBeGreaterThan(0);
  });
  it("ignores small integers (counts/dates)", () => {
    expect(numbersLocked("3 sentences across 99 weekends in 2026.", facts).ok).toBe(true);
  });
});

describe("critic + graveyard", () => {
  it("proposes exactly one rule for a concentrated buy", () => {
    const d = computeDelta(
      [{ symbol: "rNVDA", qty: 40 }, { symbol: "rAAPL", qty: 10 }],
      { side: "BUY", symbol: "rNVDA", qty: 40 },
      closes
    );
    const s = stressTicker("NVDA", [
      { date: "2024-01-05", close: 100, open: 99 },
      { date: "2024-01-08", close: 97, open: 96 },
    ]);
    const rule = criticize(d, s, breakerCheck(10000, s, d.hhiAfter), "BUY");
    expect(typeof rule.rule).toBe("string");
    expect(rule.rule.length).toBeGreaterThan(20);
  });
  it("graveyard ships seeded negatives", () => {
    expect(listHypotheses().some((h) => h.status === "REJECTED")).toBe(true);
    expect(relevantHypotheses("NVDA").length).toBeGreaterThan(0);
  });
});
