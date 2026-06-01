import { NextRequest, NextResponse } from "next/server";
import { loadDeck, saveDeck } from "@/lib/store";
import { convertSlide } from "@/lib/convert/vision";
import { cleanBackground } from "@/lib/convert/sample";

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
      const { textBlocks, imageElements, shapes } = await convertSlide(slide);
      // Repaint clean containers + paint out baked text so editable text sits
      // on a clean background with no doubling. We deliberately do NOT erase
      // shapes here: erasing dividers/frames cuts through illustrations that
      // cross them. Shapes stay baked into the background (pristine) and are
      // only "lifted" off when the user actually edits/deletes one.
      const original = slide.originalBackground ?? slide.background;
      const { background, blocks: cleaned } = await cleanBackground(
        original,
        textBlocks
      );
      slide.originalBackground = original;
      slide.background = background;
      slide.textBlocks = cleaned;
      slide.imageElements = imageElements;
      // All detected shapes start un-lifted (still shown by the background).
      slide.shapes = shapes.map((sh) => ({ ...sh, lifted: false }));
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
