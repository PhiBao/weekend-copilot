import { NextResponse } from "next/server";
import { loadSnapshots } from "@/lib/market/snapshots";
import { isKnownSymbol, toNative } from "@/lib/market/symbols";
import { stressTicker } from "@/lib/risk-engine/stress";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raw = (searchParams.get("ticker") ?? "").toUpperCase();
  if (!raw) return NextResponse.json({ ok: false, error: "ticker required" }, { status: 400 });
  if (!isKnownSymbol(raw)) return NextResponse.json({ ok: false, error: `unknown symbol ${raw}` }, { status: 400 });
  const snap = await loadSnapshots();
  const native = toNative(raw);
  const bars = (snap.bars[native] ?? []).map((b) => ({ date: b.date, close: b.close, open: b.open }));
  if (bars.length < 30) return NextResponse.json({ ok: false, error: "no data" }, { status: 503 });
  return NextResponse.json({ ok: true, stress: stressTicker(native, bars), dataAsOf: snap.builtAt, stale: snap.stale });
}
