"use client";

import { useCallback, useEffect, useState } from "react";
import WeekendChart from "./WeekendChart";
import Marquee from "./Marquee";
import RollingNumber from "./RollingNumber";
import { Badge, Card, DivergingBar, KV, Micro, Stat, fmtPct, fmtUsdt, fmtX } from "./ui";
import { PRESETS, type BookLine, type DeltaResponse, type DeskResult, type HypothesisView, type ReceiptView } from "@/lib/types";
import { parseProposal } from "@/lib/nl";
import { toNative } from "@/lib/market/symbols";

interface VerifyState {
  pass: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
}

export default function Desk() {
  const [presetId, setPresetId] = useState(PRESETS[0].id);
  const [book, setBook] = useState<BookLine[]>(PRESETS[0].book);
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [symbol, setSymbol] = useState("rNVDA");
  const [qty, setQty] = useState("10");
  const [trials, setTrials] = useState("");
  const [nl, setNl] = useState("");
  const [probeNote, setProbeNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptView | null>(null);
  const [reverify, setReverify] = useState<{ valid: boolean; tamperVerifies: boolean } | null>(null);
  const [result, setResult] = useState<DeskResult | null>(null);
  const [verify, setVerify] = useState<VerifyState | null>(null);
  const [graveyard, setGraveyard] = useState<HypothesisView[]>([]);
  const [compareVerdict, setCompareVerdict] = useState<{ from: string; book: string; recommendation: string } | null>(null);
  const [comparing, setComparing] = useState(false);
  const [explainer, setExplainer] = useState<{ prose: string; source: string; refused?: string } | null>(null);
  const [saved, setSaved] = useState<{ name: string; book: BookLine[] }[]>([]);

  useEffect(() => {
    fetch("/api/verify")
      .then((r) => r.json())
      .then((j) => setVerify({ pass: j.pass, checks: j.checks ?? [] }))
      .catch(() => setVerify(null));
    fetch("/api/graveyard")
      .then((r) => r.json())
      .then((j) => setGraveyard(j.hypotheses ?? []))
      .catch(() => {});
    try {
      const raw = localStorage.getItem("wcp.books");
      if (raw) setSaved(JSON.parse(raw) as { name: string; book: BookLine[] }[]);
    } catch {
      /* private mode — skip */
    }
  }, []);

  const pickPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    setPresetId(id);
    setBook(p.book.map((b) => ({ ...b })));
    setResult(null);
    setReceiptId(null);
    setCompareVerdict(null);
  };

  const analyze = useCallback(
    async (overrideBook?: BookLine[], overrideProposal?: { side: "BUY" | "SELL"; symbol: string; qty: number }) => {
      setLoading(true);
      setError(null);
      try {
        const proposal = overrideProposal ?? { side, symbol: symbol.toUpperCase(), qty: Number(qty) };
        const res = await fetch("/api/delta", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            book: overrideBook ?? book,
            proposal,
            trials: trials === "" ? undefined : Number(trials),
          }),
        });
        const j = (await res.json()) as DeltaResponse;
        if (!j.ok || !j.result) throw new Error(j.error ?? "analysis failed");
        setResult(j.result);
        setReceiptId(j.receiptId ?? null);
        setHash(j.hash ?? null);
        setReceipt(j.receipt ?? null);
        setReverify(null);
        setExplainer(null);
        if (j.receipt) {
          fetch("/api/explain", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ receipt: j.receipt }),
          })
            .then((r) => r.json())
            .then((e) => {
              if (e.ok) setExplainer({ prose: e.prose, source: e.source, refused: e.refused });
            })
            .catch(() => {});
        }
        return j.result;
      } catch (e) {
        setError(e instanceof Error ? e.message : "analysis failed");
        return null;
      } finally {
        setLoading(false);
      }
    },
    [book, side, symbol, qty, trials]
  );

  /**
   * Switch the desk to the other preset book and re-grade the SAME trade.
   * The big verdict must change — a comparison the eye can't see is not a demo.
   */
  const compareOpposite = async () => {
    const current = PRESETS.find((p) => p.id === presetId);
    const other = PRESETS.find((p) => p.id !== presetId) ?? PRESETS[1];
    setComparing(true);
    setCompareVerdict(null);
    try {
      setPresetId(other.id);
      setBook(other.book.map((b) => ({ ...b })));
      const r = await analyze(other.book);
      if (r) setCompareVerdict({ from: current?.name ?? "your book", book: other.name, recommendation: r.recommendation });
    } finally {
      setComparing(false);
    }
  };

  const updateLine = (i: number, patch: Partial<BookLine>) => {
    setBook((b) => b.map((line, k) => (k === i ? { ...line, ...patch } : line)));
    setPresetId("custom");
  };

  const shareText = result
    ? `I asked the Weekend Copilot: ${side} ${qty} ${symbol.toUpperCase()} into the weekend → ${result.recommendation.replace(/_/g, " ")}. Beta ${fmtX(result.delta.betaBefore)}→${fmtX(result.delta.betaAfter)}, weekend P10 ${fmtPct(result.stress.p10)}. #BitgetHackathon @Bitget_AI`
    : "";

  const rec = result?.recommendation ?? "PROCEED_WITH_LIMITS";
  const heroTone = rec === "TRIM_OR_WAIT" ? "amber" : "green";
  const recTitle = rec === "TRIM_OR_WAIT" ? "Trim, or wait." : "Proceed, with limits.";
  const measured = result && result.drift.weekendsMeasured >= 4;

  return (
    <div className="min-h-screen">
      {/* ---------- header ---------- */}
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#08090c]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3 sm:px-8">
          <div className="flex items-center gap-3">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-400 font-mono text-[13px] font-bold text-emerald-950">W</span>
            <div className="leading-tight">
              <p className="text-[12px] font-semibold tracking-[0.22em] text-zinc-100">WEEKEND COPILOT</p>
              <p className="hidden font-mono text-[10px] text-zinc-500 sm:block">Bitget AI Base Camp S2 · AI Trading Desk</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {verify ? (
              <a href="/api/verify" target="_blank" rel="noreferrer" title={verify.checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}`).join("\n")} className="whitespace-nowrap">
                <Badge tone={verify.pass ? "green" : "red"}>
                  <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${verify.pass ? "live-dot bg-emerald-400" : "bg-red-400"}`} />
                  verify {verify.pass ? `${verify.checks.length}/${verify.checks.length}` : "fail"}
                </Badge>
              </a>
            ) : (
              <Badge tone="grey">verify…</Badge>
            )}
          </div>
        </div>
        <Marquee />
      </header>

      <main className="mx-auto max-w-6xl px-5 sm:px-8">
        {/* ---------- hero ---------- */}
        <section className="pt-14 pb-10 sm:pt-20 sm:pb-14">
          <Micro>Bitget AI Base Camp S2 · AI Trading Desk → Open Theme</Micro>
          <h1 className="mt-5 max-w-3xl text-5xl font-semibold leading-[0.98] tracking-[-0.035em] text-zinc-50 sm:text-6xl lg:text-7xl">
            The answer depends on <span className="text-emerald-400">your book.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-zinc-400 sm:text-lg">
            Every AI says “buy NVDA”. Nobody asks what you already hold — or that rTokens print all weekend while New York sleeps.
            Weekend Copilot grades the trade you are about to make against the book you actually have, and hands you a receipt.
          </p>
          <div className="mt-7 flex flex-wrap gap-2">
            {["60-second answer", "measured in-token weekends", "breaker at 2× costs", "read-only · no keys"].map((c) => (
              <span key={c} className="rounded-full border border-white/10 bg-white/[0.02] px-3 py-1 font-mono text-[11px] text-zinc-400">
                {c}
              </span>
            ))}
          </div>
        </section>

        {/* ---------- the desk ---------- */}
        <section id="desk" className="grid gap-3 lg:grid-cols-5 lg:gap-4">
          <Card
            title="1 · Your book"
            sub="Presets always resolve. Unknown tickers are rejected, never guessed."
            className="lg:col-span-2"
          >
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => pickPreset(p.id)}
                  className={`rounded-full border px-3 py-1 text-[11px] transition-colors ${
                    presetId === p.id
                      ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-200"
                      : "border-white/10 text-zinc-400 hover:border-white/25 hover:text-zinc-200"
                  }`}
                >
                  {p.name}
                </button>
              ))}
              {saved.map((s) => (
                <button
                  key={s.name}
                  onClick={() => {
                    setBook(s.book.map((b) => ({ ...b })));
                    setPresetId(s.name);
                    setResult(null);
                  }}
                  title={s.book.map((b) => `${b.qty} ${b.symbol}`).join(" + ")}
                  className={`rounded-full border px-3 py-1 text-[11px] ${
                    presetId === s.name ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-200" : "border-white/10 text-zinc-500 hover:border-white/25"
                  }`}
                >
                  ♥ {s.name}
                </button>
              ))}
            </div>
            <p className="mt-3 text-[12px] text-zinc-500">{PRESETS.find((p) => p.id === presetId)?.blurb ?? "Custom book."}</p>

            <div className="mt-4 space-y-2">
              {book.map((line, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    value={line.symbol}
                    onChange={(e) => updateLine(i, { symbol: e.target.value.toUpperCase() })}
                    className="w-28 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 font-mono text-[13px] text-zinc-100 outline-none focus:border-emerald-400/50"
                    aria-label={`holding ${i + 1} symbol`}
                  />
                  <input
                    value={String(line.qty)}
                    onChange={(e) => updateLine(i, { qty: Number(e.target.value) || 0 })}
                    type="number"
                    min={0}
                    className="tnum w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 font-mono text-[13px] text-zinc-100 outline-none focus:border-emerald-400/50"
                    aria-label={`holding ${i + 1} quantity`}
                  />
                  <button
                    onClick={() => setBook((b) => b.filter((_, k) => k !== i))}
                    className="rounded-lg border border-white/10 px-2.5 text-zinc-600 transition-colors hover:border-red-400/40 hover:text-red-300"
                    aria-label="remove line"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                onClick={() => setBook((b) => [...b, { symbol: "rMSFT", qty: 5 }])}
                className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-zinc-400 transition-colors hover:border-white/25 hover:text-zinc-200"
              >
                + add line
              </button>
              <button
                onClick={() => {
                  const name = `Book ${saved.length + 1} · ${new Date().toISOString().slice(5, 10)}`;
                  const next = [...saved, { name, book: book.map((b) => ({ ...b })) }].slice(-6);
                  setSaved(next);
                  try {
                    localStorage.setItem("wcp.books", JSON.stringify(next));
                  } catch {
                    /* ignore */
                  }
                }}
                className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-zinc-400 transition-colors hover:border-emerald-400/40 hover:text-emerald-200"
              >
                ♥ save book
              </button>
            </div>
          </Card>

          <Card
            title="2 · Propose the trade"
            sub="Type it like you would say it, or use the controls. Policy decides in code — never in a prompt."
            className="lg:col-span-3"
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const r = parseProposal(nl, book);
                if (!r.ok || !r.proposal) {
                  setError(r.hint ?? "could not parse");
                  return;
                }
                setSide(r.proposal.side);
                setSymbol(r.proposal.symbol);
                setQty(String(r.proposal.qty));
                setProbeNote(r.proposal.note ?? null);
                setError(null);
                analyze(undefined, { side: r.proposal.side, symbol: r.proposal.symbol, qty: r.proposal.qty });
              }}
              className="flex gap-2"
            >
              <input
                value={nl}
                onChange={(e) => setNl(e.target.value)}
                placeholder='Ask in plain English — "add 10 rNVDA", "trim half my TSLA", "should I hold over the weekend?"'
                className="w-full rounded-xl border border-emerald-400/25 bg-black/30 px-4 py-3 text-[14px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-emerald-400/60"
                aria-label="propose a trade in plain English"
              />
              <button
                type="submit"
                disabled={loading}
                className="shrink-0 rounded-xl bg-emerald-400 px-5 py-3 text-[13px] font-semibold text-emerald-950 transition-colors hover:bg-emerald-300 disabled:opacity-50"
              >
                {loading ? "Grading…" : "Ask"}
              </button>
            </form>
            {probeNote && <p className="mt-2 text-[12px] text-emerald-200/80">{probeNote}</p>}

            <div className="mt-5 grid gap-4 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-end">
              <div>
                <Micro>Side</Micro>
                <div className="mt-2 flex overflow-hidden rounded-lg border border-white/10">
                  {(["BUY", "SELL"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setSide(s)}
                      className={`px-4 py-1.5 font-mono text-[12px] font-semibold transition-colors ${
                        side === s ? (s === "BUY" ? "bg-emerald-400 text-emerald-950" : "bg-red-400 text-red-950") : "bg-transparent text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Micro>Symbol</Micro>
                <input
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-[13px] text-zinc-100 outline-none focus:border-emerald-400/50"
                />
              </div>
              <div>
                <Micro>Quantity</Micro>
                <input
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  type="number"
                  min={0}
                  className="tnum mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-[13px] text-zinc-100 outline-none focus:border-emerald-400/50"
                />
              </div>
              <div title="How many variants did you compare? Required for an honest Deflated Sharpe — leave blank and DSR is withheld.">
                <Micro>Variants tried</Micro>
                <input
                  value={trials}
                  onChange={(e) => setTrials(e.target.value)}
                  type="number"
                  min={1}
                  placeholder="optional"
                  className="tnum mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-[13px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-emerald-400/50"
                />
              </div>
            </div>

            <button
              onClick={() => analyze()}
              disabled={loading}
              className="mt-5 w-full rounded-xl border border-white/10 bg-white/[0.03] py-3 text-[13px] font-medium text-zinc-200 transition-colors hover:border-emerald-400/40 hover:text-emerald-200 disabled:opacity-50"
            >
              {loading ? "Grading…" : `Grade: ${side} ${qty} ${symbol.toUpperCase()} into the weekend`}
            </button>
            {error && <p className="mt-3 text-[13px] text-red-300">{error}</p>}
            <p className="mt-3 text-[11px] leading-5 text-zinc-600">
              Read-only · no keys · no orders. Costs: 5bp fee/side + 80bp weekend-spread assumption. FCN leg illustrative, not a quote.
            </p>
          </Card>
        </section>

        {/* ---------- verdict + detail ---------- */}
        {result && (
          <section key={receiptId ?? "r"} className="mt-3 space-y-3 sm:mt-4 sm:space-y-4">
            <div
              className={`animate-rise rounded-2xl border p-6 sm:p-8 ${
                heroTone === "amber" ? "border-amber-400/25 bg-gradient-to-b from-amber-400/[0.07] to-transparent" : "border-emerald-400/25 bg-gradient-to-b from-emerald-400/[0.07] to-transparent"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={heroTone}>{rec.replace(/_/g, " ")}</Badge>
                {result.stale && <Badge tone="grey">data stale — refresh pending</Badge>}
                <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                  {auditConfidence(result)} confidence · data {result.dataAsOf?.slice(0, 10) ?? "live"}
                </span>
              </div>

              <h2 className="mt-5 text-4xl font-semibold tracking-[-0.03em] text-zinc-50 sm:text-5xl lg:text-6xl">
                {recTitle}
              </h2>
              <p className="mt-4 max-w-3xl text-[14px] leading-6 text-zinc-400">{result.narrative}</p>

              <div className="mt-7 grid grid-cols-2 gap-y-6 border-y border-white/[0.07] py-6 sm:grid-cols-4 sm:divide-x sm:divide-white/[0.07]">
                <Stat label="Book beta" hint={`${result.delta.betaDelta >= 0 ? "+" : ""}${result.delta.betaDelta.toFixed(3)} from this trade`}>
                  <div className="flex items-baseline gap-2">
                    <RollingNumber value={result.delta.betaBefore} className="text-xl text-zinc-500 sm:text-2xl" />
                    <span className="text-zinc-600">→</span>
                    <RollingNumber value={result.delta.betaAfter} />
                  </div>
                </Stat>
                <Stat label="Concentration HHI" hint={`${result.delta.topSector.sector} ${(result.delta.topSector.weight * 100).toFixed(0)}% of book`}>
                  <RollingNumber value={result.delta.hhiAfter} />
                </Stat>
                <Stat label={measured ? "In-token P10" : "Weekend P10"} hint={`P50 ${fmtPct(measured ? result.drift.p50 : result.stress.p50)} · ${measured ? `${result.drift.weekendsMeasured} weekends` : `${result.stress.weekends} gaps`}`} tone="red">
                  <RollingNumber value={measured ? result.drift.p10 : result.stress.p10} suffix="%" />
                </Stat>
                <Stat label="Fee (promo)" hint="5bp on the proposed leg" tone="default">
                  <RollingNumber value={result.delta.feeUsdt} prefix="$" />
                </Stat>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-2">
                <button
                  onClick={compareOpposite}
                  disabled={comparing}
                  className="rounded-xl border border-white/15 px-4 py-2 text-[12px] text-zinc-200 transition-colors hover:border-emerald-400/50 hover:text-emerald-200"
                >
                  {comparing ? "Comparing…" : "Same trade, different book →"}
                </button>
                <button
                  onClick={() => {
                    if (!receipt) return;
                    fetch("/api/receipt/verify", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ receipt }),
                    })
                      .then((r) => r.json())
                      .then((v) => {
                        if (v.ok) setReverify({ valid: v.valid, tamperVerifies: v.tamperDemo.verifies });
                      })
                      .catch(() => {});
                  }}
                  className="rounded-xl border border-white/15 px-4 py-2 text-[12px] text-zinc-200 transition-colors hover:border-emerald-400/50 hover:text-emerald-200"
                >
                  Re-verify receipt
                </button>
                <a
                  href={`https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-white/15 px-4 py-2 text-[12px] text-zinc-200 transition-colors hover:border-emerald-400/50 hover:text-emerald-200"
                >
                  Share on X
                </a>
              </div>
              {compareVerdict && (
                <p className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px] text-zinc-400">
                  Switched book: <span className="text-zinc-200">{compareVerdict.from}</span> →{" "}
                  <span className="text-zinc-200">{compareVerdict.book}</span> · same trade re-graded →{" "}
                  <span className={`font-semibold ${compareVerdict.recommendation === "TRIM_OR_WAIT" ? "text-amber-300" : "text-emerald-300"}`}>
                    {compareVerdict.recommendation.replace(/_/g, " ")}
                  </span>{" "}
                  · same signal, opposite advice. That is the product.
                </p>
              )}
              {reverify && (
                <p className="mt-2 font-mono text-[11px]">
                  <span className={reverify.valid ? "text-emerald-300" : "text-red-300"}>
                    {reverify.valid ? "✓ hash recomputed — VALID on any instance" : "✗ receipt INVALID"}
                  </span>{" "}
                  <span className="text-zinc-600">· doctored copy verifies: {String(reverify.tamperVerifies)} (must be false)</span>
                </p>
              )}
            </div>

            <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
              <Card
                title="AI transmission — number-locked"
                sub="Qwen narrates; code locks the numbers. Any invented figure refuses the whole response."
                delay={0}
              >
                {explainer ? (
                  <div>
                    <div className="mb-3 flex items-center gap-2">
                      <Badge tone={explainer.source === "llm" ? "green" : "grey"}>
                        {explainer.source === "llm" ? "Qwen narration · number-locked ✓" : "deterministic template · numbers verified"}
                      </Badge>
                    </div>
                    <p className="text-[14px] leading-6 text-zinc-200">{explainer.prose}</p>
                    {explainer.refused && <p className="mt-2 font-mono text-[11px] text-amber-300/80">{explainer.refused}</p>}
                  </div>
                ) : (
                  <p className="text-[12px] text-zinc-500">Narrating the deterministic note…</p>
                )}
              </Card>

              <Card title="Portfolio delta" sub="Weight-blended betas vs SPY · fee on the proposed leg only" delay={40}>
                <dl>
                  <KV k="Notional" v={`$${fmtX(result.delta.notionalBefore, 0)} → $${fmtX(result.delta.notionalAfter, 0)}`} mono />
                  <KV k="Beta" v={`${fmtX(result.delta.betaBefore)} → ${fmtX(result.delta.betaAfter)} (${fmtPct(result.delta.betaDelta)})`} mono />
                  <KV k="Concentration HHI" v={`${fmtX(result.delta.hhiBefore)} → ${fmtX(result.delta.hhiAfter)}`} mono />
                  <KV k="Top sector" v={`${result.delta.topSector.sector} ${(result.delta.topSector.weight * 100).toFixed(0)}%`} />
                  <KV
                    k="Max pair correlation"
                    v={result.delta.maxCorrelation.value > 0 ? `${result.delta.maxCorrelation.pair.join("×")} ${result.delta.maxCorrelation.value.toFixed(2)}` : "single name"}
                    mono
                  />
                  <KV k="Fee (5bp promo)" v={`$${result.delta.feeUsdt.toFixed(2)}`} mono />
                </dl>
              </Card>

              <Card
                title="Weekend read — measured, not guessed"
                sub={`${result.drift.rSymbol || "rToken"} prints + ${result.stress.weekends} native-proxy Fri→Mon events`}
                delay={80}
              >
                {measured ? (
                  <div className="space-y-3">
                    <DivergingBar value={result.drift.p10} max={5} format={(v) => `P10 ${fmtPct(v)}`} />
                    <DivergingBar value={result.drift.p50} max={5} format={(v) => `P50 ${fmtPct(v)}`} />
                    <DivergingBar value={result.drift.p90} max={5} format={(v) => `P90 ${fmtPct(v)}`} />
                    <p className="text-[11px] leading-5 text-zinc-500">
                      {result.drift.weekendsMeasured} in-token weekends ({result.drift.confidence} confidence) · P(down) {(result.drift.probDown * 100).toFixed(0)}% ·
                      max |drift| {fmtPct(result.drift.maxAbs, 1)}
                    </p>
                  </div>
                ) : (
                  <p className="text-[12px] text-zinc-500">Too few in-token weekends — read leans on native-proxy gaps below.</p>
                )}
                <dl className="mt-3">
                  <KV k="Native-proxy P10 / P50" v={`${fmtPct(result.stress.p10)} / ${fmtPct(result.stress.p50)}`} mono />
                  <KV k="Gap-down frequency" v={`${(result.stress.probDown * 100).toFixed(0)}% · big moves ${((result.stress.probBigMove ?? 0) * 100).toFixed(0)}%`} mono />
                  {result.stress.proxyShare > 0 && <KV k="Close→close proxies" v={`${(result.stress.proxyShare * 100).toFixed(0)}% of events`} mono />}
                </dl>
                {result.drift.prints.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-[11px] text-emerald-300 hover:text-emerald-200">Recent in-token weekends ({result.drift.prints.length})</summary>
                    <table className="mt-2 w-full font-mono text-[11px]">
                      <thead>
                        <tr className="text-left text-zinc-600">
                          <th className="py-1">Fri → Sun</th>
                          <th className="text-right">Drift</th>
                          <th className="text-right">Range</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.drift.prints.slice(0, 8).map((p) => (
                          <tr key={p.friday} className="border-t border-white/[0.04] text-zinc-300">
                            <td className="py-1">{p.friday.slice(5)} → {p.sunday.slice(5)}</td>
                            <td className={`tnum text-right ${p.driftPct < 0 ? "text-red-300" : "text-emerald-300"}`}>{fmtPct(p.driftPct)}</td>
                            <td className="tnum text-right text-zinc-500">{fmtPct(p.weekendRangePct, 1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
              </Card>

              <Card title="24/7 overlay — see the weekend" sub="Native vs real rToken prints. Green bands are Sat/Sun — the hours only token holders live through." delay={120}>
                <WeekendChart ticker={toNative(symbol)} />
              </Card>

              <Card
                title="What printed while New York slept"
                sub={`Keyless RSS${result.newsAsOf ? ` · as of ${result.newsAsOf.slice(0, 16).replace("T", " ")} UTC` : ""}${result.newsStale ? " · stale" : ""} · deterministic channel tags`}
                delay={160}
              >
                {result.headlines.length ? (
                  <ul className="space-y-2">
                    {result.headlines.map((h, i) => (
                      <li key={i} className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {h.weekendWindow && <Badge tone="amber">weekend</Badge>}
                          {h.channels.map((c) => (
                            <Badge key={c} tone="grey">{c}</Badge>
                          ))}
                          <span className="ml-auto font-mono text-[10px] text-zinc-600">
                            {h.source}{h.pubDate ? ` · ${h.pubDate.slice(5, 16).replace("T", " ")}` : ""}
                          </span>
                        </div>
                        {h.link ? (
                          <a href={h.link} target="_blank" rel="noreferrer" className="mt-1.5 block text-[13px] leading-5 text-zinc-200 transition-colors hover:text-emerald-200">
                            {h.title}
                          </a>
                        ) : (
                          <p className="mt-1.5 text-[13px] leading-5 text-zinc-200">{h.title}</p>
                        )}
                        {h.tickers.length > 0 && <p className="mt-1 font-mono text-[10px] text-zinc-600">mentions: {h.tickers.join(", ")}</p>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12px] text-zinc-500">No fresh headlines in cache — snapshot refreshes separately from prices. Numbers never depend on headlines.</p>
                )}
              </Card>

              <Card
                title="Breaker — kill switch in code"
                sub="Double costs against the worst historical weekends. A prompt suggestion would argue; code does not."
                accent={result.breaker.verdict === "FLAG" ? "amber" : "green"}
                delay={200}
              >
                <div className="flex items-center gap-3">
                  <Badge tone={result.breaker.verdict === "FLAG" ? "amber" : "green"}>{result.breaker.verdict}</Badge>
                  <span className="tnum font-mono text-[11px] text-zinc-500">
                    2× drag ${result.breaker.drag2xUsdt.toFixed(2)} · worst-regime avg {fmtPct(result.breaker.worst10AvgGapPct)}
                  </span>
                </div>
                <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[12px] leading-5 text-zinc-400">
                  {result.breaker.reasons.length ? result.breaker.reasons.map((r, i) => <li key={i}>{r}</li>) : <li>No objections — breaker passes at double costs.</li>}
                </ul>
              </Card>

              <Card title="Three ways to express it" sub="Same weekend distribution, three cost shapes. Sorted by left-tail, not hype." delay={240}>
                <div className="space-y-2">
                  {[...result.hedges]
                    .sort((a, b) => b.netP10Usdt - a.netP10Usdt)
                    .map((h, i) => (
                      <div key={h.id} className={`rounded-xl border p-3.5 ${i === 0 ? "border-emerald-400/30 bg-emerald-400/[0.04]" : "border-white/[0.07]"}`}>
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-[13px] font-medium text-zinc-100">
                            {i === 0 ? "★ " : ""}
                            {h.name}
                          </p>
                          <p className={`tnum font-mono text-[13px] ${h.netP10Usdt < 0 ? "text-red-300" : "text-emerald-300"}`}>
                            {fmtUsdt(h.netP10Usdt)} <span className="text-zinc-600">P10 net</span>
                          </p>
                        </div>
                        <p className="mt-1 text-[12px] text-zinc-500">{h.description}</p>
                        <p className="tnum mt-1 font-mono text-[11px] text-zinc-500">
                          P50 {fmtUsdt(h.weekendP50Usdt)} · cost {fmtUsdt(-h.costUsdt).replace("+", "")}
                          {h.couponUsdt ? ` · coupon +$${h.couponUsdt.toFixed(2)}` : ""}
                        </p>
                        <details>
                          <summary className="cursor-pointer text-[11px] text-zinc-600 hover:text-zinc-400">assumptions</summary>
                          <ul className="mt-1 list-disc pl-5 text-[11px] text-zinc-600">
                            {h.assumptions.map((a, k) => (
                              <li key={k}>{a}</li>
                            ))}
                          </ul>
                        </details>
                      </div>
                    ))}
                </div>
              </Card>

              <Card title="Honesty audit" sub={result.audit.subject || "Bailey & López de Prado PSR/DSR/MinTRL. Selection bias priced in."} delay={280}>
                <dl>
                  <KV k="Sleeve Sharpe (1y, ann.)" v={fmtX(result.audit.sharpeAnnualized)} mono />
                  <KV k="PSR vs 0" v={`${fmtX(result.audit.psr)} ${result.audit.psr >= 0.95 ? "✓" : "✗"}`} mono />
                  <KV k="Trials declared" v={result.audit.nTrials == null ? "not declared — DSR withheld" : String(result.audit.nTrials)} mono />
                  {result.audit.dsr != null && <KV k="Deflated Sharpe" v={`${fmtX(result.audit.dsr)} ${result.audit.dsr >= 0.95 ? "✓" : "✗"}`} mono />}
                  {result.audit.expectedMaxSharpeAnnualized != null && <KV k="Noise benchmark (max Sharpe)" v={fmtX(result.audit.expectedMaxSharpeAnnualized)} mono />}
                  <KV k="Verdict" v={result.audit.verdict} />
                </dl>
                {result.audit.flags.length > 0 && (
                  <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[11px] leading-5 text-amber-200/80">
                    {result.audit.flags.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card title="Critic — the machine’s one lesson" sub="One rule, one hypothesis, regime-tagged. Filed as UNTESTED until Monday." delay={320}>
                <p className="text-[14px] font-medium leading-6 text-zinc-100">“{result.rule.rule}”</p>
                <p className="mt-2 text-[12px] leading-5 text-zinc-500">Hypothesis: {result.rule.hypothesis}</p>
                <p className="mt-1 font-mono text-[11px] text-zinc-600">
                  regime: {result.rule.regime} · triggered by: {result.rule.triggeredBy.join(", ")}
                </p>
              </Card>

              <div className="lg:col-span-2">
                <Card title="Preregistered receipt" sub="Written before the outcome. Compare Monday — no moved goalposts." delay={360}>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[11px]">
                    <span className="text-zinc-400">{receiptId}</span>
                    <span className="text-zinc-600">hash {hash?.slice(0, 12)}…</span>
                  </div>
                  <p className="mt-3 text-[12px] leading-5 text-zinc-500">
                    Receipts are self-contained: integrity recomputes from their own fields on any server instance — no login, no session, no trust-me screenshots.
                  </p>
                </Card>
              </div>
            </div>
          </section>
        )}

        {/* ---------- memory + method ---------- */}
        <section className="mt-10 grid gap-3 sm:mt-14 sm:gap-4 lg:grid-cols-2">
          <Card title="Hypothesis graveyard" sub="Negative results are the most undervalued asset in quant research. Ours compound.">
            <ul className="space-y-2.5">
              {graveyard.map((h) => (
                <li key={h.id} className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-3.5">
                  <div className="flex items-center gap-2">
                    <Badge tone={h.status === "REJECTED" ? "red" : h.status === "CONFIRMED" ? "green" : "grey"}>{h.status}</Badge>
                    <span className="font-mono text-[10px] text-zinc-600">{h.regime}</span>
                  </div>
                  <p className="mt-2 text-[13px] text-zinc-200">{h.title}</p>
                  <p className="mt-1 text-[11px] leading-5 text-zinc-500">{h.evidence}</p>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Method & limits" sub="What we claim, what we do not.">
            <ul className="list-disc space-y-2 pl-5 text-[12px] leading-5 text-zinc-400">
              <li>Native history: Yahoo 2y daily (keyless). In-token weekends: Bitget public daily prints (keyless). No login, no keys, no orders — read-only by design.</li>
              <li>Weekend spreads assumed 80bp / overnight 45bp / regular 8bp one-way; fee 5bp/side (promo). Post-Sept fee schedule TBA — flagged, not hidden.</li>
              <li>Close→close proxies labeled per event; in-token drift shown only when ≥4 weekends measured, with confidence.</li>
              <li>Beta/correlation need ≥20 return obs or fall back to 1.0/0 — never silently precise.</li>
              <li>DSR withheld unless you declare variants tried. A passing audit is evidence of non-obvious-overfit, not future returns.</li>
              <li>Qwen writes prose around deterministic cards (number-locked); it never emits a number first. Kill switch lives in code.</li>
            </ul>
          </Card>
        </section>

        <footer className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/[0.06] py-8 font-mono text-[11px] text-zinc-600 sm:mt-14">
          <span>Weekend Copilot</span>
          <span className="text-zinc-800">/</span>
          <span>Bitget AI Base Camp S2 · AI Trading Desk (Open)</span>
          <span className="text-zinc-800">/</span>
          <span>data: Bitget public + Yahoo</span>
          <span className="text-zinc-800">/</span>
          <a href="/api/verify" className="transition-colors hover:text-emerald-300">verify</a>
          <a href="/api/graveyard" className="transition-colors hover:text-emerald-300">graveyard</a>
          <span className="ml-auto">educational · not financial advice</span>
        </footer>
      </main>
    </div>
  );
}

function auditConfidence(r: DeskResult): string {
  if (r.drift.weekendsMeasured >= 8) return "high";
  if (r.drift.weekendsMeasured >= 4 || r.stress.weekends >= 50) return "medium";
  return "low";
}
