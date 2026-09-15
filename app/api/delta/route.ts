import { NextResponse } from "next/server";
import { auditBacktest } from "@/lib/audit";
import { loadSnapshots } from "@/lib/market/snapshots";
import { isKnownSymbol, toNative } from "@/lib/market/symbols";
import { loadHeadlines } from "@/lib/market/newsloader";
import { relevantHeadlines } from "@/lib/market/news";
import { computeDelta } from "@/lib/risk-engine/delta";
import { breakerCheck, stressTicker } from "@/lib/risk-engine/stress";
import { compareHedges } from "@/lib/risk-engine/hedge";
import { criticize } from "@/lib/risk-engine/critic";
import { weekendDrifts } from "@/lib/risk-engine/weekend";
import { relevantHypotheses, recordHypothesis } from "@/lib/risk-engine/graveyard";
import { createReceipt, setReceiptDir } from "@/lib/risk-engine/receipts";
import { logReturns } from "@/lib/stats";
import { join } from "node:path";

setReceiptDir(join(process.cwd(), "data", "receipts"));

interface Body {
  book: { symbol: string; qty: number }[];
  proposal: { side: "BUY" | "SELL"; symbol: string; qty: number };
  trials?: number; // how many variants the user compared (honesty input for DSR)
}

function fail(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

/** Deterministic template narrative. An LLM may rephrase later; numbers are fixed here. */
function narrate(args: {
  side: string; symbol: string; qty: number; betaBefore: number; betaAfter: number;
  hhiAfter: number; topSector: string; topWeight: number; p10: number; p50: number;
  weekends: number; verdict: string; bestHedge: string;
  driftN: number; driftP50: number; driftConf: string;
}): string {
  const dir = args.side === "BUY" ? "Adding" : "Trimming";
  const measured = args.driftN >= 4
    ? ` Measured in-token weekends (${args.driftN}, ${args.driftConf} confidence): median drift ${args.driftP50 >= 0 ? "+" : ""}${args.driftP50.toFixed(2)}%.`
    : " Too few in-token weekends measured — weekend read leans on native-proxy gaps.";
  return (
    `${dir} ${args.qty} ${args.symbol}: book beta ${args.betaBefore.toFixed(2)} → ${args.betaAfter.toFixed(2)}, ` +
    `concentration (HHI) ${args.hhiAfter.toFixed(2)}, top sector ${args.topSector} ${(args.topWeight * 100).toFixed(0)}%. ` +
    `Native-proxy history (${args.weekends} Fri→Mon events): P50 gap ${args.p50 >= 0 ? "+" : ""}${args.p50.toFixed(2)}%, ` +
    `P10 ${args.p10.toFixed(2)}%.${measured} Breaker: ${args.verdict}. Cheapest risk-adjusted expression: ${args.bestHedge}.`
  );
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return fail("invalid JSON body");
  }
  const { book, proposal, trials } = body;
  if (!Array.isArray(book) || book.length === 0 || book.length > 20) return fail("book must have 1–20 lines");
  if (!proposal || (proposal.side !== "BUY" && proposal.side !== "SELL")) return fail("proposal.side must be BUY or SELL");
  if (!proposal.symbol || !Number.isFinite(proposal.qty) || proposal.qty <= 0 || proposal.qty > 1e6) return fail("proposal needs a symbol and 0 < qty ≤ 1e6");
  for (const h of book) {
    if (!h.symbol || !Number.isFinite(h.qty)) return fail("each book line needs symbol + numeric qty");
  }
  if (!isKnownSymbol(proposal.symbol)) return fail(`unknown symbol ${proposal.symbol} — try rNVDA, rAAPL, rTSLA, rMSFT, rQQQ, BTC…`);
  const unknownBook = book.filter((h) => !isKnownSymbol(h.symbol)).map((h) => h.symbol);
  if (unknownBook.length) return fail(`unknown book symbols: ${unknownBook.join(", ")}`);

  const snap = await loadSnapshots();
  if (!snap.closes["SPY"] || Object.keys(snap.closes).length < 8)
    return fail("market data unavailable — snapshots missing and live fallback failed", 503);

  const native = toNative(proposal.symbol);
  const delta = computeDelta(book, proposal, snap.closes);
  const bars = (snap.bars[native] ?? []).map((b) => ({ date: b.date, close: b.close, open: b.open }));
  const stress = stressTicker(native, bars);
  const drift = weekendDrifts(native, snap.rSymbols[native] ?? "", snap.rBars[native] ?? []);
  const breaker = breakerCheck(Math.abs(proposal.qty * (delta.pricesUsed[proposal.symbol.toUpperCase()] ?? 0)), stress, delta.hhiAfter);

  // Audit honesty: trailing-1y single-name sleeve, trials as declared.
  // Framing matters: this grades the habit of picking names by trailing Sharpe
  // (why we use portfolio delta + weekend stress instead), not the user's trade.
  const sleeve = logReturns((snap.closes[native] ?? []).slice(-253));
  const audit = auditBacktest({ returns: sleeve, nTrials: trials ?? undefined });
  const auditView = {
    ...audit,
    subject: `trailing-1y ${native} sleeve (informational — grades Sharpe-picking, not your trade)`,
    note:
      trials == null
        ? "trials not declared — DSR withheld. Declare how many variants you compared."
        : "A weak sleeve audit is the point: trailing Sharpe can't justify a weekend add. Portfolio delta + measured drift can.",
  };

  const hedges = compareHedges(Math.abs(proposal.qty * (delta.pricesUsed[proposal.symbol.toUpperCase()] ?? 0)), delta, stress);
  const bestHedge = [...hedges].sort((a, b) => b.netP10Usdt - a.netP10Usdt)[0];
  const rule = criticize(delta, stress, breaker, proposal.side);

  // Recommendation: deterministic policy (in code, never in a prompt).
  // SELL de-risks by construction -> always proceed-with-limits.
  // BUY trims only on hard concentration or a breaker flag PLUS material risk-add.
  // A lone left-tail flag on a diversified book stays PROCEED (with the flag shown).
  const maxWeightAfter = Math.max(0, ...Object.values(delta.weightsAfter));
  const hardConcentration = maxWeightAfter > 0.55;
  const materialRiskAdd = delta.betaDelta > 0.08 || delta.hhiAfter > delta.hhiBefore + 0.04;
  const recommendation =
    proposal.side === "BUY" && (hardConcentration || (breaker.verdict === "FLAG" && materialRiskAdd))
      ? "TRIM_OR_WAIT"
      : "PROCEED_WITH_LIMITS";

  const dataSha = snap.meta[native]?.sha ?? "live-fallback";
  const news = await loadHeadlines();
  const headlines = relevantHeadlines(news.headlines, native, 8);
  const outputs = {
    delta, stress, drift, breaker, audit: auditView,
    headlines, newsAsOf: news.fetchedAt, newsStale: news.stale, newsOrigin: news.origin,
    hedges, rule, recommendation,
    hypotheses: relevantHypotheses(native),
    narrative: narrate({
      side: proposal.side, symbol: proposal.symbol.toUpperCase(), qty: proposal.qty,
      betaBefore: delta.betaBefore, betaAfter: delta.betaAfter, hhiAfter: delta.hhiAfter,
      topSector: delta.topSector.sector, topWeight: delta.topSector.weight,
      p10: stress.p10, p50: stress.p50, weekends: stress.weekends,
      verdict: breaker.verdict, bestHedge: bestHedge.name,
      driftN: drift.weekendsMeasured, driftP50: drift.p50, driftConf: drift.confidence,
    }),
    dataAsOf: snap.builtAt, stale: snap.stale,
  };
  const receipt = createReceipt({
    kind: "delta",
    inputs: { book, proposal, trials: trials ?? null },
    outputs,
    dataSha,
    confidence: stress.weekends >= 50 ? "high" : stress.weekends >= 20 ? "medium" : "low",
    notes: [
      "Preregistered expectation: compare Monday outcome vs P50/P10 above. No moved goalposts.",
      "Costs: 5bp fee/side + 80bp weekend spread assumption. FCN leg illustrative, not a quote.",
    ],
  });

  // The machine learns: file the critic rule as a candidate hypothesis (UNTESTED until Monday).
  recordHypothesis({ id: `c_${receipt.id}`, title: rule.rule, status: "UNTESTED", regime: rule.regime, evidence: `triggered by [${rule.triggeredBy.join(", ")}] on ${native}` });

  return NextResponse.json({ ok: true, receiptId: receipt.id, hash: receipt.hash, receipt, result: outputs });
}
