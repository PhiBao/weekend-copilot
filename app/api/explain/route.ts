import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
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

/**
 * Narration cache: keyed by a stable signature of the analysis (numbers +
 * rule + headline set + model), NOT the receipt id. Re-running the same
 * analysis returns the same verified narration without another LLM call —
 * faster repeat demos and lower token spend. Best-effort file cache for
 * local/dev; in-memory per instance on serverless.
 */
const memCache = new Map<string, string>();

function signature(facts: FactBag, heads: { title?: string }[], model: string): string {
  return createHash("sha256")
    .update(JSON.stringify([facts.narrative, facts.rule, facts.recommendation, heads.map((h) => h.title ?? ""), model]))
    .digest("hex")
    .slice(0, 24);
}

function cacheGet(sig: string): string | null {
  const mem = memCache.get(sig);
  if (mem) return mem;
  try {
    const file = JSON.parse(readFileSync(join(process.cwd(), "data", "narration_cache.json"), "utf8")) as Record<string, string>;
    const hit = file[sig];
    if (hit) {
      memCache.set(sig, hit);
      return hit;
    }
  } catch {
    /* no cache file yet */
  }
  return null;
}

function cacheSet(sig: string, prose: string): void {
  memCache.set(sig, prose);
  try {
    const path = join(process.cwd(), "data", "narration_cache.json");
    let file: Record<string, string> = {};
    try {
      file = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
    } catch {
      mkdirSync(join(process.cwd(), "data"), { recursive: true });
    }
    file[sig] = prose;
    writeFileSync(path, JSON.stringify(file, null, 2));
  } catch {
    /* read-only fs on serverless — memory cache is enough */
  }
}

/**
 * Raw HTTPS POST — deliberately bypasses Next.js's patched global fetch.
 * Observed: identical requests hang indefinitely through the patched fetch
 * inside route handlers, while plain Node/curl succeed against the same
 * endpoint. Using node:https removes that failure mode entirely.
 */
function httpsPostJson(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = httpsRequest(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
      },
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

  const sig = signature(facts, heads, model);
  const cached = cacheGet(sig);
  if (cached) {
    return NextResponse.json({ ok: true, source: "llm", model, validated: true, cached: true, prose: cached });
  }

  const callLLM = async (timeoutMs: number) => {
    const payload = JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 300,
      // NOTE: the hackathon proxy honors the TOP-LEVEL flag only; passing it via
      // extra_body is silently ignored and reasoning burns 30-55s per call.
      enable_thinking: false,
      messages: [
        {
          role: "system",
          content:
            "You are a trading-desk narrator. Write 4 terse sentences, no preamble: (1) what the numbers say, (2) weekend read, (3) restraint rationale with headline context, (4) cheapest expression. RULES: reuse ONLY numbers that appear verbatim in the analyst note. You may reference at most two headlines, by outlet name only, never inventing quotes, events, or figures. No new tickers. No advice beyond the stated recommendation.",
        },
        { role: "user", content: facts.narrative + ` Standing rule: ${facts.rule}` + contextBlock },
      ],
    });
    const res = await httpsPostJson(
      `${base.replace(/\/$/, "")}/chat/completions`,
      { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      payload,
      timeoutMs
    );
    if (res.status < 200 || res.status >= 300) throw new Error(`LLM HTTP ${res.status}`);
    const j = JSON.parse(res.text) as { choices?: { message?: { content?: string } }[] };
    const prose = j.choices?.[0]?.message?.content?.trim() ?? "";
    if (!prose) throw new Error("empty LLM response");
    return prose;
  };

  try {
    let prose: string;
    try {
      prose = await callLLM(22000);
    } catch {
      prose = await callLLM(22000); // one retry: the hackathon proxy stalls intermittently
    }
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
    cacheSet(sig, prose);
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
