import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { Deck, TextBlock } from "../types";

// Export to PDF: render each slide's background image, then draw editable
// text on top. (PDF text is selectable/searchable; true field-editing is
// reserved for the PPTX path.)

function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  const n = h.length === 3
    ? h.split("").map((c) => c + c).join("")
    : h.padEnd(6, "0").slice(0, 6);
  const r = parseInt(n.slice(0, 2), 16) / 255;
  const g = parseInt(n.slice(2, 4), 16) / 255;
  const b = parseInt(n.slice(4, 6), 16) / 255;
  return rgb(
    Number.isNaN(r) ? 0.1 : r,
    Number.isNaN(g) ? 0.1 : g,
    Number.isNaN(b) ? 0.1 : b
  );
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; type: "png" | "jpg" } {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error("Invalid data URL");
  const type = m[1].includes("jpeg") || m[1].includes("jpg") ? "jpg" : "png";
  return { bytes: Buffer.from(m[2], "base64"), type };
}

export async function exportPdf(deck: Deck): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Page size: 960x540 points scaled by aspect (PowerPoint default 10in x ...).
  const pageW = 960;
  const pageH = pageW / deck.aspect;

  for (const slide of deck.slides) {
    const page = pdf.addPage([pageW, pageH]);

    if (slide.background) {
      try {
        const { bytes, type } = dataUrlToBytes(slide.background);
        const img = type === "png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
        page.drawImage(img, { x: 0, y: 0, width: pageW, height: pageH });
      } catch {
        // skip unreadable background
      }
    }

    // Editable shapes (above background, below text). PDF origin is bottom-left.
    for (const shape of slide.shapes ?? []) {
      const sx = shape.bbox.x * pageW;
      const syTop = shape.bbox.y * pageH;
      const sw = shape.bbox.w * pageW;
      const sh2 = shape.bbox.h * pageH;
      const lineW = Math.max(0.5, (shape.strokeWidth / 720) * pageH);
      if (shape.kind === "line") {
        const top = pageH - syTop;
        const bottom = pageH - (syTop + sh2);
        let start = { x: sx, y: top };
        let end = { x: sx + sw, y: bottom };
        if (shape.orientation === "h") {
          const midY = pageH - (syTop + sh2 / 2);
          start = { x: sx, y: midY };
          end = { x: sx + sw, y: midY };
        } else if (shape.orientation === "v") {
          const midX = sx + sw / 2;
          start = { x: midX, y: top };
          end = { x: midX, y: bottom };
        } else if (shape.orientation === "d2") {
          start = { x: sx, y: bottom };
          end = { x: sx + sw, y: top };
        }
        page.drawLine({
          start,
          end,
          thickness: lineW,
          color: hexToRgb(shape.stroke || "#444444"),
        });
      } else {
        page.drawRectangle({
          x: sx,
          y: pageH - (syTop + sh2),
          width: sw,
          height: sh2,
          color: shape.fill ? hexToRgb(shape.fill) : undefined,
          borderColor: shape.stroke ? hexToRgb(shape.stroke) : undefined,
          borderWidth: shape.stroke && shape.strokeWidth > 0 ? lineW : 0,
        });
      }
    }

    for (const block of slide.textBlocks) {
      const font = block.bold ? helvBold : helv;
      const size = Math.max(6, (block.fontSize / 720) * pageH);
      const x = block.bbox.x * pageW;
      // PDF origin is bottom-left; our y is top-down.
      const yTop = block.bbox.y * pageH;
      const color = hexToRgb(block.color);

      const lines = block.text.split("\n");
      let cursorY = pageH - yTop - size;
      const boxW = block.bbox.w * pageW;
      for (const line of lines) {
        let drawX = x;
        if (block.align === "center" || block.align === "right") {
          const tw = font.widthOfTextAtSize(line, size);
          drawX = block.align === "center" ? x + (boxW - tw) / 2 : x + boxW - tw;
        }
        page.drawText(line, {
          x: drawX,
          y: cursorY,
          size,
          font,
          color,
        });
        cursorY -= size * 1.2;
      }
    }
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
