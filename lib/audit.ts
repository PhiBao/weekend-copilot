// Port of the backcheck idea (Bailey & López de Prado PSR / DSR / MinTRL)
// to dependency-free TypeScript. Closed-form only. Deterministic.
// Reference: RomJ25/backcheck (MIT), Bailey & López de Prado (2014).
import { kurtosis, mean, normCdf, sharpeAnnualized, skewness, stdev } from "./stats";

export interface AuditInput {
  /** Per-period strategy (or sleeve) returns, net of nothing — caller must state cost treatment. */
  returns: number[];
  periodsPerYear?: number;
  /** Number of configurations searched to find this one. REQUIRED for honesty. */
  nTrials?: number;
  /**
   * Variance of Sharpe ratios across searched configs, in ANNUALIZED Sharpe
   * units (de Prado convention; typical 0.04–0.11). Converted to per-period
   * internally. Default 0.04 (conservative).
   */
  srVariance?: number;
  benchmarkSharpe?: number;
}

export interface AuditReport {
  observations: number;
  sharpeAnnualized: number;
  psr: number; // Probabilistic Sharpe Ratio vs benchmark
  nTrials: number | null;
  expectedMaxSharpeAnnualized: number | null; // noise benchmark (False Strategy Theorem)
  dsr: number | null; // Deflated Sharpe Ratio
  minTrackRecordMonths: number | null;
  flags: string[];
  verdict: "ROBUST" | "INCONCLUSIVE" | "LIKELY_OVERFIT";
}

/**
 * Expected maximum Sharpe under null given N trials (annualized).
 * False Strategy Theorem approximation: E[max] ≈ sqrt(V) * ((1-γ)Φ⁻¹(1-1/N) + γΦ⁻¹(1-1/(Ne)))
 * We use a simplified closed form with Euler-Mascheroni γ.
 */
function expectedMaxSharpe(srVariance: number, nTrials: number): number {
  if (nTrials <= 1) return 0;
  const gamma = 0.5772156649;
  const inv1 = inverseNormCdf(1 - 1 / nTrials);
  const invE = inverseNormCdf(1 - 1 / (nTrials * Math.E));
  return Math.sqrt(srVariance) * ((1 - gamma) * inv1 + gamma * invE);
}

/** Inverse standard normal CDF (Acklam approximation). */
function inverseNormCdf(p: number): number {
  const pc = Math.min(Math.max(p, 1e-12), 1 - 1e-12);
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  const phigh = 1 - plow;
  if (pc < plow) {
    const q = Math.sqrt(-2 * Math.log(pc));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (pc > phigh) {
    const q = Math.sqrt(-2 * Math.log(1 - pc));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = pc - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export function auditBacktest(input: AuditInput): AuditReport {
  const periodsPerYear = input.periodsPerYear ?? 252;
  const rets = input.returns;
  const n = rets.length;
  const sr = sharpeAnnualized(rets, periodsPerYear);
  const flags: string[] = [];

  // PSR vs benchmark (default 0): accounts for skew/kurtosis + sample length.
  const benchmark = input.benchmarkSharpe ?? 0;
  const skew = skewness(rets);
  const kurt = kurtosis(rets); // excess
  const srPerPeriod = n > 1 && stdev(rets) !== 0 ? mean(rets) / stdev(rets) : 0;
  const benchPerPeriod = benchmark / Math.sqrt(periodsPerYear);
  // Standard error with higher-moment correction (Bailey & López de Prado 2012)
  const term = 1 - skew * srPerPeriod + ((kurt - 1) / 4) * srPerPeriod * srPerPeriod;
  const psrDen = Math.sqrt(Math.max(term, 1e-9) / Math.max(n - 1, 1));
  const psr = psrDen > 0 ? normCdf((srPerPeriod - benchPerPeriod) / psrDen) : 0.5;
  if (psr < 0.95) flags.push(`SHARPE_NOT_SIGNIFICANT: PSR ${psr.toFixed(2)} < 0.95 — sample does not establish edge at 95% confidence.`);

  let dsr: number | null = null;
  let expectedMax: number | null = null;
  const nTrials = input.nTrials ?? null;
  if (nTrials == null) {
    flags.push("TRIALS_UNKNOWN: no trial count supplied — selection bias cannot be assessed. DSR withheld.");
  } else if (nTrials <= 1) {
    dsr = psr;
    expectedMax = 0;
  } else {
    const vAnn = input.srVariance ?? 0.04;
    const vPer = vAnn / periodsPerYear; // annualized variance -> per-period
    const expMaxPerPeriod = expectedMaxSharpe(vPer, nTrials);
    expectedMax = expMaxPerPeriod * Math.sqrt(periodsPerYear);
    // DSR: PSR of observed Sharpe vs expected-max benchmark
    const dsrDen = Math.sqrt(Math.max(term, 1e-9) / Math.max(n - 1, 1));
    dsr = dsrDen > 0 ? normCdf((srPerPeriod - expMaxPerPeriod) / dsrDen) : 0;
    if (dsr < 0.95)
      flags.push(
        `LIKELY_OVERFIT: DSR ${dsr.toFixed(2)} < 0.95 — against ${nTrials} trials this edge is not distinguishable from the best expected by chance.`
      );
  }

  // MinTRL in months (assuming ~21 trading days/month)
  let minTrackRecordMonths: number | null = null;
  if (n >= 2) {
    const srPerP = srPerPeriod;
    if (srPerP > 0) {
      const minTRL = (1 + (1 - skew * srPerP + ((kurt - 1) / 4) * srPerP * srPerP) * 1.96 ** 2) / srPerP ** 2;
      minTrackRecordMonths = minTRL / 21;
      if (minTRL > n) flags.push(`TRACK_RECORD_TOO_SHORT: needs ~${Math.ceil(minTRL)} daily obs for significance; have ${n}.`);
    } else {
      minTrackRecordMonths = null;
    }
  }

  const verdict: AuditReport["verdict"] =
    dsr != null && dsr < 0.5
      ? "LIKELY_OVERFIT"
      : flags.length === 0
        ? "ROBUST"
        : "INCONCLUSIVE";

  return {
    observations: n,
    sharpeAnnualized: sr,
    psr,
    nTrials,
    expectedMaxSharpeAnnualized: expectedMax,
    dsr,
    minTrackRecordMonths,
    flags,
    verdict,
  };
}
