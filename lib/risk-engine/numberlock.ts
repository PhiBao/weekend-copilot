// Number-lock validator (pure, no I/O): every decimal number in LLM prose
// must match a locked engine fact. Small integers (counts/dates) are exempt.
// If the lock fails, the whole LLM response is refused and the deterministic
// template is served instead.
export function collectNumbers(v: unknown, out: number[]): void {
  if (typeof v === "number" && Number.isFinite(v)) {
    out.push(v);
    return;
  }
  if (Array.isArray(v)) {
    for (const x of v) collectNumbers(x, out);
    return;
  }
  if (v && typeof v === "object") {
    for (const x of Object.values(v)) collectNumbers(x, out);
  }
}

export function numbersLocked(prose: string, facts: number[]): { ok: boolean; offenders: string[] } {
  const offenders: string[] = [];
  const found = prose.match(/-?\d+(\.\d+)?%?/g) ?? [];
  for (const token of found) {
    const isPct = token.endsWith("%");
    const n = Number(isPct ? token.slice(0, -1) : token);
    if (!Number.isFinite(n)) continue;
    // Small integers carry no magnitude claim (counts, dates, years).
    if (Number.isInteger(n) && Math.abs(n) <= 2100) continue;
    const match = facts.some((f) => Math.abs(f - n) <= Math.max(0.005, Math.abs(f) * 1e-4));
    if (!match) offenders.push(token);
  }
  return { ok: offenders.length === 0, offenders };
}
