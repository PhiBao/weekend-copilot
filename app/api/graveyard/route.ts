import { NextResponse } from "next/server";
import { listHypotheses } from "@/lib/risk-engine/graveyard";

export async function GET() {
  return NextResponse.json({ ok: true, hypotheses: listHypotheses() });
}
