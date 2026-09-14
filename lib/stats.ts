// Pure statistics helpers. No I/O, no randomness, no LLM. Deterministic.
export function logReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) out.push(Math.log(closes[i] / closes[i - 1]));
  }
  return out;
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stdev(xs: number[], ddof = 1): number {
  if (xs.length <= ddof) return 0;
  const m = mean(xs);
  const v = xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - ddof);
  return Math.sqrt(Math.max(v, 0));
}

export function skewness(xs: number[]): number {
  if (xs.length < 3) return 0;
  const m = mean(xs);
  const s = stdev(xs);
  if (s === 0) return 0;
  return mean(xs.map((x) => ((x - m) / s) ** 3));
}

export function kurtosis(xs: number[]): number {
  // excess kurtosis
  if (xs.length < 4) return 0;
  const m = mean(xs);
  const s = stdev(xs);
  if (s === 0) return 0;
  return mean(xs.map((x) => ((x - m) / s) ** 4)) - 3;
}

/** Annualized Sharpe from per-period returns. */
export function sharpeAnnualized(rets: number[], periodsPerYear = 252, rfPerPeriod = 0): number {
  const s = stdev(rets);
  if (s === 0 || rets.length < 2) return 0;
  return ((mean(rets) - rfPerPeriod) / s) * Math.sqrt(periodsPerYear);
}

export function maxDrawdown(equity: number[]): number {
  let peak = -Infinity;
  let mdd = 0;
  for (const v of equity) {
    if (v > peak) peak = v;
    if (peak > 0) mdd = Math.min(mdd, v / peak - 1);
  }
  return mdd;
}

export function betaToMarket(asset: number[], market: number[]): number {
  const n = Math.min(asset.length, market.length);
  if (n < 2) return 1;
  const a = asset.slice(-n);
  const m = market.slice(-n);
  const ma = mean(a);
  const mm = mean(m);
  let cov = 0;
  let vm = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i] - ma) * (m[i] - mm);
    vm += (m[i] - mm) ** 2;
  }
  if (vm === 0) return 1;
  return cov / vm;
}

export function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const x = a.slice(-n);
  const y = b.slice(-n);
  const sa = stdev(x);
  const sb = stdev(y);
  if (sa === 0 || sb === 0) return 0;
  const mx = mean(x);
  const my = mean(y);
  let c = 0;
  for (let i = 0; i < n; i++) c += (x[i] - mx) * (y[i] - my);
  return c / ((n - 1) * sa * sb);
}

/** Linear-interpolated percentile of a sorted-or-unsorted array. Returns 0 on empty. */
export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const rank = (p / 100) * (s.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (rank - lo);
}

/** Standard normal CDF via Abramowitz-Stegun erf approximation. */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (x > 0) p = 1 - p;
  return p;
}
