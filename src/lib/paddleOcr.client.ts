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
    const ocr = (("default" in mod ? mod.default : mod) ?? mod) as PaddleOcrModule;
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
  if (Array.isArray(text)) return text.join("\n").trim();
  return (text ?? "").trim();
}

function confidenceFor(text: string, regionCount: number) {
  const words = text.split(/\s+/).filter(Boolean).length;
  if (!text || words === 0) return 0.18;
  const lengthScore = Math.min(0.28, text.length / 5000);
  const structureScore = Math.min(0.12, regionCount / 80);
  const wordScore = Math.min(0.22, words / 1000);
  return Math.min(0.97, 0.35 + lengthScore + structureScore + wordScore);
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
    const regions = Array.isArray(result.points) ? result.points.length : 0;
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