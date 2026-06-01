// Core data model for re-present.
// A Deck is the editable representation of an uploaded presentation.
// Every input format is normalized into this shape.

export type Bbox = {
  // Normalized 0..1 coordinates relative to the slide dimensions.
  x: number;
  y: number;
  w: number;
  h: number;
};

// A visual container the text sits inside (a chip, button, glow box, callout).
// Captured so we can REPAINT a clean version over the baked original — removing
// the original text without smearing the box — and re-render it crisply.
export type Container = {
  // Box geometry, normalized 0..1. Usually slightly larger than the text bbox.
  bbox: Bbox;
  fill: string | null; // interior color, null = transparent (text only)
  borderColor: string | null;
  borderWidth: number; // px relative to source height; 0 = none
  radius: number; // corner radius in px relative to source height
  // Soft outer glow color (e.g. neon UI). null = none.
  glow: string | null;
};

export type TextBlock = {
  id: string;
  text: string;
  bbox: Bbox;
  fontSize: number; // points, relative to a 720pt-tall slide
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string; // hex like #1a1a1a
  align: "left" | "center" | "right";
  // Optional fill behind the text (for chips/labels). null = transparent.
  fill: string | null;
  // Optional container (box/chip/glow) the text lives in. Repainted on the
  // cleaned background and re-rendered in editor/export for crisp fidelity.
  container?: Container | null;
};

// A non-text image/graphic region the user may remove in the editor.
export type ImageElement = {
  id: string;
  bbox: Bbox;
  // What to paint when the user removes it: sampled surrounding color, or
  // null to diffusion-fill from neighbors.
  fillColor: string | null;
  label?: string; // short description from vision (e.g. "robot mascot")
};

// A geometric vector shape (rectangle, divider line, panel outline) lifted off
// the flattened background into an editable overlay object. The user can move,
// resize, recolor, or delete it; export renders it as a real shape.
export type Shape = {
  id: string;
  kind: "rect" | "line";
  bbox: Bbox; // for "line", treat as the bounding box of the segment
  fill: string | null; // interior color, null = transparent (outline/line only)
  stroke: string | null; // border / line color
  strokeWidth: number; // px on a 720px-tall slide; 0 = none
  radius: number; // corner radius px (rect only)
  // For lines: which diagonal of the bbox the segment runs along.
  // "h" horizontal, "v" vertical, "d1" top-left→bottom-right, "d2" top-right→bottom-left.
  orientation?: "h" | "v" | "d1" | "d2";
  label?: string;
  // false = still baked into the background image (shown there, pristine).
  // true  = "lifted": its footprint has been erased from the background and it
  //         is now an independent overlay object drawn on export. Shapes are
  //         only lifted when the user edits or deletes them, so untouched
  //         slides keep their original art intact (no bands cutting images).
  lifted?: boolean;
};

export type Slide = {
  id: string;
  index: number;
  // Background is the rendered image the editor/export draws (data URL).
  // After conversion this is the "cleaned" image (baked text painted out on
  // solid regions); editable text sits on top. Keeping it guarantees visual
  // fidelity for all non-text graphics.
  background: string;
  // The untouched original render, kept so the user can restore or compare.
  originalBackground?: string;
  width: number; // pixels of the source image
  height: number;
  textBlocks: TextBlock[];
  // Removable non-text graphic regions detected by vision.
  imageElements?: ImageElement[];
  // Editable geometric shapes lifted off the background.
  shapes?: Shape[];
  // Raw text harvested directly from the source (if any), used as a hint
  // and as a fallback when vision is unavailable.
  sourceText?: string;
  // Conversion status for this slide.
  converted: boolean;
};

export type Deck = {
  id: string;
  title: string;
  source: "pptx" | "pdf" | "markdown" | "google-slides" | "url";
  slides: Slide[];
  // Aspect ratio of the deck (width/height) inferred from slides.
  aspect: number;
  createdAt: string;
};

export type IngestResult = {
  deck: Deck;
  warnings: string[];
};
