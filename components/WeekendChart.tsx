"use client";

import { useEffect, useState } from "react";

interface Pt {
  date: string;
  close: number;
}
interface SeriesResp {
  ok: boolean;
  ticker?: string;
  rSymbol?: string;
  native?: Pt[];
  rtoken?: Pt[];
}

function weekdayUTC(dateStr: string): number {
  return new Date(dateStr + "T12:00:00Z").getUTCDay();
}

/** Weekend overlay: native vs real rToken 24/7 prints, rebased to 100. */
export default function WeekendChart({ ticker }: { ticker: string }) {
  const [data, setData] = useState<SeriesResp | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setData(null);
    setFailed(false);
    fetch(`/api/series?ticker=${encodeURIComponent(ticker)}`)
      .then((r) => r.json())
      .then((j: SeriesResp) => {
        if (j.ok) setData(j);
        else setFailed(true);
      })
      .catch(() => setFailed(true));
  }, [ticker]);

  if (failed) return <p className="text-xs text-zinc-500">Chart unavailable for {ticker}.</p>;
  if (!data?.native?.length) return <p className="text-xs text-zinc-500">Loading 24/7 overlay…</p>;

  const W = 800;
  const H = 260;
  const PAD = { l: 44, r: 8, t: 12, b: 22 };
  const n = data.native;
  const r = data.rtoken ?? [];
  const baseN = n[0].close;
  const r0 = r.length ? r[0].close : 1;
  const ptsN = n.map((b) => ({ date: b.date, v: (b.close / baseN) * 100 }));
  const ptsR = r.map((b) => ({ date: b.date, v: (b.close / r0) * 100 }));
  const allV = [...ptsN.map((p) => p.v), ...ptsR.map((p) => p.v)];
  const lo = Math.min(...allV);
  const hi = Math.max(...allV);
  const span = Math.max(hi - lo, 0.5);
  const y0 = lo - span * 0.1;
  const y1 = hi + span * 0.1;
  const X = (i: number) => PAD.l + (i / Math.max(n.length - 1, 1)) * (W - PAD.l - PAD.r);
  const Y = (v: number) => PAD.t + (1 - (v - y0) / (y1 - y0)) * (H - PAD.t - PAD.b);
  const line = (pts: { v: number }[]) => pts.map((p, i) => `${i === 0 ? "M" : "L"}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ");
  // align rToken points onto native x-positions by date
  const idxByDate = new Map(n.map((b, i) => [b.date, i]));
  const rAligned = ptsR
    .map((p) => ({ ...p, i: idxByDate.get(p.date) }))
    .filter((p): p is { date: string; v: number; i: number } => p.i !== undefined);
  const rLine = rAligned.map((p, k) => `${k === 0 ? "M" : "L"}${X(p.i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ");

  const step = (W - PAD.l - PAD.r) / Math.max(n.length - 1, 1);
  const ticks = [0, Math.floor(n.length / 2), n.length - 1].map((i) => ({ i, date: n[i].date.slice(5) }));

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${ticker} native vs rToken weekend overlay`}>
        {n.map((b, i) => {
          const wd = weekdayUTC(b.date);
          if (wd !== 0 && wd !== 6) return null;
          return <rect key={b.date} x={X(i) - step / 2} y={PAD.t} width={step} height={H - PAD.t - PAD.b} fill="rgba(52,211,153,0.07)" />;
        })}
        {[0.25, 0.5, 0.75].map((f) => {
          const v = y0 + (y1 - y0) * f;
          return (
            <g key={f}>
              <line x1={PAD.l} x2={W - PAD.r} y1={Y(v)} y2={Y(v)} stroke="#27272a" strokeWidth={1} />
              <text x={4} y={Y(v) + 3} fontSize={9} fill="#71717a" fontFamily="monospace">{v.toFixed(1)}</text>
            </g>
          );
        })}
        <path d={line(ptsN)} fill="none" stroke="#a1a1aa" strokeWidth={1.5} />
        {rLine && <path d={rLine} fill="none" stroke="#34d399" strokeWidth={2} />}
        {ticks.map((t) => (
          <text key={t.i} x={X(t.i)} y={H - 6} fontSize={9} fill="#71717a" textAnchor="middle" fontFamily="monospace">{t.date}</text>
        ))}
      </svg>
      <div className="mt-1 flex items-center gap-4 text-xs text-zinc-500">
        <span><span className="mr-1 inline-block h-0.5 w-4 bg-zinc-400 align-middle" />native {data.ticker}</span>
        <span><span className="mr-1 inline-block h-0.5 w-4 bg-emerald-400 align-middle" />{data.rSymbol || "rToken"} 24/7 prints</span>
        <span className="ml-auto">green bands = Sat/Sun · rebased 100</span>
      </div>
    </div>
  );
}
