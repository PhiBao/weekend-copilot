// Paper log generator: grades canonical scenarios against a base URL and
// appends timestamped rows (with receipt hashes) to data/paper_log.csv.
// Usage: BASE_URL=http://localhost:3210 node scripts/paperlog.mjs
// The committed CSV is the verifiable usage record; every row links a receipt.
import { appendFile, mkdir, writeFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE_URL ?? "http://localhost:3210";
const OUT = join(root, "data", "paper_log.csv");

const SCENARIOS = [
  {
    name: "concentrated-add",
    book: [{ symbol: "rNVDA", qty: 40 }, { symbol: "rAAPL", qty: 10 }, { symbol: "rTSLA", qty: 5 }],
    proposal: { side: "BUY", symbol: "rNVDA", qty: 10 },
    trials: 12,
  },
  {
    name: "balanced-add",
    book: [{ symbol: "rQQQ", qty: 10 }, { symbol: "rMSFT", qty: 12 }, { symbol: "rAMZN", qty: 20 }],
    proposal: { side: "BUY", symbol: "rNVDA", qty: 10 },
    trials: 12,
  },
  {
    name: "barbell-trim",
    book: [{ symbol: "rTSLA", qty: 20 }, { symbol: "BTC", qty: 0.1 }],
    proposal: { side: "SELL", symbol: "rTSLA", qty: 10 },
    trials: 3,
  },
  {
    name: "qqq-hedge-question",
    book: [{ symbol: "rQQQ", qty: 10 }, { symbol: "rMSFT", qty: 12 }, { symbol: "rAMZN", qty: 20 }],
    proposal: { side: "BUY", symbol: "rTSLA", qty: 15 },
    trials: 5,
  },
];

await mkdir(join(root, "data"), { recursive: true });
try {
  await access(OUT);
} catch {
  await writeFile(
    OUT,
    "ts,scenario,side,symbol,qty,notional_before,notional_after,beta_before,beta_after,hhi_after,recommendation,breaker,stress_p10,stress_p50,drift_n,drift_p50,receipt_id,receipt_hash\n"
  );
}

for (const s of SCENARIOS) {
  const res = await fetch(`${BASE}/api/delta`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ book: s.book, proposal: s.proposal, trials: s.trials }),
  });
  const j = await res.json();
  if (!j.ok) {
    console.log(`FAIL ${s.name}: ${j.error}`);
    continue;
  }
  const r = j.result;
  const row = [
    new Date().toISOString(), s.name, s.proposal.side, s.proposal.symbol, s.proposal.qty,
    r.delta.notionalBefore.toFixed(2), r.delta.notionalAfter.toFixed(2),
    r.delta.betaBefore.toFixed(4), r.delta.betaAfter.toFixed(4), r.delta.hhiAfter.toFixed(4),
    r.recommendation, r.breaker.verdict, r.stress.p10.toFixed(3), r.stress.p50.toFixed(3),
    r.drift.weekendsMeasured, r.drift.p50.toFixed(3), j.receiptId, j.hash,
  ].join(",");
  await appendFile(OUT, row + "\n");
  console.log(`ok ${s.name}: ${r.recommendation} (${j.receiptId})`);
}
console.log(`wrote ${OUT}`);
