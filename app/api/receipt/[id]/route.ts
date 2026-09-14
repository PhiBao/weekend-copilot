import { NextResponse } from "next/server";
import { getReceipt, tamperPreview } from "@/lib/risk-engine/receipts";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = getReceipt(id);
  if (!r) return NextResponse.json({ ok: false, error: "receipt not found (server restarted? receipts are in-memory + best-effort disk)" }, { status: 404 });
  // Tamper demo payload included so judges can see verification fail on doctored numbers.
  const demo = tamperPreview(id);
  return NextResponse.json({ ok: true, receipt: r, tamperDemo: { doctoredOutputs: demo.tampered, verifies: demo.ok } });
}
