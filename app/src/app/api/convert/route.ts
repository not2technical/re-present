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
      // Erase detected shapes + repaint clean containers + paint out baked text
      // so editable layers sit on a clean background with no doubling. Keep the
      // original for compare/restore.
      const original = slide.originalBackground ?? slide.background;
      const { background, blocks: cleaned } = await cleanBackground(
        original,
        textBlocks,
        shapes
      );
      // Large panels keep their geometry/border editable but drop their fill:
      // the cleaned background still shows that fill (we only erased borders),
      // and a solid fill drawn on export would hide illustrations layered on
      // top of the panel. Small chips keep their fill.
      const adjustedShapes = shapes.map((sh) => {
        const isLargePanel =
          sh.kind === "rect" && (sh.bbox.w > 0.25 || sh.bbox.h > 0.25);
        return isLargePanel ? { ...sh, fill: null } : sh;
      });

      slide.originalBackground = original;
      slide.background = background;
      slide.textBlocks = cleaned;
      slide.imageElements = imageElements;
      slide.shapes = adjustedShapes;
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
