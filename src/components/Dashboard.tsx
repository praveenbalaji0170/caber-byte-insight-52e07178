import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  BrainCircuit,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Layers,
  Sparkles,
} from "lucide-react";
import { StatCard } from "./StatCard";
import { OcrInspector } from "./OcrInspector";
import type { PageAnalysis } from "@/lib/attention";
import type { RenderedPage } from "@/lib/pdf";

interface Props {
  pages: PageAnalysis[];
  rendered: RenderedPage[];
  documentScore: number;
  qe: { qeScore: number; avgConfidence: number; precision: number; recall: number };
  processingMs: number;
  summary: string | null;
  fileName: string;
  onReset: () => void;
}

export function Dashboard({
  pages,
  rendered,
  documentScore,
  qe,
  processingMs,
  summary,
  fileName,
  onReset,
}: Props) {
  const totalWords = pages.reduce((a, p) => a + p.wordCount, 0);
  const ranked = [...pages].sort((a, b) => b.pageScore - a.pageScore);

  const chartData = pages.map((p) => ({
    page: `P${p.pageNumber}`,
    score: +(p.pageScore * 100).toFixed(1),
    confidence: +(p.confidence * 100).toFixed(1),
    words: p.wordCount,
  }));

  const baseName = fileName.replace(/\.pdf$/i, "");
  const generatedAt = new Date().toISOString();

  const download = (content: string, mime: string, ext: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${baseName}-ocr.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportText = () => {
    const sorted = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
    const body = sorted
      .map(
        (p) =>
          `===== PAGE ${p.pageNumber} =====\n${(p.text || "").trim() || "[no text extracted]"}`,
      )
      .join("\n\n");
    const header =
      `CABER BYTE — OCR Extract\nDocument: ${fileName}\nGenerated: ${generatedAt}\nPages: ${pages.length}\n\n`;
    download(header + body + "\n", "text/plain", "txt");
  };

  const exportJson = () => {
    const sorted = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
    const payload = {
      document_name: fileName,
      generated_at: generatedAt,
      processing_ms: Math.round(processingMs),
      document_score: +documentScore.toFixed(4),
      quality_evaluation: {
        qe_score: +qe.qeScore.toFixed(4),
        avg_confidence: +qe.avgConfidence.toFixed(4),
        precision: +qe.precision.toFixed(4),
        recall: +qe.recall.toFixed(4),
      },
      ai_summary: summary,
      pages: sorted.map((p) => ({
        page: p.pageNumber,
        page_score: +p.pageScore.toFixed(4),
        confidence: +p.confidence.toFixed(4),
        word_count: p.wordCount,
        text_density: +p.textDensity.toFixed(4),
        layout_importance: +p.layoutImportance.toFixed(4),
        image_quality: +p.imageQuality.toFixed(4),
        regions: [
          {
            type: "page",
            text: p.text,
            confidence: +p.confidence.toFixed(4),
            region_score: +p.pageScore.toFixed(4),
          },
        ],
      })),
    };
    download(JSON.stringify(payload, null, 2), "application/json", "json");
  };

  const exportCsv = () => {
    const sorted = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
    const esc = (v: string | number) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [
      ["page", "region_type", "text", "confidence", "region_score", "page_score"],
      ...sorted.map((p) => [
        p.pageNumber,
        "page",
        (p.text || "").replace(/\r?\n/g, " ").trim(),
        p.confidence.toFixed(4),
        p.pageScore.toFixed(4),
        p.pageScore.toFixed(4),
      ]),
    ];
    download(rows.map((r) => r.map(esc).join(",")).join("\n"), "text/csv", "csv");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-foreground">{fileName}</h2>
          <p className="text-sm text-muted-foreground">Hierarchical attention analysis complete</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={exportText}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            <Download className="h-4 w-4" /> TXT
          </button>
          <button
            onClick={exportJson}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            <Download className="h-4 w-4" /> JSON
          </button>
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            <Download className="h-4 w-4" /> CSV
          </button>
          <button
            onClick={onReset}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--gradient-primary)] px-4 py-2 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow)]"
          >
            New Document
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <StatCard icon={FileText} label="Pages" value={String(pages.length)} />
        <StatCard icon={CheckCircle2} label="OCR Confidence" value={`${(qe.avgConfidence * 100).toFixed(1)}%`} />
        <StatCard icon={Sparkles} label="Doc Score" value={`${(documentScore * 100).toFixed(1)}%`} />
        <StatCard icon={Activity} label="QE Score" value={`${(qe.qeScore * 100).toFixed(1)}%`} />
        <StatCard icon={Layers} label="Words" value={totalWords.toLocaleString()} />
        <StatCard icon={Clock} label="Processing" value={`${(processingMs / 1000).toFixed(1)}s`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-[var(--gradient-card)] p-5">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Page Attention Scores
          </h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="page" stroke="var(--muted-foreground)" fontSize={11} />
              <YAxis stroke="var(--muted-foreground)" fontSize={11} />
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  color: "var(--foreground)",
                }}
              />
              <Bar dataKey="score" radius={[6, 6, 0, 0]}>
                {chartData.map((_, i) => (
                  <Cell key={i} fill="var(--primary)" />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl border border-border bg-[var(--gradient-card)] p-5">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            OCR Confidence per Page
          </h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="page" stroke="var(--muted-foreground)" fontSize={11} />
              <YAxis stroke="var(--muted-foreground)" fontSize={11} domain={[0, 100]} />
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  color: "var(--foreground)",
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line
                type="monotone"
                dataKey="confidence"
                stroke="var(--accent)"
                strokeWidth={2.5}
                dot={{ fill: "var(--accent)", r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {summary && (
        <div className="rounded-xl border border-primary/30 bg-[var(--gradient-card)] p-6 shadow-[var(--shadow-glow)]">
          <div className="mb-3 flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-semibold text-foreground">AI Insights</h3>
            <span className="ml-auto rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
              Intelligent Analysis
            </span>
          </div>
          <div className="prose prose-invert max-w-none whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
            {summary}
          </div>
        </div>
      )}

      <OcrInspector pages={pages} rendered={rendered} />

      <div className="rounded-xl border border-border bg-[var(--gradient-card)] p-5">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Page Ranking & Thumbnails
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {ranked.map((p, idx) => {
            const img = rendered.find((r) => r.pageNumber === p.pageNumber);
            return (
              <div key={p.pageNumber} className="group overflow-hidden rounded-lg border border-border bg-card">
                <div className="relative aspect-[3/4] overflow-hidden bg-muted">
                  {img && (
                    <img
                      src={img.dataUrl}
                      alt={`Page ${p.pageNumber}`}
                      className="h-full w-full object-cover opacity-90 transition group-hover:opacity-100"
                    />
                  )}
                  <div className="absolute left-2 top-2 rounded-md bg-background/90 px-2 py-0.5 text-xs font-bold text-foreground">
                    #{idx + 1}
                  </div>
                  <div
                    className="absolute inset-0"
                    style={{
                      background: `linear-gradient(180deg, transparent 50%, oklch(0.78 0.18 195 / ${p.pageScore * 0.4}))`,
                    }}
                  />
                </div>
                <div className="space-y-1.5 p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground">Page {p.pageNumber}</span>
                    <span className="font-bold text-primary">{(p.pageScore * 100).toFixed(0)}%</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>{p.wordCount} words</span>
                    <span>{(p.confidence * 100).toFixed(0)}% conf</span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-[var(--gradient-primary)]"
                      style={{ width: `${p.pageScore * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}