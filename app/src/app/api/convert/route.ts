import { NextRequest, NextResponse } from "next/server";
import { loadDeck, saveDeck } from "@/lib/store";
import { convertSlide } from "@/lib/convert/vision";

export const runtime = "nodejs";
export const maxDuration = 300;

// Convert one slide (by index) or all remaining slides. Converting one at a
// time lets the UI show progress and keeps each request within timeout.
export async function POST(req: NextRequest) {
  try {
    const { deckId, slideIndex } = (await req.json()) as {
      deckId: string;
      slideIndex?: number;
    };
    const deck = await loadDeck(deckId);
    if (!deck) return NextResponse.json({ error: "Deck not found" }, { status: 404 });

    const targets =
      typeof slideIndex === "number"
        ? deck.slides.filter((s) => s.index === slideIndex)
        : deck.slides.filter((s) => !s.converted);

    for (const slide of targets) {
      const blocks = await convertSlide(slide);
      slide.textBlocks = blocks;
      slide.converted = true;
    }

    await saveDeck(deck);

    return NextResponse.json({
      converted: targets.map((s) => s.index),
      remaining: deck.slides.filter((s) => !s.converted).length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Conversion failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
