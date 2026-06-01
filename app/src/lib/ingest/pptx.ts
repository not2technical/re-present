import JSZip from "jszip";
import { v4 as uuid } from "uuid";
import type { Slide } from "../types";

// EMU (English Metric Units) per inch / point. PPTX positions use EMU.
const EMU_PER_PX = 9525; // 1px @ 96dpi

type ParsedSlide = {
  fileName: string;
  num: number;
  xml: string;
  rels: Record<string, string>; // rId -> target path
};

function sortByNum(a: { num: number }, b: { num: number }) {
  return a.num - b.num;
}

// Extract <a:t> text runs in document order from slide XML.
function extractText(xml: string): string {
  const matches = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)];
  return matches
    .map((m) => decodeXml(m[1]))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// Find the first/primary embedded image reference on a slide.
function findImageRel(xml: string): string | null {
  const m = xml.match(/<a:blip[^>]*r:embed="([^"]+)"/);
  return m ? m[1] : null;
}

function mimeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "bmp") return "image/bmp";
  if (ext === "svg") return "image/svg+xml";
  return "image/png";
}

/**
 * Parse a PPTX into Slides. For image-only decks (the common "flattened
 * export" case), each slide's full-bleed image is extracted directly,
 * giving pixel-perfect backgrounds with no rendering step required.
 */
export async function ingestPptx(buf: Buffer): Promise<{
  slides: Slide[];
  aspect: number;
  warnings: string[];
}> {
  const zip = await JSZip.loadAsync(buf);
  const warnings: string[] = [];

  // Presentation size from presentation.xml (<p:sldSz cx cy>).
  let slideW = 12192000;
  let slideH = 6858000;
  const presXml = await zip.file("ppt/presentation.xml")?.async("string");
  if (presXml) {
    const m = presXml.match(/<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/);
    if (m) {
      slideW = parseInt(m[1], 10);
      slideH = parseInt(m[2], 10);
    }
  }
  const aspect = slideW / slideH;

  // Collect slide files.
  const slideFiles = Object.keys(zip.files).filter((p) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(p)
  );
  if (slideFiles.length === 0) {
    throw new Error("No slides found in PPTX");
  }

  const parsed: ParsedSlide[] = [];
  for (const fileName of slideFiles) {
    const num = parseInt(fileName.match(/slide(\d+)\.xml$/)![1], 10);
    const xml = (await zip.file(fileName)!.async("string")) ?? "";
    // Read the rels file mapping rId -> media target.
    const relsPath = `ppt/slides/_rels/${fileName.split("/").pop()}.rels`;
    const relsXml = await zip.file(relsPath)?.async("string");
    const rels: Record<string, string> = {};
    if (relsXml) {
      for (const r of relsXml.matchAll(
        /<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g
      )) {
        rels[r[1]] = r[2];
      }
    }
    parsed.push({ fileName, num, xml, rels });
  }
  parsed.sort(sortByNum);

  const slides: Slide[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i];
    const sourceText = extractText(p.xml);

    let background = "";
    let width = Math.round(slideW / EMU_PER_PX);
    let height = Math.round(slideH / EMU_PER_PX);

    const rId = findImageRel(p.xml);
    if (rId && p.rels[rId]) {
      // Resolve relative target (e.g. "../media/image1.png").
      const target = p.rels[rId].replace(/^\.\.\//, "ppt/");
      const mediaPath = target.startsWith("ppt/")
        ? target
        : `ppt/${target}`;
      const file = zip.file(mediaPath) ?? zip.file(target);
      if (file) {
        const data = await file.async("base64");
        background = `data:${mimeFor(mediaPath)};base64,${data}`;
      }
    }

    if (!background) {
      warnings.push(
        `Slide ${p.num} has no full-bleed image; will need rasterization.`
      );
    }

    slides.push({
      id: uuid(),
      index: i,
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
