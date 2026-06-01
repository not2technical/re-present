import { v4 as uuid } from "uuid";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import type { Slide, TextBlock } from "../types";

// Markdown presentations: split on lines containing only `---` (Marp/reveal
// convention). Each chunk becomes a slide. Text is already editable, so we
// pre-populate text blocks AND render a matching background image.

const W = 1280;
const H = 720;

type Line = { text: string; size: number; bold: boolean };

function parseSlideLines(md: string): Line[] {
  const lines: Line[] = [];
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (line.startsWith("### ")) {
      lines.push({ text: line.slice(4), size: 30, bold: true });
    } else if (line.startsWith("## ")) {
      lines.push({ text: line.slice(3), size: 40, bold: true });
    } else if (line.startsWith("# ")) {
      lines.push({ text: line.slice(2), size: 56, bold: true });
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      lines.push({ text: "•  " + line.slice(2), size: 28, bold: false });
    } else {
      lines.push({ text: line.replace(/[*_`#>]/g, ""), size: 28, bold: false });
    }
  }
  return lines;
}

export async function ingestMarkdown(
  md: string
): Promise<{ slides: Slide[]; aspect: number; warnings: string[] }> {
  const chunks = md
    .split(/^\s*---\s*$/m)
    .map((c) => c.trim())
    .filter(Boolean);
  const slideChunks = chunks.length ? chunks : [md];

  const slides: Slide[] = [];
  for (let i = 0; i < slideChunks.length; i++) {
    const lines = parseSlideLines(slideChunks[i]);
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#1a1a1a";
    ctx.textBaseline = "top";

    const textBlocks: TextBlock[] = [];
    const padX = 80;
    let y = 80;
    for (const ln of lines) {
      const family = GlobalFonts.has("Arial") ? "Arial" : "sans-serif";
      ctx.font = `${ln.bold ? "bold " : ""}${ln.size}px ${family}`;
      ctx.fillText(ln.text, padX, y);
      textBlocks.push({
        id: uuid(),
        text: ln.text,
        bbox: { x: padX / W, y: y / H, w: (W - padX * 2) / W, h: (ln.size * 1.4) / H },
        fontSize: ln.size * (720 / H),
        fontFamily: "Arial",
        bold: ln.bold,
        italic: false,
        underline: false,
        color: "#1a1a1a",
        align: "left",
        fill: null,
      });
      y += ln.size * 1.6;
      if (y > H - 60) break;
    }

    const png = canvas.toBuffer("image/png");
    slides.push({
      id: uuid(),
      index: i,
      background: `data:image/png;base64,${png.toString("base64")}`,
      width: W,
      height: H,
      textBlocks,
      sourceText: slideChunks[i],
      // Markdown is already editable — no vision pass required.
      converted: true,
    });
  }

  return { slides, aspect: W / H, warnings: [] };
}
