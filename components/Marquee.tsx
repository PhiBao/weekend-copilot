"use client";

import { useEffect, useState } from "react";

interface Ticker {
  symbol: string;
  last: number | null;
  chg24h: number | null;
}

const FALLBACK: { text: string; tone?: "up" | "down" }[] = [
  { text: "rToken trades 24/7 — humans sleep" },
  { text: "same trade · two books · opposite advice" },
  { text: "receipts, not screenshots" },
  { text: "breaker runs at 2× costs" },
  { text: "read-only · no keys · no orders" },
  { text: "Bitget AI Base Camp S2" },
];

function fmtPrice(n: number): string {
  if (n >= 10000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (n >= 100) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

/** Exchange-style ticker tape. Live Bitget rToken prices, phrases as fallback. */
export default function Marquee() {
  const [tickers, setTickers] = useState<Ticker[] | null>(null);

  useEffect(() => {
    fetch("/api/tickers")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setTickers(j.tickers as Ticker[]);
      })
      .catch(() => {});
  }, []);

  const live = (tickers ?? []).filter((t) => t.last != null);
  const usingLive = live.length > 0;

  const item = (key: string, node: React.ReactNode) => (
    <span key={key} className="flex shrink-0 items-center gap-1.5 px-4 font-mono text-[11px] leading-none">
      {node}
      <span className="pl-4 text-zinc-700">/</span>
    </span>
  );

  const row = usingLive
    ? live.map((t, i) =>
        item(`t${i}`, (
          <>
            <span className="text-zinc-500">{t.symbol.replace("USDT", "")}</span>
            <span className="tnum text-zinc-200">{fmtPrice(t.last as number)}</span>
            {t.chg24h != null && (
              <span className={`tnum ${t.chg24h < 0 ? "text-red-400" : "text-emerald-400"}`}>
                {t.chg24h >= 0 ? "▲" : "▼"} {Math.abs(t.chg24h).toFixed(2)}%
              </span>
            )}
          </>
        ))
      )
    : FALLBACK.map((f, i) => item(`f${i}`, <span className="text-zinc-500">{f.text}</span>));

  return (
    <div className="marquee relative overflow-hidden border-t border-white/[0.06] bg-white/[0.015]" aria-hidden="true">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-[#08090c] to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-[#08090c] to-transparent" />
      <div className="marquee-track py-2">
        {row}
        {row}
      </div>
    </div>
  );
}
