import { NextRequest, NextResponse } from "next/server";
import { ingestFile, ingestLink } from "@/lib/ingest";
import { saveDeck } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") ?? "";

    let result;
    if (contentType.includes("application/json")) {
      const body = await req.json();
      const url: string | undefined = body.url;
      if (!url) {
        return NextResponse.json({ error: "Missing 'url'." }, { status: 400 });
      }
      result = await ingestLink(url);
    } else {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "Missing 'file'." }, { status: 400 });
      }
      const buf = Buffer.from(await file.arrayBuffer());
      result = await ingestFile(buf, file.name);
    }

    await saveDeck(result.deck);

    // Return a lightweight deck summary (omit heavy backgrounds in list view,
    // but we keep them here since the editor loads the full deck next).
    return NextResponse.json({
      deckId: result.deck.id,
      title: result.deck.title,
      source: result.deck.source,
      slideCount: result.deck.slides.length,
      warnings: result.warnings,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ingestion failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
