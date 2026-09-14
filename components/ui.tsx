import type { ReactNode } from "react";

export function fmtPct(x: number, digits = 2): string {
  return `${x >= 0 ? "+" : ""}${x.toFixed(digits)}%`;
}

export function fmtUsdt(x: number): string {
  const sign = x < 0 ? "−" : "+";
  const abs = Math.abs(x);
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(2)}k`;
  return `${sign}$${abs.toFixed(2)}`;
}

export function fmtX(x: number, digits = 2): string {
  return x.toFixed(digits);
}

export function Micro({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 ${className}`}>{children}</p>;
}

export function Card({
  title,
  sub,
  children,
  accent,
  className = "",
  delay,
}: {
  title: string;
  sub?: string;
  children: ReactNode;
  accent?: "green" | "amber" | "red" | "none";
  className?: string;
  delay?: number;
}) {
  const ring =
    accent === "green"
      ? "border-emerald-400/25"
      : accent === "amber"
        ? "border-amber-400/25"
        : accent === "red"
          ? "border-red-400/25"
          : "border-white/[0.08]";
  return (
    <section
      className={`animate-rise rounded-2xl border ${ring} bg-gradient-to-b from-white/[0.045] to-white/[0.012] p-5 sm:p-6 ${className}`}
      style={delay != null ? { animationDelay: `${delay}ms` } : undefined}
    >
      <header>
        <h2 className="text-[13px] font-semibold tracking-wide text-zinc-100">{title}</h2>
        {sub && <p className="mt-1 text-[12px] leading-5 text-zinc-500">{sub}</p>}
      </header>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Inline CSS bar for a value in [-max, max]. */
export function DivergingBar({ value, max, format }: { value: number; max: number; format: (v: number) => string }) {
  const pct = Math.min(Math.abs(value) / max, 1) * 50;
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
        <div className="absolute left-1/2 top-0 h-full w-px bg-white/20" />
        {value < 0 ? (
          <div className="absolute top-0 h-full rounded-l-full bg-red-400/80" style={{ right: "50%", width: `${pct}%` }} />
        ) : (
          <div className="absolute top-0 h-full rounded-r-full bg-emerald-400/80" style={{ left: "50%", width: `${pct}%` }} />
        )}
      </div>
      <span className="tnum w-24 text-right font-mono text-xs text-zinc-300">{format(value)}</span>
    </div>
  );
}

export function Badge({ tone, children }: { tone: "green" | "amber" | "red" | "grey"; children: ReactNode }) {
  const cls =
    tone === "green"
      ? "bg-emerald-400/10 text-emerald-300 border-emerald-400/25"
      : tone === "amber"
        ? "bg-amber-400/10 text-amber-300 border-amber-400/25"
        : tone === "red"
          ? "bg-red-400/10 text-red-300 border-red-400/25"
          : "bg-white/[0.04] text-zinc-400 border-white/10";
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${cls}`}>{children}</span>;
}

export function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/[0.04] py-2 last:border-0">
      <dt className="text-[12px] text-zinc-500">{k}</dt>
      <dd className={`tnum text-[13px] text-zinc-100 ${mono ? "font-mono" : ""}`}>{v}</dd>
    </div>
  );
}

/** Big odometer stat. */
export function Stat({
  label,
  children,
  hint,
  tone = "default",
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  tone?: "default" | "green" | "amber" | "red";
}) {
  const color = tone === "green" ? "text-emerald-300" : tone === "amber" ? "text-amber-300" : tone === "red" ? "text-red-300" : "text-zinc-50";
  return (
    <div className="px-4 py-1 first:pl-0 last:pr-0">
      <Micro>{label}</Micro>
      <div className={`mt-1.5 text-2xl leading-none sm:text-3xl ${color}`}>{children}</div>
      {hint && <p className="mt-1 text-[11px] leading-4 text-zinc-500">{hint}</p>}
    </div>
  );
}
