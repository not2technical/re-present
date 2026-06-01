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
};

export type Slide = {
  id: string;
  index: number;
  // Background is the original rendered image (data URL or stored path).
  // Keeping it guarantees visual fidelity; editable text sits on top.
  background: string;
  width: number; // pixels of the source image
  height: number;
  textBlocks: TextBlock[];
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
