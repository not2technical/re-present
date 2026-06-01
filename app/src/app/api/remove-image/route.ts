import { NextRequest, NextResponse } from "next/server";
import { loadDeck, saveDeck } from "@/lib/store";
import { removeImageRegion } from "@/lib/convert/sample";
import type { Bbox } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

// Remove a non-text image/graphic region from a slide's background, filling the
// hole from the surrounding pixels. Used by the editor's "delete image" action.
export async function POST(req: NextRequest) {
  try {
    const { deckId, slideIndex, elementId, bbox, fillColor } =
      (await req.json()) as {
        deckId: string;
        slideIndex: number;
        elementId?: string;
        bbox?: Bbox;
        fillColor?: string | null;
      };

    const deck = await loadDeck(deckId);
    if (!deck) return NextResponse.json({ error: "Deck not found" }, { status: 404 });
    const slide = deck.slides.find((s) => s.index === slideIndex);
    if (!slide) return NextResponse.json({ error: "Slide not found" }, { status: 404 });

    // Resolve the region: prefer a named element, else an explicit bbox.
    const el = elementId
      ? slide.imageElements?.find((e) => e.id === elementId)
      : undefined;
    const region = el?.bbox ?? bbox;
    if (!region) {
      return NextResponse.json({ error: "No region provided" }, { status: 400 });
    }

    slide.background = await removeImageRegion(
      slide.background,
      region,
      el?.fillColor ?? fillColor ?? null
    );
    // Drop the element from the removable list so it's not re-offered.
    if (el && slide.imageElements) {
      slide.imageElements = slide.imageElements.filter((e) => e.id !== el.id);
    }
    await saveDeck(deck);

    return NextResponse.json({ background: slide.background });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Remove failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
