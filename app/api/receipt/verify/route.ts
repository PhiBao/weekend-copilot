import { NextResponse } from "next/server";
import { tamperStateless, verifyReceipt, type Receipt } from "@/lib/risk-engine/receipts";

/**
 * Stateless receipt verification — instance-free by design.
 * POST {receipt} -> {valid, tamperDemo}. The receipt is self-contained:
 * integrity recomputes from its own fields, so any Vercel instance verifies.
 */
export async function POST(req: Request) {
  let body: { receipt?: Receipt };
  try {
    body = (await req.json()) as { receipt?: Receipt };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  if (!body.receipt || typeof body.receipt !== "object") {
    return NextResponse.json({ ok: false, error: "receipt object required" }, { status: 400 });
  }
  const valid = verifyReceipt(body.receipt);
  const demo = tamperStateless(body.receipt);
  return NextResponse.json({ ok: true, valid, id: body.receipt.id, hash: body.receipt.hash, tamperDemo: { doctoredOutputs: demo.tampered, verifies: demo.ok } });
}
