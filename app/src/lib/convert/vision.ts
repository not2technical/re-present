import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuid } from "uuid";
import type { Slide, TextBlock } from "../types";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-8";

// System prompt is static across all slides -> prompt-cached to cut cost/latency.
const SYSTEM_PROMPT = `You are a meticulous presentation-digitization engine. You receive ONE rendered slide image and must reconstruct its editable text layer with extreme positional and stylistic accuracy.

Return ONLY a JSON object (no markdown fences, no prose) matching exactly:
{
  "textBlocks": [
    {
      "text": string,            // the literal text, preserve line breaks as \\n
      "x": number,               // left edge, fraction 0..1 of slide width
      "y": number,               // top edge, fraction 0..1 of slide height
      "w": number,               // width fraction 0..1
      "h": number,               // height fraction 0..1
      "fontSize": number,        // point size assuming a 720pt-tall slide
      "fontFamily": string,      // best-guess family, e.g. "Arial", "Georgia"
      "bold": boolean,
      "italic": boolean,
      "underline": boolean,
      "color": string,           // hex, e.g. "#1a1a1a"
      "align": "left"|"center"|"right",
      "fill": string|null        // hex of a solid background chip behind text, else null
    }
  ]
}

Rules:
- Capture EVERY distinct text element: titles, body, bullets, captions, labels, footers, page numbers.
- Group text that visually belongs to one paragraph/box into a single block; keep separate headings/bullets separate.
- Bounding boxes must tightly wrap the visible text. Be precise — these positions overlay the original image.
- Estimate fontSize from the text height relative to the slide height (slide is 720pt tall).
- Read colors from the actual pixels. Match alignment to how text sits in its box.
- Do NOT transcribe text baked into photos/logos/charts unless it is a real readable label.
- If the slide has no text, return {"textBlocks": []}.`;

function clamp01(n: number): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function normalizeBlock(raw: Record<string, unknown>): TextBlock | null {
  const text = typeof raw.text === "string" ? raw.text : "";
  if (!text.trim()) return null;
  const align = raw.align === "center" || raw.align === "right" ? raw.align : "left";
  return {
    id: uuid(),
    text,
    bbox: {
      x: clamp01(Number(raw.x)),
      y: clamp01(Number(raw.y)),
      w: clamp01(Number(raw.w)) || 0.2,
      h: clamp01(Number(raw.h)) || 0.08,
    },
    fontSize: Math.max(6, Math.min(200, Number(raw.fontSize) || 24)),
    fontFamily: typeof raw.fontFamily === "string" ? raw.fontFamily : "Arial",
    bold: Boolean(raw.bold),
    italic: Boolean(raw.italic),
    underline: Boolean(raw.underline),
    color: typeof raw.color === "string" && /^#/.test(raw.color) ? raw.color : "#1a1a1a",
    align,
    fill: typeof raw.fill === "string" && /^#/.test(raw.fill) ? raw.fill : null,
  };
}

function parseDataUrl(dataUrl: string): { media: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; data: string } {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error("Background is not a base64 data URL");
  let media = m[1];
  if (media !== "image/png" && media !== "image/jpeg" && media !== "image/gif" && media !== "image/webp") {
    media = "image/png";
  }
  return { media: media as "image/png", data: m[2] };
}

export type ConvertOptions = {
  apiKey?: string;
};

/**
 * Run Claude vision on a single slide's background image and return the
 * reconstructed editable text blocks.
 */
export async function convertSlide(
  slide: Slide,
  opts: ConvertOptions = {}
): Promise<TextBlock[]> {
  if (!slide.background) {
    // No image to analyze — fall back to any harvested source text.
    return fallbackFromSourceText(slide);
  }

  const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const client = new Anthropic({ apiKey });
  const { media, data } = parseDataUrl(slide.background);

  const hint = slide.sourceText
    ? `\n\nHint — text harvested from the source file (may be incomplete or out of order, use to improve accuracy of transcription):\n${slide.sourceText.slice(0, 4000)}`
    : "";

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: media, data },
          },
          {
            type: "text",
            text: `Reconstruct the editable text layer for this slide.${hint}`,
          },
        ],
      },
    ],
  });

  const textPart = msg.content.find((c) => c.type === "text");
  const out = textPart && "text" in textPart ? textPart.text : "";
  return parseBlocks(out, slide);
}

function parseBlocks(out: string, slide: Slide): TextBlock[] {
  let json = out.trim();
  // Strip accidental code fences.
  json = json.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  // Grab the outermost JSON object.
  const start = json.indexOf("{");
  const end = json.lastIndexOf("}");
  if (start === -1 || end === -1) return fallbackFromSourceText(slide);
  json = json.slice(start, end + 1);

  try {
    const parsed = JSON.parse(json) as { textBlocks?: Record<string, unknown>[] };
    const blocks = (parsed.textBlocks ?? [])
      .map(normalizeBlock)
      .filter((b): b is TextBlock => b !== null);
    return blocks;
  } catch {
    return fallbackFromSourceText(slide);
  }
}

// When vision is unavailable or fails, lay source text into stacked blocks
// so the slide is still editable (lower fidelity).
function fallbackFromSourceText(slide: Slide): TextBlock[] {
  if (!slide.sourceText) return [];
  const lines = slide.sourceText.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const blocks: TextBlock[] = [];
  let y = 0.08;
  for (const line of lines.slice(0, 12)) {
    blocks.push({
      id: uuid(),
      text: line,
      bbox: { x: 0.06, y, w: 0.88, h: 0.07 },
      fontSize: y === 0.08 ? 40 : 24,
      fontFamily: "Arial",
      bold: y === 0.08,
      italic: false,
      underline: false,
      color: "#1a1a1a",
      align: "left",
      fill: null,
    });
    y += 0.08;
    if (y > 0.92) break;
  }
  return blocks;
}
