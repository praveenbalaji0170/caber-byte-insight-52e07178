import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
// Provider-supported models, ordered by preference. The first one that
// works is cached for subsequent calls so we don't keep paying the
// fallback latency on every request.
const MODEL_FALLBACKS = [
  "google/gemini-3-flash-preview",
  "google/gemini-2.5-flash",
  "google/gemini-2.5-flash-lite",
  "openai/gpt-5-mini",
  "openai/gpt-5-nano",
] as const;
let activeModel: string = MODEL_FALLBACKS[0];
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

type ChatBody = { model?: string; messages: Array<{ role: string; content: string }> };

async function callAi(body: ChatBody) {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("AI service is not configured.");

  const now = Date.now();
  if (cooldownUntil > now) {
    throw new Error(`AI analysis is cooling down for ${Math.ceil((cooldownUntil - now) / 1000)}s.`);
  }

  const gap = Date.now() - lastRequestAt;
  if (gap < MIN_REQUEST_GAP_MS) await sleep(MIN_REQUEST_GAP_MS - gap);

  // Try the active model first, then walk the fallback list on
  // "invalid model" / 400-style errors so a deprecated model id never
  // breaks the pipeline.
  const models = [activeModel, ...MODEL_FALLBACKS.filter((m) => m !== activeModel)];
  let lastErr = "";
  for (const model of models) {
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      lastRequestAt = Date.now();
      const res = await fetch(GATEWAY, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, model }),
      });
      if (res.ok) {
        activeModel = model;
        return res.json();
      }
      const txt = await res.text();
      lastErr = `${res.status} ${txt.slice(0, 200)}`;
      if (res.status === 402) throw new Error("AI credits are exhausted.");
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after")) || 0;
        const delay = retryAfter > 0 ? retryAfter * 1000 : 1500 * Math.pow(2, attempt);
        cooldownUntil = Date.now() + Math.max(COOLDOWN_MS, delay);
        if (attempt < maxAttempts - 1) {
          await sleep(delay);
          continue;
        }
        // try next model on persistent 429
        break;
      }
      if (res.status === 400 || res.status === 404) {
        // invalid/unknown model -> try the next fallback immediately
        break;
      }
      // other errors: try a couple more attempts on the same model
      if (attempt < maxAttempts - 1) {
        await sleep(800 * (attempt + 1));
        continue;
      }
    }
  }
  throw new Error(`AI analysis failed: ${lastErr || "no compatible model available"}`);
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
  const json = await callAi({
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
    const json = await callAi({
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