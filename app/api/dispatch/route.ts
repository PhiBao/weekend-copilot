import { NextResponse } from "next/server";
import { dispatchIntent } from "@/lib/nl-dispatch";
import { EXAMPLES } from "@/lib/nl";
import type { BookLine } from "@/lib/types";

function sanitizeBook(raw: unknown): BookLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (h): h is { symbol: string; qty: number } =>
        !!h && typeof h === "object" && typeof (h as { symbol?: unknown }).symbol === "string" && Number.isFinite((h as { qty?: unknown }).qty)
    )
    .slice(0, 20)
    .map((h) => ({ symbol: h.symbol.toUpperCase().slice(0, 12), qty: Math.max(0, Math.min(1e6, h.qty)) }));
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { text?: unknown; book?: unknown };
    const text = typeof body.text === "string" ? body.text.slice(0, 500) : "";
    const outcome = await dispatchIntent(text, sanitizeBook(body.book));
    return NextResponse.json({ ok: true, outcome });
  } catch {
    // Never worse than today's dead-end hint.
    return NextResponse.json({ ok: true, outcome: { kind: "hint", hint: EXAMPLES } });
  }
}
