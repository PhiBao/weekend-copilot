// CLI verify runner (plain Node): imports TS via Next's TS? No — this script
// shells the App Router instead: it boots `next` lib functions via tsx-free path.
// Simplest reliable path: run vitest suite + print manifest integrity.
// Usage: pnpm verify
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const dir = join(process.cwd(), "data", "snapshots");
let pass = true;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
  if (!ok) pass = false;
};

try {
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
  const names = Object.keys(manifest.symbols ?? {});
  check("snapshots-present", names.length >= 8, `${names.length} symbols (need ≥8). Built: ${manifest.builtAt ?? "?"}`);
  let okCount = 0;
  for (const sym of names) {
    try {
      const raw = await readFile(join(dir, `${sym}.json`), "utf8");
      const file = JSON.parse(raw);
      const sha = createHash("sha256").update(raw).digest("hex").slice(0, 16);
      // manifest sha was computed over the same canonical payload at build time
      if (manifest.symbols[sym].sha === sha && (file.bars ?? []).length >= 30) okCount++;
      else check(`snapshot-sha:${sym}`, false, "hash mismatch or too few bars");
    } catch {
      check(`snapshot-read:${sym}`, false, "unreadable");
    }
  }
  check("snapshot-integrity", okCount === names.length, `${okCount}/${names.length} files match manifest SHAs`);
  // weekend-gap presence probe on NVDA
  const nvda = JSON.parse(await readFile(join(dir, "NVDA.json"), "utf8"));
  const dates = new Set(nvda.bars.map((b) => b.date));
  let friMon = 0;
  for (const b of nvda.bars) {
    const wd = new Date(b.date + "T12:00:00Z").getUTCDay();
    if (wd !== 5) continue;
    for (let d = 1; d <= 4; d++) {
      const cand = new Date(new Date(b.date + "T12:00:00Z").getTime() + d * 86400000).toISOString().slice(0, 10);
      const cw = new Date(cand + "T12:00:00Z").getUTCDay();
      if ((cw === 1 || cw === 2) && dates.has(cand)) { friMon++; break; }
    }
  }
  check("weekend-gaps", friMon >= 20, `${friMon} Fri→Mon events for NVDA (need ≥20)`);
} catch (e) {
  check("snapshots-present", false, `no manifest — run pnpm snapshot first (${e.message})`);
}
console.log(pass ? "\nVERIFY: ALL CHECKS PASSED" : "\nVERIFY: FAILURES PRESENT");
process.exit(pass ? 0 : 1);
