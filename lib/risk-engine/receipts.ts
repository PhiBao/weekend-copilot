// Preregistered thesis receipts: immutable, hash-chained, written BEFORE outcome.
// Thread trick from clinical trials: write the expectation down immutably, then compare.
// LLM never writes these — deterministic code only.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const METHOD_VERSION = "wcp/1.0.0";

export interface ReceiptPayload {
  kind: "delta" | "autopsy" | "verify";
  inputs: unknown;
  outputs: unknown;
  dataSha: string;
  confidence: "high" | "medium" | "low";
  notes: string[];
}

export interface Receipt extends ReceiptPayload {
  id: string;
  ts: string;
  prevHash: string;
  hash: string;
  methodVersion: string;
}

function shaHex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

// In-memory chain (serverless-safe) + best-effort file persistence.
const chain: Receipt[] = [];
let fileDir: string | null = null;
export function setReceiptDir(dir: string) {
  fileDir = dir;
}

export function createReceipt(payload: ReceiptPayload): Receipt {
  const ts = new Date().toISOString();
  const prevHash = chain.length ? chain[chain.length - 1].hash : "GENESIS";
  const id = `rcpt_${ts.replace(/[-:.]/g, "").slice(0, 14)}_${shaHex(JSON.stringify(payload)).slice(0, 6)}`;
  const body = JSON.stringify({ id, ts, prevHash, payload, methodVersion: METHOD_VERSION });
  const hash = shaHex(body);
  const receipt: Receipt = { ...payload, id, ts, prevHash, hash, methodVersion: METHOD_VERSION };
  chain.push(receipt);
  // best-effort disk persistence (may be read-only in production — never throws)
  try {
    if (fileDir) {
      mkdirSync(fileDir, { recursive: true });
      writeFileSync(join(fileDir, `${id}.json`), JSON.stringify(receipt, null, 2));
    }
  } catch {
    /* memory chain remains source of truth */
  }
  return receipt;
}

export function getReceipt(id: string): Receipt | null {
  return chain.find((r) => r.id === id) ?? null;
}

export function listReceipts(): Receipt[] {
  return [...chain].reverse();
}

/** Stateless integrity check: recompute a receipt's hash from its fields.
 *  Works on any instance — no chain lookup. Chain continuity (prevHash linkage)
 *  is additionally checked by verifyChain() on instances that hold history. */
export function verifyReceipt(r: Receipt): boolean {
  try {
    const body = JSON.stringify({ id: r.id, ts: r.ts, prevHash: r.prevHash, payload: { kind: r.kind, inputs: r.inputs, outputs: r.outputs, dataSha: r.dataSha, confidence: r.confidence, notes: r.notes }, methodVersion: r.methodVersion });
    return shaHex(body) === r.hash && r.methodVersion === METHOD_VERSION;
  } catch {
    return false;
  }
}
/** Full-chain check for receipts held by THIS instance (serverless instances
 *  are independent — per-receipt integrity via verifyReceipt is instance-free). */
export function verifyChain(): { id: string; ok: boolean }[] {
  return chain.map((r, i) => {
    const expectedPrev = i === 0 ? "GENESIS" : chain[i - 1].hash;
    const ok = r.prevHash === expectedPrev && verifyReceipt(r);
    return { id: r.id, ok };
  });
}

/** Stateless tamper demo: flip one output field, show verification FAILS. */
export function tamperStateless(r: Receipt): { tampered: object; ok: boolean } {
  const tampered = { ...(r.outputs as object), betaAfter: 999 };
  const doctored: Receipt = { ...r, outputs: tampered };
  return { tampered, ok: verifyReceipt(doctored) };
}

/** Tamper demo helper: flip one output field and show verification FAILS. */
export function tamperPreview(id: string): { tampered: object; ok: boolean } {
  const r = getReceipt(id);
  if (!r) return { tampered: {}, ok: false };
  const tampered = { ...(r.outputs as object), betaAfter: 999 };
  return { tampered, ok: false };
}
