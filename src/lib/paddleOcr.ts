import type { RenderedPage } from "./pdf";

export interface OcrRegion {
  text: string;
  confidence: number; // 0..1
  // Normalized 0..1 box relative to the rendered page image
  box: { left: number; top: number; width: number; height: number };
}

export interface LocalOcrResult {
  text: string;
  confidence: number;
  wordCount: number;
  regions: number;
  ocrRegions: OcrRegion[];
  engine: "Tesseract.js";
  error?: string;
}

type TWorker = {
  recognize: (img: HTMLImageElement | HTMLCanvasElement | string) => Promise<{
    data: {
      text: string;
      confidence: number;
      words?: Array<{
        text: string;
        confidence: number;
        bbox: { x0: number; y0: number; x1: number; y1: number };
      }>;
      lines?: Array<{
        text: string;
        confidence: number;
        bbox: { x0: number; y0: number; x1: number; y1: number };
      }>;
    };
  }>;
  terminate: () => Promise<void>;
};

let workerPromise: Promise<TWorker> | null = null;

async function getWorker(): Promise<TWorker> {
  if (typeof window === "undefined") {
    throw new Error("Tesseract.js must run in the browser.");
  }
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      // eng + osd helps with skew detection; eng alone is fine for speed
      const w = (await createWorker("eng", 1, {
        // eslint-disable-next-line no-console
        logger: (m: { status: string; progress: number }) => {
          if (m.status && m.progress >= 0.99) {
            console.debug("[OCR]", m.status, m.progress);
          }
        },
      })) as unknown as TWorker;
      console.info("[OCR] Tesseract.js worker ready");
      return w;
    })();
  }
  return workerPromise;
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  if (img.decode) {
    try {
      await img.decode();
      return img;
    } catch {
      // fall through to onload path
    }
  }
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Unable to load page image for OCR."));
  });
  return img;
}

/**
 * Aggregate Tesseract words into reading order:
 * 1. group words into lines by Y proximity
 * 2. sort lines top→bottom
 * 3. sort words within each line left→right
 * 4. group consecutive lines into paragraphs by vertical gap
 */
function aggregateText(
  words: NonNullable<Awaited<ReturnType<TWorker["recognize"]>>["data"]["words"]>,
  imgHeight: number,
): string {
  if (!words.length) return "";
  const valid = words.filter((w) => w.text && w.text.trim().length > 0);
  if (!valid.length) return "";

  // Sort by vertical center
  const enriched = valid.map((w) => ({
    ...w,
    cy: (w.bbox.y0 + w.bbox.y1) / 2,
    h: w.bbox.y1 - w.bbox.y0,
  }));
  enriched.sort((a, b) => a.cy - b.cy);

  const lines: (typeof enriched)[] = [];
  for (const w of enriched) {
    const last = lines[lines.length - 1];
    const tol = Math.max(6, w.h * 0.6);
    if (last && Math.abs(w.cy - last[0].cy) <= tol) {
      last.push(w);
    } else {
      lines.push([w]);
    }
  }

  // Within line, left→right
  lines.forEach((ln) => ln.sort((a, b) => a.bbox.x0 - b.bbox.x0));

  // Group lines into paragraphs by vertical gap
  let out = "";
  let prevBottom = -1;
  let prevH = 0;
  for (const ln of lines) {
    const top = Math.min(...ln.map((w) => w.bbox.y0));
    const bot = Math.max(...ln.map((w) => w.bbox.y1));
    const h = bot - top;
    if (prevBottom >= 0) {
      const gap = top - prevBottom;
      if (gap > Math.max(prevH, h) * 0.9) out += "\n\n";
      else out += "\n";
    }
    out += ln.map((w) => w.text).join(" ");
    prevBottom = bot;
    prevH = h;
  }
  // Avoid stray newlines at edges
  return out.replace(/[ \t]+\n/g, "\n").trim() + (imgHeight > 0 ? "" : "");
}

export async function runPaddleOcr(
  page: RenderedPage,
  options: { throttleMs?: number } = {},
): Promise<LocalOcrResult> {
  if (options.throttleMs) await new Promise((r) => setTimeout(r, options.throttleMs));
  try {
    const worker = await getWorker();
    const img = await loadImage(page.dataUrl);
    const W = img.naturalWidth || img.width || page.width;
    const H = img.naturalHeight || img.height || page.height;
    console.debug(`[OCR] page ${page.pageNumber} input ${W}×${H}`);

    const { data } = await worker.recognize(img);
    const words = data.words ?? [];
    const lines = data.lines ?? [];
    console.debug(
      `[OCR] page ${page.pageNumber} → ${words.length} words / ${lines.length} lines, conf=${data.confidence}`,
    );

    const text = aggregateText(words, H) || (data.text ?? "").trim();
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    // Region overlays: prefer line-level boxes (cleaner UI) and fall back to words
    const source = lines.length ? lines : words;
    const ocrRegions: OcrRegion[] = source
      .filter((r) => r.text && r.text.trim().length > 0 && r.bbox)
      .map((r) => ({
        text: r.text.trim(),
        confidence: Math.max(0, Math.min(1, (r.confidence ?? 0) / 100)),
        box: {
          left: r.bbox.x0 / W,
          top: r.bbox.y0 / H,
          width: Math.max(0.001, (r.bbox.x1 - r.bbox.x0) / W),
          height: Math.max(0.001, (r.bbox.y1 - r.bbox.y0) / H),
        },
      }));

    const confidence =
      ocrRegions.length > 0
        ? ocrRegions.reduce((a, r) => a + r.confidence, 0) / ocrRegions.length
        : Math.max(0, Math.min(1, (data.confidence ?? 0) / 100));

    return {
      text,
      confidence,
      wordCount,
      regions: ocrRegions.length,
      ocrRegions,
      engine: "Tesseract.js",
    };
  } catch (error) {
    console.error("[OCR] failed", error);
    return {
      text: "",
      confidence: 0,
      wordCount: 0,
      regions: 0,
      ocrRegions: [],
      engine: "Tesseract.js",
      error: (error as Error).message,
    };
  }
}
