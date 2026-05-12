import { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import type { PageAnalysis } from "@/lib/attention";
import type { RenderedPage } from "@/lib/pdf";

interface Props {
  pages: PageAnalysis[];
  rendered: RenderedPage[];
}

function qualityTier(score: number): {
  label: string;
  cls: string;
  dot: string;
  Icon: typeof CheckCircle2;
} {
  if (score >= 0.75)
    return {
      label: "High",
      cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
      dot: "bg-emerald-400",
      Icon: CheckCircle2,
    };
  if (score >= 0.5)
    return {
      label: "Medium",
      cls: "border-amber-500/40 bg-amber-500/10 text-amber-400",
      dot: "bg-amber-400",
      Icon: AlertTriangle,
    };
  return {
    label: "Low",
    cls: "border-red-500/40 bg-red-500/10 text-red-400",
    dot: "bg-red-400",
    Icon: XCircle,
  };
}

function pageQE(p: PageAnalysis) {
  // Heuristic CER/WER from OCR confidence (no ground truth available)
  const cer = Math.max(0, Math.min(1, 1 - p.confidence - 0.02));
  const wer = Math.max(0, Math.min(1, 1 - p.confidence + 0.05));
  // QE = α*conf + β*(1-CER) + γ*(1-WER)
  const qe = 0.5 * p.confidence + 0.25 * (1 - cer) + 0.25 * (1 - wer);
  return { cer, wer, qe };
}

// Build pseudo-regions (paragraph blocks) from extracted text so that the
// center panel can highlight reading-order chunks. Coordinates are derived
// from paragraph index against the page height — this is a structural
// visualization, not a true bounding-box detector.
function buildRegions(p: PageAnalysis, page?: RenderedPage) {
  // Prefer REAL OCR regions from the engine when available (line-level
  // bboxes + per-region confidence). Falls back to a paragraph-derived
  // structural visualization for pages with no engine regions.
  if (p.ocrRegions && p.ocrRegions.length && page) {
    return p.ocrRegions.map((r, i) => {
      const isHeading = r.text.length < 80 && !/\n/.test(r.text);
      return {
        id: i,
        type: isHeading ? "heading" : "paragraph",
        text: r.text,
        confidence: r.confidence,
        score: p.pageScore * (0.6 + 0.4 * Math.min(1, r.text.length / 200)),
        box: r.box,
      };
    });
  }
  const paragraphs = (p.text || "")
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!paragraphs.length || !page) return [];
  const total = paragraphs.length;
  const padX = 0.06;
  const padY = 0.04;
  const usableH = 1 - padY * 2;
  const slot = usableH / total;
  return paragraphs.map((text, i) => {
    const lines = text.split("\n").length;
    const h = Math.min(slot * 0.92, slot - 0.005);
    const top = padY + slot * i;
    const isHeading = text.length < 80 && lines === 1;
    const conf = Math.max(
      0.4,
      Math.min(0.99, p.confidence + (isHeading ? -0.03 : 0) + (text.length > 200 ? 0.02 : 0)),
    );
    return {
      id: i,
      type: isHeading ? "heading" : "paragraph",
      text,
      confidence: conf,
      score: p.pageScore * (0.7 + 0.3 * (text.length / Math.max(50, p.text.length))),
      box: { left: padX, top, width: 1 - padX * 2, height: h },
    };
  });
}

export function OcrInspector({ pages, rendered }: Props) {
  const sorted = useMemo(() => [...pages].sort((a, b) => a.pageNumber - b.pageNumber), [pages]);
  const [activePage, setActivePage] = useState<number>(sorted[0]?.pageNumber ?? 1);
  const [activeRegion, setActiveRegion] = useState<number | null>(null);

  const page = sorted.find((p) => p.pageNumber === activePage) ?? sorted[0];
  const img = rendered.find((r) => r.pageNumber === page.pageNumber);
  const qe = pageQE(page);
  const tier = qualityTier(qe.qe);
  const regions = useMemo(() => buildRegions(page, img), [page, img]);
  const region = activeRegion != null ? regions[activeRegion] : null;

  const idx = sorted.findIndex((p) => p.pageNumber === page.pageNumber);
  const goto = (delta: number) => {
    const next = sorted[Math.max(0, Math.min(sorted.length - 1, idx + delta))];
    if (next) {
      setActivePage(next.pageNumber);
      setActiveRegion(null);
    }
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(page.text || "");
    } catch {
      // ignore
    }
  };

  const downloadPage = () => {
    const blob = new Blob([page.text || ""], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `page-${page.pageNumber}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="rounded-xl border border-border bg-[var(--gradient-card)] p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-foreground">OCR Results & Quality Analysis</h3>
          <p className="text-xs text-muted-foreground">
            Inspect extracted text, region confidence and per-page quality estimation
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => goto(-1)}
            disabled={idx === 0}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Prev
          </button>
          <select
            value={page.pageNumber}
            onChange={(e) => {
              setActivePage(Number(e.target.value));
              setActiveRegion(null);
            }}
            className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground"
          >
            {sorted.map((p) => (
              <option key={p.pageNumber} value={p.pageNumber}>
                Page {p.pageNumber}
              </option>
            ))}
          </select>
          <button
            onClick={() => goto(1)}
            disabled={idx === sorted.length - 1}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-40"
          >
            Next <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        {/* LEFT: thumbnails */}
        <aside className="lg:col-span-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Pages · ranked by attention
          </div>
          <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
            {[...sorted]
              .sort((a, b) => b.pageScore - a.pageScore)
              .map((p) => {
                const t = qualityTier(pageQE(p).qe);
                const r = rendered.find((x) => x.pageNumber === p.pageNumber);
                const isActive = p.pageNumber === page.pageNumber;
                return (
                  <button
                    key={p.pageNumber}
                    onClick={() => {
                      setActivePage(p.pageNumber);
                      setActiveRegion(null);
                    }}
                    className={`flex w-full items-center gap-2 rounded-md border p-2 text-left transition ${
                      isActive
                        ? "border-primary bg-primary/10 shadow-[var(--shadow-glow)]"
                        : "border-border bg-card hover:bg-muted"
                    }`}
                  >
                    <div className="relative h-14 w-10 flex-none overflow-hidden rounded bg-muted">
                      {r && (
                        <img src={r.dataUrl} alt="" className="h-full w-full object-cover" />
                      )}
                      <span
                        className={`absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full ${t.dot}`}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                        <span>Page {p.pageNumber}</span>
                        <span className="text-primary">
                          {(p.pageScore * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        {p.wordCount} words · {(p.confidence * 100).toFixed(0)}% conf
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-[var(--gradient-primary)]"
                          style={{ width: `${p.pageScore * 100}%` }}
                        />
                      </div>
                    </div>
                  </button>
                );
              })}
          </div>
        </aside>

        {/* CENTER: page preview with overlays */}
        <div className="lg:col-span-5">
          <div className="relative overflow-hidden rounded-lg border border-border bg-muted">
            {img && (
              <img
                src={img.dataUrl}
                alt={`Page ${page.pageNumber}`}
                className="block h-auto w-full"
              />
            )}
            {regions.map((r) => {
              const t = qualityTier(r.confidence);
              const isSel = activeRegion === r.id;
              return (
                <button
                  key={r.id}
                  onClick={() => setActiveRegion(isSel ? null : r.id)}
                  className={`absolute rounded-sm border-2 transition ${
                    isSel ? "border-primary" : "border-transparent"
                  }`}
                  style={{
                    left: `${r.box.left * 100}%`,
                    top: `${r.box.top * 100}%`,
                    width: `${r.box.width * 100}%`,
                    height: `${r.box.height * 100}%`,
                    background: isSel
                      ? "color-mix(in oklab, var(--primary) 18%, transparent)"
                      : `color-mix(in oklab, ${
                          t.label === "High"
                            ? "oklch(0.78 0.18 150)"
                            : t.label === "Medium"
                              ? "oklch(0.82 0.16 80)"
                              : "oklch(0.7 0.2 25)"
                        } 12%, transparent)`,
                    borderColor: isSel
                      ? "var(--primary)"
                      : `color-mix(in oklab, ${
                          t.label === "High"
                            ? "oklch(0.78 0.18 150)"
                            : t.label === "Medium"
                              ? "oklch(0.82 0.16 80)"
                              : "oklch(0.7 0.2 25)"
                        } 55%, transparent)`,
                  }}
                  title={`${r.type} · ${(r.confidence * 100).toFixed(0)}%`}
                >
                  <span className="absolute -top-4 left-0 rounded bg-background/90 px-1 text-[9px] font-bold uppercase text-foreground">
                    {r.type} {(r.confidence * 100).toFixed(0)}%
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{regions.length} regions detected</span>
            <span>Click a region to inspect</span>
          </div>
        </div>

        {/* RIGHT: text + QE */}
        <div className="space-y-3 lg:col-span-4">
          <div className={`flex items-center gap-2 rounded-md border px-3 py-2 ${tier.cls}`}>
            <tier.Icon className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-wider">
              {tier.label} quality
            </span>
            <span className="ml-auto text-xs font-bold">QE {(qe.qe * 100).toFixed(1)}%</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Metric label="Confidence" value={`${(page.confidence * 100).toFixed(1)}%`} />
            <Metric label="Attention" value={`${(page.pageScore * 100).toFixed(1)}%`} />
            <Metric label="CER" value={`${(qe.cer * 100).toFixed(1)}%`} good={qe.cer < 0.2} />
            <Metric label="WER" value={`${(qe.wer * 100).toFixed(1)}%`} good={qe.wer < 0.25} />
            <Metric label="Text Density" value={(page.textDensity * 100).toFixed(0) + "%"} />
            <Metric label="Regions" value={String(regions.length)} />
          </div>

          {qe.qe < 0.5 && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              <AlertTriangle className="mr-1 inline h-3 w-3" /> Low-confidence page — extracted
              text may contain errors.
            </div>
          )}

          <div className="rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {region ? `Region #${region.id + 1} · ${region.type}` : "Extracted Text"}
              </span>
              <div className="flex gap-1">
                <button
                  onClick={copyText}
                  className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-[10px] text-foreground hover:bg-muted"
                >
                  <Copy className="h-3 w-3" /> Copy
                </button>
                <button
                  onClick={downloadPage}
                  className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-[10px] text-foreground hover:bg-muted"
                >
                  <Download className="h-3 w-3" /> .txt
                </button>
              </div>
            </div>
            {region ? (
              <div className="space-y-2 p-3 text-xs">
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <Metric label="Confidence" value={`${(region.confidence * 100).toFixed(1)}%`} />
                  <Metric label="Region Score" value={`${(region.score * 100).toFixed(1)}%`} />
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Box: x={region.box.left.toFixed(2)} y={region.box.top.toFixed(2)} w=
                  {region.box.width.toFixed(2)} h={region.box.height.toFixed(2)}
                </div>
                <pre className="max-h-[280px] overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-foreground">
                  {region.text}
                </pre>
              </div>
            ) : (
              <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words p-3 font-sans text-xs leading-relaxed text-foreground">
                {page.text?.trim() || "[No text extracted from this page]"}
              </pre>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  good,
}: {
  label: string;
  value: string;
  good?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-card px-2 py-1.5">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={`text-sm font-bold ${
          good === undefined ? "text-foreground" : good ? "text-emerald-400" : "text-amber-400"
        }`}
      >
        {value}
      </div>
    </div>
  );
}