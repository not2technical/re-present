import { NextRequest, NextResponse } from "next/server";
import { loadDeck } from "@/lib/store";
import { exportPptx } from "@/lib/export/pptx";
import { exportPdf } from "@/lib/export/pdf";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const deckId = searchParams.get("deckId");
    const format = (searchParams.get("format") || "pptx").toLowerCase();
    if (!deckId) return NextResponse.json({ error: "Missing deckId" }, { status: 400 });

    const deck = await loadDeck(deckId);
    if (!deck) return NextResponse.json({ error: "Deck not found" }, { status: 404 });

    const safeTitle = deck.title.replace(/[^a-z0-9_-]+/gi, "_") || "presentation";

    if (format === "pdf") {
      const buf = await exportPdf(deck);
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${safeTitle}.pdf"`,
        },
      });
    }

    const buf = await exportPptx(deck);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${safeTitle}.pptx"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Export failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
