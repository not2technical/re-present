import { NextRequest, NextResponse } from "next/server";
import { loadDeck, saveDeck } from "@/lib/store";
import { liftShapeFromBackground } from "@/lib/convert/sample";
import type { Shape } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

// "Lift" a shape off the background: erase its footprint from the background
// image so the shape becomes an independent editable overlay. Called the first
// time the user edits or deletes a detected shape. Returns the new background.
export async function POST(req: NextRequest) {
  try {
    const { deckId, slideIndex, shapeId } = (await req.json()) as {
      deckId: string;
      slideIndex: number;
      shapeId: string;
    };
    const deck = await loadDeck(deckId);
    if (!deck) return NextResponse.json({ error: "Deck not found" }, { status: 404 });
    const slide = deck.slides.find((s) => s.index === slideIndex);
    if (!slide) return NextResponse.json({ error: "Slide not found" }, { status: 404 });
    const shape = slide.shapes?.find((s) => s.id === shapeId);
    if (!shape) return NextResponse.json({ error: "Shape not found" }, { status: 404 });

    if (!shape.lifted) {
      slide.background = await liftShapeFromBackground(slide.background, shape);
      shape.lifted = true;
      await saveDeck(deck);
    }

    return NextResponse.json({ background: slide.background });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lift failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export type { Shape };
