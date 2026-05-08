import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-1.5-flash";
const MIN_REQUEST_GAP_MS = 4_000;
const COOLDOWN_MS = 45_000;
const LARGE_DOCUMENT_CHARS = 80_000;
const MAX_DIRECT_CHARS = 60_000;
const CHUNK_SIZE = 45_000;
const MAX_CHUNKS = 5;

let queue = Promise.resolve();
let lastRequestAt = 0;
let cooldownUntil = 0;
const summaryCache = new Map<string, { summary: string; createdAt: number }>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function sha256(input: string) {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function enqueue<T>(job: () => Promise<T>) {
  const run = queue.then(job, job);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function callGemini(body: unknown) {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("AI service is not configured.");

  const now = Date.now();
  if (cooldownUntil > now) {
    throw new Error(`AI analysis is cooling down for ${Math.ceil((cooldownUntil - now) / 1000)}s.`);
  }

  const gap = Date.now() - lastRequestAt;
  if (gap < MIN_REQUEST_GAP_MS) await sleep(MIN_REQUEST_GAP_MS - gap);

  const maxAttempts = 4;
  let lastErr = "";
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    lastRequestAt = Date.now();
    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();

    const txt = await res.text();
    lastErr = txt;
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after")) || 0;
      const delay = retryAfter > 0 ? retryAfter * 1000 : 1500 * Math.pow(2, attempt);
      cooldownUntil = Date.now() + Math.max(COOLDOWN_MS, delay);
      if (attempt < maxAttempts - 1) {
        await sleep(delay);
        continue;
      }
      throw new Error("AI summary temporarily unavailable because the provider is rate limited.");
    }
    if (res.status === 402) throw new Error("AI credits are exhausted.");
    throw new Error(`AI analysis failed (${res.status}): ${txt.slice(0, 180)}`);
  }
  throw new Error(`AI analysis failed after retries: ${lastErr.slice(0, 180)}`);
}

function splitText(text: string) {
  const chunks: string[] = [];
  for (let i = 0; i < text.length && chunks.length < MAX_CHUNKS; i += CHUNK_SIZE) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  }
  return chunks;
}

async function summarizeText(fullText: string) {
  const directText = fullText.slice(0, MAX_DIRECT_CHARS);
  const json = await callGemini({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are CABER BYTE's document understanding analyst. Use only the supplied OCR text. Return concise markdown with Summary, Key Insights, Important Entities, and Document Understanding sections.",
      },
      {
        role: "user",
        content: `Analyze this aggregated OCR document text. Do not perform OCR, page rendering, region detection, or layout analysis.\n\n${directText}`,
      },
    ],
  });
  return String(json.choices?.[0]?.message?.content ?? "").trim();
}

async function summarizeLargeText(fullText: string) {
  const chunks = splitText(fullText);
  const briefs: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const json = await callGemini({
      model: MODEL,
      messages: [
        {
          role: "system",
          content:
            "Condense this OCR text chunk into compact factual notes only. Include entities, dates, amounts, and claims. Do not perform OCR.",
        },
        { role: "user", content: `Chunk ${i + 1}/${chunks.length}:\n\n${chunks[i]}` },
      ],
    });
    briefs.push(String(json.choices?.[0]?.message?.content ?? "").trim());
  }
  return summarizeText(briefs.join("\n\n"));
}

export const summarizeDocument = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        documentId: z.string().min(16).max(128),
        fileName: z.string().min(1).max(255),
        pageCount: z.number().int().positive().max(500),
        fullText: z.string().min(1).max(600000),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const textHash = await sha256(`${data.documentId}:${data.pageCount}:${data.fullText}`);
    const cached = summaryCache.get(textHash);
    if (cached) return { summary: cached.summary, cached: true, unavailable: false };

    try {
      const summary = await enqueue(() =>
        data.fullText.length > LARGE_DOCUMENT_CHARS
          ? summarizeLargeText(data.fullText)
          : summarizeText(data.fullText),
      );
      summaryCache.set(textHash, { summary, createdAt: Date.now() });
      return { summary, cached: false, unavailable: false };
    } catch (error) {
      return {
        summary: null,
        cached: false,
        unavailable: true,
        error: (error as Error).message,
      };
    }
  });