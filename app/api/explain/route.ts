import { NextResponse } from "next/server";
import { collectNumbers, numbersLocked } from "@/lib/risk-engine/numberlock";
import { getReceipt, verifyReceipt, type Receipt } from "@/lib/risk-engine/receipts";

// Qwen reasoning adds ~12s; UI already renders cards first and narrates async,
// but serverless caps still apply — allow the platform max on this route.
export const maxDuration = 60;

interface FactBag {
  numbers: number[];
  narrative: string;
  recommendation: string;
  rule: string;
}

/** Flatten all finite numbers from an unknown JSON value. */
function receiptNumbers(v: unknown): number[] {
  const out: number[] = [];
  collectNumbers(v, out);
  return out;
}

function templateProse(f: { narrative: string; recommendation: string; rule: string }): string {
  return `${f.narrative} Transmission: weekend left-tail + concentration argue for restraint; the breaker prices both at double costs. Standing rule filed: “${f.rule}” Recommendation stands as computed: ${f.recommendation.replace("_", " ")}.`;
}

export async function POST(req: Request) {
  let body: { receiptId?: string; receipt?: Receipt };
  try {
    body = (await req.json()) as { receiptId?: string; receipt?: Receipt };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  // Stateless path (preferred, instance-free): client sends the full receipt,
  // integrity re-verified here before any narration.
  let receipt: Receipt | null = null;
  if (body.receipt && typeof body.receipt === "object") {
    if (!verifyReceipt(body.receipt)) return NextResponse.json({ ok: false, error: "receipt integrity check failed — refused" }, { status: 400 });
    receipt = body.receipt;
  } else {
    receipt = body.receiptId ? getReceipt(body.receiptId) : null;
  }
  if (!receipt) return NextResponse.json({ ok: false, error: "receipt not found" }, { status: 404 });
  const outputs = receipt.outputs as {
    narrative?: string;
    recommendation?: string;
    rule?: { rule?: string };
    headlines?: { title?: string; source?: string }[];
    newsAsOf?: string | null;
  };
  const facts: FactBag = { numbers: receiptNumbers(receipt.outputs), narrative: outputs.narrative ?? "", recommendation: outputs.recommendation ?? "", rule: outputs.rule?.rule ?? "" };

  const base = process.env.LLM_BASE_URL;
  const key = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL ?? "qwen3.8-max";
  if (!base || !key) {
    return NextResponse.json({ ok: true, source: "template", validated: true, prose: templateProse({ narrative: facts.narrative, recommendation: facts.recommendation, rule: facts.rule }) });
  }

  const heads = (outputs.headlines ?? []).slice(0, 3).filter((h) => h.title);
  const contextBlock = heads.length
    ? `\nLive headlines (keyless RSS${outputs.newsAsOf ? `, as of ${outputs.newsAsOf}` : ""}):\n${heads.map((h) => `- [${h.source ?? "press"}] ${h.title}`).join("\n")}`
    : "";

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 55000);
    const res = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 300,
        extra_body: { enable_thinking: false }, // reasoning adds ~12s; narration doesn't need it
        messages: [
          {
            role: "system",
            content:
              "You are a trading-desk narrator. Write 4 terse sentences, no preamble: (1) what the numbers say, (2) weekend read, (3) restraint rationale with headline context, (4) cheapest expression. RULES: reuse ONLY numbers that appear verbatim in the analyst note. You may reference at most two headlines, by outlet name only, never inventing quotes, events, or figures. No new tickers. No advice beyond the stated recommendation.",
          },
          { role: "user", content: facts.narrative + ` Standing rule: ${facts.rule}` + contextBlock },
        ],
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const prose = j.choices?.[0]?.message?.content?.trim() ?? "";
    if (!prose) throw new Error("empty LLM response");
    const lock = numbersLocked(prose, facts.numbers);
    if (!lock.ok) {
      return NextResponse.json({
        ok: true,
        source: "template",
        validated: true,
        refused: `LLM invented numbers (${lock.offenders.slice(0, 5).join(", ")}) — refused by number-lock, template served.`,
        prose: templateProse({ narrative: facts.narrative, recommendation: facts.recommendation, rule: facts.rule }),
      });
    }
    return NextResponse.json({ ok: true, source: "llm", model, validated: true, prose });
  } catch (e) {
    return NextResponse.json({
      ok: true,
      source: "template",
      validated: true,
      refused: e instanceof Error ? `LLM unavailable (${e.message}) — template served.` : "LLM unavailable — template served.",
      prose: templateProse({ narrative: facts.narrative, recommendation: facts.recommendation, rule: facts.rule }),
    });
  }
}
