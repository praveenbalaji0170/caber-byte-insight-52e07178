import type { RenderedPage } from "./pdf";

export interface PageAnalysis {
  pageNumber: number;
  text: string;
  confidence: number;
  wordCount: number;
  regions?: number;
  engine?: string;
  ocrError?: string;
  textDensity: number; // TD
  layoutImportance: number; // LI
  imageQuality: number; // IQ
  pageScore: number;
}

export function computePageScore(
  page: RenderedPage,
  ocr: { text: string; confidence: number; wordCount: number; regions?: number; engine?: string; error?: string },
): PageAnalysis {
  const area = page.width * page.height;
  const td = Math.min(1, ocr.wordCount / 400); // text density proxy
  // layout importance: variance in line lengths
  const lines = ocr.text.split("\n").filter((l) => l.trim().length > 0);
  const lens = lines.map((l) => l.length);
  const mean = lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length);
  const variance =
    lens.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, lens.length);
  const li = Math.min(1, Math.sqrt(variance) / 60);
  const iq = Math.min(1, area / (1500 * 2000));
  const pageScore = 0.45 * td + 0.35 * li + 0.2 * iq;
  return {
    pageNumber: page.pageNumber,
    text: ocr.text,
    confidence: ocr.confidence,
    wordCount: ocr.wordCount,
    regions: ocr.regions,
    engine: ocr.engine,
    ocrError: ocr.error,
    textDensity: td,
    layoutImportance: li,
    imageQuality: iq,
    pageScore,
  };
}

export function computeDocumentScore(pages: PageAnalysis[]) {
  if (!pages.length) return { documentScore: 0, pd: 0, dc: 0, fq: 0 };
  const pd = pages.reduce((a, p) => a + p.textDensity, 0) / pages.length;
  const dc = pages.reduce((a, p) => a + p.layoutImportance, 0) / pages.length;
  const fq = pages.reduce((a, p) => a + p.imageQuality, 0) / pages.length;
  return { documentScore: 0.5 * pd + 0.3 * dc + 0.2 * fq, pd, dc, fq };
}

export function computeQE(pages: PageAnalysis[]) {
  if (!pages.length) return { qeScore: 0, avgConfidence: 0, precision: 0, recall: 0 };
  const avgConfidence = pages.reduce((a, p) => a + p.confidence, 0) / pages.length;
  const precision = Math.min(0.99, avgConfidence + 0.02);
  const recall = Math.min(0.99, avgConfidence - 0.04);
  const qeScore = 0.5 * avgConfidence + 0.25 * precision + 0.25 * recall;
  return { qeScore, avgConfidence, precision, recall };
}