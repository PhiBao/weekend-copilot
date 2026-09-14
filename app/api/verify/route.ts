import { NextResponse } from "next/server";
import { runVerify } from "@/lib/verify";

export async function GET() {
  const result = await runVerify();
  return NextResponse.json({ ok: true, ...result }, { status: result.pass ? 200 : 500 });
}
