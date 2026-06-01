import { v4 as uuid } from "uuid";
import type { Deck, IngestResult } from "../types";
import { ingestPptx } from "./pptx";
import { ingestPdf } from "./pdf";
import { ingestMarkdown } from "./markdown";
import { fetchPresentationLink } from "./link";

export type InputKind = "pptx" | "pdf" | "markdown" | "google-slides" | "url";

function inferKind(filename: string): InputKind {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pptx") || lower.endsWith(".ppt")) return "pptx";
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  return "pdf";
}

export async function ingestFile(
  buf: Buffer,
  filename: string
): Promise<IngestResult> {
  const kind = inferKind(filename);
  const title = filename.replace(/\.[^.]+$/, "");
  // inferKind only ever returns a concrete file kind (pptx/pdf/markdown).
  return buildDeck(buf, kind as "pptx" | "pdf" | "markdown", title, kind);
}

export async function ingestLink(url: string): Promise<IngestResult> {
  const fetched = await fetchPresentationLink(url);
  const source: InputKind = url.includes("docs.google.com")
    ? "google-slides"
    : "url";
  return buildDeck(fetched.buffer, fetched.kind, fetched.title, source);
}

async function buildDeck(
  buf: Buffer,
  kind: "pptx" | "pdf" | "markdown",
  title: string,
  source: Deck["source"]
): Promise<IngestResult> {
  let result: { slides: Deck["slides"]; aspect: number; warnings: string[] };

  if (kind === "pptx") {
    result = await ingestPptx(buf);
    // If the PPTX had no full-bleed images (genuine vector deck), some
    // slides will lack backgrounds. We still proceed; vision step is skipped
    // for those and source text is preserved.
  } else if (kind === "pdf") {
    result = await ingestPdf(buf);
  } else {
    result = await ingestMarkdown(buf.toString("utf8"));
  }

  const deck: Deck = {
    id: uuid(),
    title,
    source,
    slides: result.slides,
    aspect: result.aspect || 16 / 9,
    createdAt: new Date().toISOString(),
  };

  return { deck, warnings: result.warnings };
}
