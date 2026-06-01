import PptxGenJS from "pptxgenjs";
import type { Deck, TextBlock } from "../types";

// Build a native, editable PPTX: original slide image as the background,
// real text boxes positioned on top so users can edit in PowerPoint/Keynote.

const SLIDE_W_IN = 13.333; // 16:9 widescreen in inches
function dims(aspect: number) {
  // Keep width fixed, derive height from aspect.
  const w = SLIDE_W_IN;
  const h = w / aspect;
  return { w, h };
}

function fontPtFor(block: TextBlock, slideHeightIn: number): number {
  // fontSize is in points relative to a 720pt-tall slide.
  // Scale to the actual slide height (in points = inches * 72).
  const slideHeightPt = slideHeightIn * 72;
  return Math.max(6, Math.round((block.fontSize / 720) * slideHeightPt));
}

export async function exportPptx(deck: Deck): Promise<Buffer> {
  const pptx = new PptxGenJS();
  const { w, h } = dims(deck.aspect);
  pptx.defineLayout({ name: "RP", width: w, height: h });
  pptx.layout = "RP";
  pptx.title = deck.title;

  for (const slide of deck.slides) {
    const s = pptx.addSlide();

    if (slide.background) {
      s.addImage({ data: slide.background, x: 0, y: 0, w, h });
    }

    // Editable shapes (drawn above background, below text). Only shapes the
    // user lifted are drawn here; un-lifted shapes remain in the background
    // image, so we skip them to avoid doubling.
    for (const shape of (slide.shapes ?? []).filter((s) => s.lifted)) {
      const sx = shape.bbox.x * w;
      const sy = shape.bbox.y * h;
      const sw = shape.bbox.w * w;
      const sh2 = shape.bbox.h * h;
      const lineW = (shape.strokeWidth / 720) * (h * 72); // pt
      if (shape.kind === "line") {
        // Represent the line by the appropriate diagonal/edge of the bbox.
        let flipV = false;
        if (shape.orientation === "d2") flipV = true;
        s.addShape("line", {
          x: sx,
          y: sy,
          w: Math.max(sw, 0.01),
          h: Math.max(sh2, 0.01),
          line: {
            color: (shape.stroke || "#444444").replace("#", ""),
            width: Math.max(0.5, lineW),
          },
          flipV,
        });
      } else {
        s.addShape("roundRect", {
          x: sx,
          y: sy,
          w: Math.max(sw, 0.05),
          h: Math.max(sh2, 0.05),
          fill: shape.fill
            ? { color: shape.fill.replace("#", "") }
            : { type: "none" },
          line:
            shape.stroke && shape.strokeWidth > 0
              ? { color: shape.stroke.replace("#", ""), width: Math.max(0.5, lineW) }
              : { type: "none" },
          rectRadius: (shape.radius / 720) * h, // inches
        });
      }
    }

    for (const block of slide.textBlocks) {
      const x = block.bbox.x * w;
      const y = block.bbox.y * h;
      const bw = Math.max(0.3, block.bbox.w * w);
      const bh = Math.max(0.2, block.bbox.h * h);

      s.addText(block.text, {
        x,
        y,
        w: bw,
        h: bh,
        fontSize: fontPtFor(block, h),
        fontFace: block.fontFamily || "Arial",
        bold: block.bold,
        italic: block.italic,
        underline: block.underline ? { style: "sng" } : undefined,
        color: block.color.replace("#", ""),
        align: block.align,
        valign: "top",
        fill: block.fill ? { color: block.fill.replace("#", "") } : undefined,
        margin: 2,
        autoFit: true,
      });
    }
  }

  // pptxgenjs returns a base64 string in Node when outputType is set.
  const base64 = (await pptx.write({ outputType: "base64" })) as string;
  return Buffer.from(base64, "base64");
}
