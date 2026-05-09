import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Logo } from "@/components/Logo";
import { Dropzone } from "@/components/Dropzone";
import { Dashboard } from "@/components/Dashboard";
import { renderPdfPages, type RenderedPage } from "@/lib/pdf";
import {
  computeDocumentScore,
  computePageScore,
  computeQE,
  type PageAnalysis,
} from "@/lib/attention";
import { summarizeDocument } from "@/lib/ai.functions";
import { useServerFn } from "@tanstack/react-start";
import { BrainCircuit, Eye, Layers, Loader2, ScanText, Sparkles, Zap } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
});

type Stage = "idle" | "rendering" | "ocr" | "analyzing" | "done" | "error";
type SummaryStatus = "queued" | "ready" | "unavailable";

async function digestText(input: string) {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function Index() {
  const summarizeFn = useServerFn(summarizeDocument);
  const runIdRef = useRef(0);
  const summaryCacheRef = useRef(new Map<string, string>());

  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState({ current: 0, total: 0, label: "" });
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    fileName: string;
    pages: PageAnalysis[];
    rendered: RenderedPage[];
    documentScore: number;
    qe: ReturnType<typeof computeQE>;
    processingMs: number;
    summary: string | null;
    summaryStatus: SummaryStatus;
    summaryError?: string;
    documentId: string;
  } | null>(null);

  const handleFile = async (file: File) => {
    const runId = ++runIdRef.current;
    setError(null);
    setResult(null);
    const t0 = performance.now();
    try {
      setStage("rendering");
      setProgress({ current: 0, total: 0, label: "Rendering pages" });
      const { pages: rendered } = await renderPdfPages(file, (c, t) =>
        setProgress({ current: c, total: t, label: "Rendering pages" }),
      );

      setStage("ocr");
      const modPath = "@/lib/paddleOcr.client";
      const { runPaddleOcr } = (await import(/* @vite-ignore */ modPath)) as typeof import("@/lib/paddleOcr.client");
      const analyses: PageAnalysis[] = [];
      for (let i = 0; i < rendered.length; i++) {
        setProgress({ current: i + 1, total: rendered.length, label: "Extracting text with local PaddleOCR" });
        const ocr = await runPaddleOcr(rendered[i], { throttleMs: 120 });
        analyses.push(computePageScore(rendered[i], ocr));
      }

      setStage("analyzing");
      const { documentScore } = computeDocumentScore(analyses);
      const qe = computeQE(analyses);

      const fullText = analyses.map((a) => `[Page ${a.pageNumber}]\n${a.text}`).join("\n\n");
      const documentId = await digestText(`${file.name}:${file.size}:${file.lastModified}:${fullText}`);
      const cachedSummary = summaryCacheRef.current.get(documentId) ?? null;
      if (runId !== runIdRef.current) return;

      setResult({
        fileName: file.name,
        pages: analyses,
        rendered,
        documentScore,
        qe,
        processingMs: performance.now() - t0,
        summary: cachedSummary,
        summaryStatus: cachedSummary ? "ready" : "queued",
        documentId,
      });
      setStage("done");

      if (!cachedSummary && fullText.trim()) {
        summarizeFn({ data: { documentId, fileName: file.name, pageCount: analyses.length, fullText } })
          .then((r) => {
            if (runId !== runIdRef.current) return;
            if (r.summary) summaryCacheRef.current.set(documentId, r.summary);
            setResult((prev) =>
              prev?.documentId === documentId
                ? {
                    ...prev,
                    summary: r.summary ?? null,
                    summaryStatus: r.unavailable ? "unavailable" : "ready",
                    summaryError: r.error,
                  }
                : prev,
            );
          })
          .catch((e) => {
            if (runId !== runIdRef.current) return;
            setResult((prev) =>
              prev?.documentId === documentId
                ? { ...prev, summary: null, summaryStatus: "unavailable", summaryError: (e as Error).message }
                : prev,
            );
          });
      }
    } catch (e) {
      console.error(e);
      setError((e as Error).message ?? "Processing failed");
      setStage("error");
    }
  };

  const reset = () => {
    runIdRef.current += 1;
    setStage("idle");
    setResult(null);
    setError(null);
    setProgress({ current: 0, total: 0, label: "" });
  };

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-10">
      <header className="mx-auto flex max-w-7xl items-center justify-between">
        <Logo />
        <div className="hidden items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur sm:flex">
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
          Hierarchical Attention OCR · AI Document Intelligence
        </div>
      </header>

      <div className="mx-auto mt-10 max-w-7xl">
        {stage === "idle" && (
          <div className="space-y-12">
            <section className="text-center">
              <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                <Sparkles className="h-3 w-3" /> AI-Powered Document Intelligence
              </div>
              <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                Hierarchical attention OCR for{" "}
                <span className="bg-[var(--gradient-primary)] bg-clip-text text-transparent">
                  large PDF documents
                </span>
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground sm:text-lg">
                CABER BYTE prioritizes pages and regions through document, page, and region
                attention before extracting text — then evaluates quality and surfaces
                AI-powered insights.
              </p>
            </section>

            <section className="mx-auto max-w-3xl">
              <Dropzone onFile={handleFile} />
            </section>

            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { icon: Layers, t: "Document Attention", d: "Density × Complexity × Quality" },
                { icon: Eye, t: "Page Attention", d: "TD · LI · IQ weighted scoring" },
                { icon: ScanText, t: "Local PaddleOCR", d: "Page-by-page OCR extraction" },
                { icon: BrainCircuit, t: "AI Insights", d: "Summary + key entities" },
              ].map((f) => (
                <div
                  key={f.t}
                  className="rounded-xl border border-border bg-[var(--gradient-card)] p-5 backdrop-blur"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <f.icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-3 text-sm font-semibold text-foreground">{f.t}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{f.d}</p>
                </div>
              ))}
            </section>
          </div>
        )}

        {(stage === "rendering" || stage === "ocr" || stage === "analyzing") && (
          <ProcessingView stage={stage} progress={progress} />
        )}

        {stage === "error" && (
          <div className="mx-auto max-w-xl rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-center">
            <p className="font-semibold text-destructive">Processing failed</p>
            <p className="mt-2 text-sm text-foreground/80">{error}</p>
            <button
              onClick={reset}
              className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              Try again
            </button>
          </div>
        )}

        {stage === "done" && result && (
          <Dashboard
            pages={result.pages}
            rendered={result.rendered}
            documentScore={result.documentScore}
            qe={result.qe}
            processingMs={result.processingMs}
            summary={result.summary}
            summaryStatus={result.summaryStatus}
            summaryError={result.summaryError}
            fileName={result.fileName}
            onReset={reset}
          />
        )}
      </div>

      <footer className="mx-auto mt-16 max-w-7xl border-t border-border pt-6 text-center text-xs text-muted-foreground">
        CABER BYTE · Hierarchical Attention OCR System
      </footer>
    </main>
  );
}

function ProcessingView({
  stage,
  progress,
}: {
  stage: Stage;
  progress: { current: number; total: number; label: string };
}) {
  const steps = [
    { id: "rendering", label: "Streaming pages", icon: Layers },
    { id: "ocr", label: "Local PaddleOCR", icon: ScanText },
    { id: "analyzing", label: "Attention scoring", icon: Zap },
  ];
  const activeIdx = steps.findIndex((s) => s.id === stage);
  const pct = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-2xl border border-border bg-[var(--gradient-card)] p-8 backdrop-blur">
        <div className="flex items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <div>
            <div className="text-sm font-semibold text-foreground">{progress.label || "Processing"}</div>
            {progress.total > 0 && (
              <div className="text-xs text-muted-foreground">
                {progress.current} / {progress.total}
              </div>
            )}
          </div>
        </div>
        <div className="mt-5 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-[var(--gradient-primary)] transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-8 grid grid-cols-3 gap-3">
          {steps.map((s, i) => {
            const done = i < activeIdx;
            const active = i === activeIdx;
            return (
              <div key={s.id} className="text-center">
                <div
                  className={`mx-auto flex h-10 w-10 items-center justify-center rounded-lg border transition ${
                    active
                      ? "border-primary bg-primary/20 text-primary shadow-[var(--shadow-glow)]"
                      : done
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border bg-muted text-muted-foreground"
                  }`}
                >
                  <s.icon className="h-4 w-4" />
                </div>
                <div className="mt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {s.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

