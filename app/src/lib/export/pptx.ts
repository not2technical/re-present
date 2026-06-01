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
