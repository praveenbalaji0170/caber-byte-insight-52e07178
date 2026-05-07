import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

async function callAI(body: unknown) {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY missing");
  const maxAttempts = 4;
  let lastErr = "";
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
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
      // Exponential backoff: 1s, 2s, 4s, 8s
      const retryAfter = Number(res.headers.get("retry-after")) || 0;
      const delay = retryAfter > 0 ? retryAfter * 1000 : 1000 * Math.pow(2, attempt);
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw new Error("Rate limit exceeded. Please wait a moment and try again.");
    }
    if (res.status === 402)
      throw new Error("AI credits exhausted. Add credits in Settings → Workspace → Usage.");
    throw new Error(`AI gateway error ${res.status}: ${txt.slice(0, 200)}`);
  }
  throw new Error(`AI gateway failed after retries: ${lastErr.slice(0, 200)}`);
}

export const ocrPage = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        imageDataUrl: z.string().min(20),
        pageNumber: z.number().int().positive(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const json = await callAI({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content:
            "You are a precise OCR engine. Extract ALL visible text from the page image. Preserve reading order, paragraphs, and line breaks. Return ONLY the extracted text, no commentary.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Extract all text from page ${data.pageNumber}.` },
            { type: "image_url", image_url: { url: data.imageDataUrl } },
          ],
        },
      ],
    });
    const text: string = json.choices?.[0]?.message?.content ?? "";
    // Heuristic confidence: based on text length & structure
    const len = text.length;
    const confidence =
      len === 0 ? 0 : Math.min(0.99, 0.55 + Math.min(0.4, len / 3000) + (text.includes("\n") ? 0.04 : 0));
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    return { pageNumber: data.pageNumber, text, confidence, wordCount };
  });

export const summarizeDocument = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        fullText: z.string().min(1).max(200000),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const json = await callAI({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content:
            "You are an intelligent document analyst. Produce a concise, structured analysis of the document.",
        },
        {
          role: "user",
          content: `Analyze the following OCR-extracted document. Return:\n\n## Summary\n(2-4 sentence overview)\n\n## Document Purpose\n(1 sentence)\n\n## Key Insights\n- bullet 1\n- bullet 2\n- bullet 3\n\n## Important Entities\n(names, dates, numbers, organizations)\n\n---\nDOCUMENT:\n${data.fullText.slice(0, 60000)}`,
        },
      ],
    });
    const summary: string = json.choices?.[0]?.message?.content ?? "";
    return { summary };
  });