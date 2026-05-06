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

  const exportJson = () => {
    const blob = new Blob(
      [JSON.stringify({ fileName, documentScore, qe, processingMs, summary, pages }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName.replace(/\.pdf$/i, "")}-analysis.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportText = () => {
    const text = pages.map((p) => `--- Page ${p.pageNumber} ---\n${p.text}`).join("\n\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName.replace(/\.pdf$/i, "")}-text.txt`;
    a.click();
    URL.revokeObjectURL(url);
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
            <Download className="h-4 w-4" /> Text
          </button>
          <button
            onClick={exportJson}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            <Download className="h-4 w-4" /> JSON
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
              Gemini 2.5
            </span>
          </div>
          <div className="prose prose-invert max-w-none whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
            {summary}
          </div>
        </div>
      )}

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