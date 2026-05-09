import type { RenderedPage } from "./pdf";

export interface LocalOcrResult {
  text: string;
  confidence: number;
  wordCount: number;
  regions: number;
  engine: "PaddleOCR";
  error?: string;
}

type PaddleOcrModule = {
  init: () => Promise<void>;
  recognize: (
    image: HTMLImageElement | HTMLCanvasElement,
  ) => Promise<{ text?: string | string[]; points?: unknown[] }>;
};

let paddle: PaddleOcrModule | null = null;
let initPromise: Promise<PaddleOcrModule> | null = null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getPaddleOcr() {
  if (typeof document === "undefined") {
    throw new Error("PaddleOCR runs in the browser after the document is rendered.");
  }
  if (paddle) return paddle;
  initPromise ??= import("@paddlejs-models/ocr").then(async (mod) => {
    const moduleWithDefault = mod as unknown as PaddleOcrModule & { default?: PaddleOcrModule };
    const ocr = moduleWithDefault.default ?? moduleWithDefault;
    await ocr.init();
    paddle = ocr;
    return ocr;
  });
  return initPromise;
}

async function loadImage(src: string) {
  const image = new Image();
  image.decoding = "async";
  image.src = src;
  if (image.decode) {
    await image.decode().catch(
      () =>
        new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("Unable to decode page image for OCR."));
        }),
    );
  } else {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Unable to load page image for OCR."));
    });
  }
  return image;
}

function normalizeText(text: string | string[] | undefined) {
  if (Array.isArray(text)) {
    // PaddleJS returns one string per detected region; join with newlines
    // so reading order is preserved (the engine already returns boxes
    // sorted top-to-bottom, left-to-right).
    return text.map((s) => String(s ?? "").trim()).filter(Boolean).join("\n").trim();
  }
  return (text ?? "").trim();
}

function regionCountFrom(result: { text?: string | string[]; points?: unknown[] }) {
  if (Array.isArray(result.points) && result.points.length > 0) return result.points.length;
  if (Array.isArray(result.text)) return result.text.filter((s) => String(s ?? "").trim()).length;
  return 0;
}

function confidenceFor(text: string, regionCount: number) {
  const words = text.split(/\s+/).filter(Boolean).length;
  if (!text || words === 0) return 0;
  // Realistic heuristic: PaddleJS does not expose per-region scores in the
  // browser build, so we approximate from extraction signal strength.
  // A well-extracted page (>=20 regions, >=80 words) lands around 0.9.
  const wordScore = Math.min(0.45, words / 180);
  const regionScore = Math.min(0.25, regionCount / 40);
  const densityScore = Math.min(0.15, text.length / 1200);
  return Math.max(0.4, Math.min(0.97, 0.35 + wordScore + regionScore + densityScore));
}

export async function runPaddleOcr(
  page: RenderedPage,
  options: { throttleMs?: number } = {},
): Promise<LocalOcrResult> {
  if (options.throttleMs) await sleep(options.throttleMs);
  try {
    const ocr = await getPaddleOcr();
    const image = await loadImage(page.dataUrl);
    const result = await ocr.recognize(image);
    const text = normalizeText(result.text);
    const regions = regionCountFrom(result);
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    return {
      text,
      confidence: confidenceFor(text, regions),
      wordCount,
      regions,
      engine: "PaddleOCR",
    };
  } catch (error) {
    return {
      text: "",
      confidence: 0.12,
      wordCount: 0,
      regions: 0,
      engine: "PaddleOCR",
      error: (error as Error).message,
    };
  }
}