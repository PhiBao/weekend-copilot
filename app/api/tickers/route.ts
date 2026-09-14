import { NextResponse } from "next/server";

interface TickerRow {
  symbol: string;
  last: number | null;
  chg24h: number | null;
}

/** Live rToken snapshot strip (Bitget public tickers, keyless). Best-effort. */
export async function GET() {
  const symbols = ["RNVDAUSDT", "RAAPLUSDT", "RTSLAUSDT", "RMSFTUSDT", "RMETAUSDT", "RQQQUSDT", "RSPYUSDT", "BTCUSDT"];
  const one = async (symbol: string): Promise<TickerRow> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 7000);
    try {
      const res = await fetch(`https://api.bitget.com/api/v2/spot/market/tickers?symbol=${symbol}`, { signal: ctrl.signal });
      clearTimeout(t);
      const j = (await res.json()) as { code?: string; data?: { lastPr?: string; change24h?: string }[] };
      const d = j.data?.[0];
      return {
        symbol,
        last: d?.lastPr != null && Number.isFinite(Number(d.lastPr)) ? Number(d.lastPr) : null,
        chg24h: d?.change24h != null && Number.isFinite(Number(d.change24h)) ? Number(d.change24h) * 100 : null,
      };
    } catch {
      clearTimeout(t);
      return { symbol, last: null, chg24h: null };
    }
  };
  const rows = await Promise.all(symbols.map(one));
  const anyLive = rows.some((r) => r.last != null);
  return NextResponse.json({ ok: anyLive, tickers: rows, ts: new Date().toISOString() }, { headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=120" } });
}
