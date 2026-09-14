"use client";

/**
 * Odometer-style rolling number (inspired by Rare UI's Animated Counter).
 * Zero deps: each decimal digit is a 0–9 column translated by CSS transition.
 */
export default function RollingNumber({
  value,
  decimals = 2,
  prefix = "",
  suffix = "",
  className = "",
}: {
  value: number | null | undefined;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  const safe = value != null && Number.isFinite(value) ? value : null;
  const text = safe == null ? "—" : safe.toFixed(decimals);
  const chars = text.split("");

  return (
    <span className={`tnum inline-flex items-baseline font-mono ${className}`} aria-label={safe == null ? "no data" : `${prefix}${text}${suffix}`}>
      {prefix && <span className="mr-[0.12em] text-zinc-500">{prefix}</span>}
      {chars.map((c, i) => {
        if (/\d/.test(c)) return <DigitColumn key={`${i}-${c}`} d={Number(c)} />;
        return (
          <span key={`${i}-${c}`} className={c === "-" ? "text-zinc-400" : "text-zinc-500"}>
            {c}
          </span>
        );
      })}
      {suffix && <span className="ml-[0.08em]">{suffix}</span>}
    </span>
  );
}

const DIGITS = Array.from({ length: 10 }, (_, i) => i);

function DigitColumn({ d }: { d: number }) {
  return (
    <span className="inline-block h-[1em] w-[1ch] overflow-hidden align-baseline leading-none">
      <span
        className="block transition-transform duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ transform: `translateY(-${d * 10}%)` }}
      >
        {DIGITS.map((n) => (
          <span key={n} className="block h-[1em] text-center leading-none">
            {n}
          </span>
        ))}
      </span>
    </span>
  );
}
