import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuid } from "uuid";
import type { Slide, TextBlock, Container, ImageElement, Shape } from "../types";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-8";

// System prompt is static across all slides -> prompt-cached to cut cost/latency.
const SYSTEM_PROMPT = `You are a meticulous presentation-digitization engine. You receive ONE rendered slide image and must reconstruct it as editable layers with extreme positional and stylistic accuracy. The goal: every piece of text becomes editable, baked-in text is cleanly removed, and the look is faithfully rebuilt.

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
      "color": string,           // hex of the TEXT color, e.g. "#1a1a1a"
      "align": "left"|"center"|"right",
      "fill": string|null,       // hex of a solid chip color directly behind the text, else null
      "container": null | {      // a box/button/chip/glow-frame the text sits INSIDE, else null
        "x": number, "y": number, "w": number, "h": number,  // box bounds, fractions 0..1
        "fill": string|null,        // interior color of the box, null if transparent
        "borderColor": string|null, // border/stroke color, null if none
        "borderWidth": number,      // border thickness in px on a 720px-tall slide, 0 if none
        "radius": number,           // corner radius in px on a 720px-tall slide, 0 if square
        "glow": string|null         // soft neon outer-glow color, null if none
      }
    }
  ],
  "imageElements": [             // non-text graphics a user might want to delete
    {
      "x": number, "y": number, "w": number, "h": number, // bounds, fractions 0..1
      "label": string,           // short description, e.g. "robot mascot", "logo", "chart"
      "fillColor": string|null   // solid color of the area immediately around it, null if textured
    }
  ],
  "shapes": [                    // simple GEOMETRIC vector shapes: panels, dividers, rules, boxes
    {
      "kind": "rect"|"line",
      "x": number, "y": number, "w": number, "h": number,  // bounds, fractions 0..1
      "fill": string|null,        // interior hex color for a filled rect/panel, null if not filled
      "stroke": string|null,      // outline/line hex color, null if none
      "strokeWidth": number,      // thickness in px on a 720px-tall slide
      "radius": number,           // corner radius px (rect), 0 if square
      "orientation": "h"|"v"|"d1"|"d2",  // line only: h, v, or diagonals d1 (TL->BR) / d2 (TR->BL)
      "label": string             // e.g. "quadrant divider", "panel background", "footer rule"
    }
  ]
}

Rules for TEXT:
- Capture EVERY distinct text element: titles, body, bullets, captions, labels, footers, page numbers.
- Group text that visually belongs to one line/paragraph into a single block; keep separate headings/bullets separate.
- Bounding boxes must TIGHTLY wrap the visible text. These positions overlay the slide, so precision matters.
- Estimate fontSize from text height relative to slide height (slide is 720pt tall).
- Read the TEXT color from the actual glyph pixels (not the box).

Rules for CONTAINER (critical for fidelity):
- If text sits inside a visible box, button, pill/chip, callout, or glowing frame, fill in "container" with that box's geometry and colors. The box is usually a bit larger than the text.
- "fill" is the box INTERIOR color (what's behind the text). "borderColor"/"borderWidth" describe the outline. "radius" is corner rounding. "glow" is any soft neon halo color around the box.
- If text is just on the plain slide background with no distinct box, set "container": null.
- This lets us repaint a clean box and remove the original baked text/box underneath — so be accurate about colors.

Rules for IMAGE ELEMENTS:
- List distinct NON-TEXT pictorial graphics that a user might delete: photos, illustrations, mascots, logos, icons, charts. One entry per distinct object.
- Do NOT list the whole-slide background, gradients, or container boxes (those are handled above).
- Do NOT list plain geometric shapes/lines here — those go in "shapes".
- "fillColor" = the solid color immediately surrounding the object if uniform, else null.

Rules for SHAPES (so users can move/recolor/delete structural geometry):
- List simple GEOMETRIC elements: dividing lines, grid/quadrant separators, horizontal rules, panel/quadrant background rectangles, framing boxes, underlines.
- Use "rect" for filled or outlined rectangles/panels; use "line" for straight separators/rules (set orientation).
- Read fill and stroke colors from the actual pixels. Give tight, accurate bounds — these are lifted off the image and become editable, and the area underneath is erased.
- Do NOT include the container boxes already described under a textBlock's "container".
- Do NOT include illustrations/icons (those are imageElements). Only clean geometric shapes belong here.

If the slide has no text, still return the other arrays. Always return all of "textBlocks", "imageElements", "shapes" (use [] when empty).`;

function clamp01(n: number): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function hexOrNull(v: unknown): string | null {
  return typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : null;
}

function normalizeContainer(raw: unknown): Container | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const fill = hexOrNull(c.fill);
  const borderColor = hexOrNull(c.borderColor);
  const glow = hexOrNull(c.glow);
  // A container with no visible styling is meaningless — treat as none.
  if (!fill && !borderColor && !glow) return null;
  return {
    bbox: {
      x: clamp01(Number(c.x)),
      y: clamp01(Number(c.y)),
      w: clamp01(Number(c.w)) || 0.2,
      h: clamp01(Number(c.h)) || 0.08,
    },
    fill,
    borderColor,
    borderWidth: Math.max(0, Math.min(20, Number(c.borderWidth) || 0)),
    radius: Math.max(0, Math.min(80, Number(c.radius) || 0)),
    glow,
  };
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
    color: hexOrNull(raw.color) ?? "#1a1a1a",
    align,
    fill: hexOrNull(raw.fill),
    container: normalizeContainer(raw.container),
  };
}

function normalizeImageElement(raw: Record<string, unknown>): ImageElement | null {
  const w = clamp01(Number(raw.w));
  const h = clamp01(Number(raw.h));
  if (w < 0.01 || h < 0.01) return null;
  return {
    id: uuid(),
    bbox: { x: clamp01(Number(raw.x)), y: clamp01(Number(raw.y)), w, h },
    fillColor: hexOrNull(raw.fillColor),
    label: typeof raw.label === "string" ? raw.label.slice(0, 80) : undefined,
  };
}

function normalizeShape(raw: Record<string, unknown>): Shape | null {
  const kind = raw.kind === "line" ? "line" : "rect";
  const w = clamp01(Number(raw.w));
  const h = clamp01(Number(raw.h));
  // Lines may have ~0 thickness in one axis; rects need real area.
  if (kind === "rect" && (w < 0.005 || h < 0.005)) return null;
  const fill = hexOrNull(raw.fill);
  const stroke = hexOrNull(raw.stroke);
  if (!fill && !stroke) return null; // invisible shape -> skip
  const orient = raw.orientation;
  return {
    id: uuid(),
    kind,
    bbox: { x: clamp01(Number(raw.x)), y: clamp01(Number(raw.y)), w, h },
    fill,
    stroke,
    strokeWidth: Math.max(0, Math.min(40, Number(raw.strokeWidth) || (kind === "line" ? 2 : 0))),
    radius: Math.max(0, Math.min(120, Number(raw.radius) || 0)),
    orientation:
      orient === "h" || orient === "v" || orient === "d1" || orient === "d2"
        ? orient
        : kind === "line"
        ? w >= h
          ? "h"
          : "v"
        : undefined,
    label: typeof raw.label === "string" ? raw.label.slice(0, 80) : undefined,
  };
}

export type SlideConversion = {
  textBlocks: TextBlock[];
  imageElements: ImageElement[];
  shapes: Shape[];
};

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
 * reconstructed editable text blocks, containers, and removable image regions.
 */
export async function convertSlide(
  slide: Slide,
  opts: ConvertOptions = {}
): Promise<SlideConversion> {
  if (!slide.background) {
    // No image to analyze — fall back to any harvested source text.
    return { textBlocks: fallbackFromSourceText(slide), imageElements: [], shapes: [] };
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
    // Rich per-block output (text + container geometry/colors) is verbose;
    // dense slides need plenty of room or the JSON truncates and fails to parse.
    max_tokens: 16000,
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
  return parseConversion(out, slide);
}

function parseConversion(out: string, slide: Slide): SlideConversion {
  let json = out.trim();
  // Strip accidental code fences.
  json = json.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  // Grab the outermost JSON object.
  const start = json.indexOf("{");
  const end = json.lastIndexOf("}");
  if (start === -1 || end === -1) {
    console.error("[convert] no JSON object found in model output:", out.slice(0, 200));
    return { textBlocks: fallbackFromSourceText(slide), imageElements: [], shapes: [] };
  }
  json = json.slice(start, end + 1);

  try {
    const parsed = JSON.parse(json) as {
      textBlocks?: Record<string, unknown>[];
      imageElements?: Record<string, unknown>[];
      shapes?: Record<string, unknown>[];
    };
    const textBlocks = (parsed.textBlocks ?? [])
      .map(normalizeBlock)
      .filter((b): b is TextBlock => b !== null);
    const imageElements = (parsed.imageElements ?? [])
      .map(normalizeImageElement)
      .filter((e): e is ImageElement => e !== null);
    const shapes = (parsed.shapes ?? [])
      .map(normalizeShape)
      .filter((s): s is Shape => s !== null);
    return { textBlocks, imageElements, shapes };
  } catch (e) {
    console.error("[convert] JSON parse failed:", (e as Error).message, "len:", json.length, "tail:", json.slice(-120));
    return { textBlocks: fallbackFromSourceText(slide), imageElements: [], shapes: [] };
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
