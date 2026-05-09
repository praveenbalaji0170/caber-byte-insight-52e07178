import { GoogleGenerativeAI } from "@google/generative-ai";

const MODEL_NAME = "gemini-1.5-flash";
const MAX_DIRECT_CHARS = 60_000;
const LARGE_DOCUMENT_CHARS = 80_000;
const CHUNK_SIZE = 45_000;
const MAX_CHUNKS = 5;
const MIN_REQUEST_GAP_MS = 2_000;
const COOLDOWN_MS = 30_000;

let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;
let cooldownUntil = 0;
const summaryCache = new Map<string, string>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function getClient() {
  const key = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim();
  if (!key) throw new Error("AI insights are not configured.");
  return new GoogleGenerativeAI(key).getGenerativeModel({ model: MODEL_NAME });
}

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job) as Promise<T>;
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function generate(prompt: string, system?: string): Promise<string> {
  const now = Date.now();
  if (cooldownUntil > now) {
    throw new Error(
      `AI insights are cooling down for ${Math.ceil((cooldownUntil - now) / 1000)}s.`,
    );
  }
  const gap = Date.now() - lastRequestAt;
  if (gap < MIN_REQUEST_GAP_MS) await sleep(MIN_REQUEST_GAP_MS - gap);

  const model = getClient();
  const maxAttempts = 3;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    lastRequestAt = Date.now();
    try {
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        ...(system
          ? { systemInstruction: { role: "system", parts: [{ text: system }] } }
          : {}),
      });
      return (result.response.text() ?? "").trim();
    } catch (error) {
      lastErr = error;
      const message = (error as Error).message ?? "";
      const status = (error as { status?: number }).status;
      if (status === 429 || /rate|quota|429/i.test(message)) {
        const delay = 1500 * Math.pow(2, attempt);
        cooldownUntil = Date.now() + Math.max(COOLDOWN_MS, delay);
        if (attempt < maxAttempts - 1) {
          await sleep(delay);
          continue;
        }
        throw new Error("AI insights are temporarily rate limited. Please retry shortly.");
      }
      if (status === 401 || status === 403 || /api key|permission/i.test(message)) {
        throw new Error("AI insights credentials are invalid.");
      }
      if (attempt < maxAttempts - 1) {
        await sleep(800 * (attempt + 1));
        continue;
      }
    }
  }
  throw new Error(`AI analysis failed: ${(lastErr as Error)?.message ?? "unknown error"}`);
}

function splitText(text: string) {
  const chunks: string[] = [];
  for (let i = 0; i < text.length && chunks.length < MAX_CHUNKS; i += CHUNK_SIZE) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  }
  return chunks;
}

const SYSTEM_PROMPT =
  "You are an AI document understanding analyst. Use only the supplied OCR text. " +
  "Return concise markdown with these sections in order: Summary, Key Insights, " +
  "Important Entities, Document Understanding, and Quality Observations. " +
  "Never perform OCR, page rendering, region detection, or layout analysis.";

async function summarizeDirect(fullText: string) {
  return generate(
    `Analyze this aggregated OCR document text:\n\n${fullText.slice(0, MAX_DIRECT_CHARS)}`,
    SYSTEM_PROMPT,
  );
}

async function summarizeLarge(fullText: string) {
  const chunks = splitText(fullText);
  const briefs: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const brief = await generate(
      `Chunk ${i + 1}/${chunks.length}. Condense into compact factual notes only — entities, dates, amounts, and claims:\n\n${chunks[i]}`,
      "Condense OCR text chunks into compact factual notes only. Do not perform OCR.",
    );
    briefs.push(brief);
  }
  return summarizeDirect(briefs.join("\n\n"));
}

export type SummaryResult = {
  summary: string | null;
  unavailable: boolean;
  cached: boolean;
  error?: string;
};

export async function summarizeDocument(args: {
  documentId: string;
  fileName: string;
  pageCount: number;
  fullText: string;
}): Promise<SummaryResult> {
  const cached = summaryCache.get(args.documentId);
  if (cached) return { summary: cached, unavailable: false, cached: true };

  if (!args.fullText.trim()) {
    return { summary: null, unavailable: true, cached: false, error: "No OCR text to analyze." };
  }

  try {
    const summary = await enqueue(() =>
      args.fullText.length > LARGE_DOCUMENT_CHARS
        ? summarizeLarge(args.fullText)
        : summarizeDirect(args.fullText),
    );
    summaryCache.set(args.documentId, summary);
    return { summary, unavailable: false, cached: false };
  } catch (error) {
    return {
      summary: null,
      unavailable: true,
      cached: false,
      error: (error as Error).message,
    };
  }
}

export function isAiConfigured() {
  return Boolean((import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim());
}