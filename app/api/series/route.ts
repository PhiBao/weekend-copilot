import { NextResponse } from "next/server";
import { loadSnapshots } from "@/lib/market/snapshots";
import { isKnownSymbol, toNative } from "@/lib/market/symbols";

/** Trimmed price series for the weekend overlay chart. No math, just data. */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raw = (searchParams.get("ticker") ?? "").toUpperCase();
  if (!raw || !isKnownSymbol(raw)) return NextResponse.json({ ok: false, error: "unknown ticker" }, { status: 400 });
  const snap = await loadSnapshots();
  const native = toNative(raw);
  const n = (snap.bars[native] ?? []).slice(-120);
  const r = (snap.rBars[native] ?? []).slice(-120);
  if (!n.length) return NextResponse.json({ ok: false, error: "no data" }, { status: 503 });
  return NextResponse.json({ ok: true, ticker: native, rSymbol: snap.rSymbols[native] ?? "", native: n, rtoken: r, dataAsOf: snap.builtAt });
}
