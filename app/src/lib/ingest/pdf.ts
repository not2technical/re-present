import { v4 as uuid } from "uuid";
import { createCanvas } from "@napi-rs/canvas";
import type { Slide } from "../types";

// Render each PDF page to a PNG data URL using pdfjs-dist in Node.
// Works locally and when hosted without system poppler/ghostscript.
export async function ingestPdf(
  buf: Buffer,
  scale = 2
): Promise<{ slides: Slide[]; aspect: number; warnings: string[] }> {
  const warnings: string[] = [];
  // pdfjs legacy build is the Node-friendly entry point.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const data = new Uint8Array(buf);
  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
  });
  const doc = await loadingTask.promise;

  const slides: Slide[] = [];
  let aspect = 16 / 9;

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);
    if (pageNum === 1) aspect = width / height;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    // White backdrop so transparent PDFs export cleanly.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    await page.render({
      // @napi-rs/canvas objects are compatible with pdfjs' expectations.
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;

    // Harvest text content as a hint for the vision step / fallback.
    let sourceText = "";
    try {
      const tc = await page.getTextContent();
      sourceText = tc.items
        .map((it: unknown) =>
          typeof it === "object" && it && "str" in it
            ? (it as { str: string }).str
            : ""
        )
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    } catch {
      // Scanned/image PDFs have no text layer; that's fine.
    }

    const png = canvas.toBuffer("image/png");
    const background = `data:image/png;base64,${png.toString("base64")}`;

    slides.push({
      id: uuid(),
      index: pageNum - 1,
      background,
      width,
      height,
      textBlocks: [],
      sourceText: sourceText || undefined,
      converted: false,
    });
  }

  return { slides, aspect, warnings };
}
