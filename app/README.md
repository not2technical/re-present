# re·present

Turn **flattened, image-only presentations** back into **fully editable** ones.

Many decks — exported Google Slides, PDF presentations, "save as picture" PowerPoints — are just a single full-bleed image per slide with no editable text. re·present rebuilds the editable layer: it keeps the original rendered slide as a pixel-perfect background and overlays accurately-positioned, restyle-able text boxes extracted with Claude vision. You can then edit and export to native **PPTX** or **PDF**.

## What it does

1. **Ingest** — upload a `.pptx`, `.pdf`, or `.md` file, or paste a **Google Slides** / file URL.
   - PPTX: embedded slide images are extracted directly (perfect fidelity).
   - PDF: each page is rendered to an image with `pdfjs-dist` (no system poppler needed).
   - Google Slides: exported to PDF, then rendered.
   - Markdown: split on `---`; already-editable text is laid out and rendered.
2. **Make editable** — for each image-only slide, Claude vision extracts every text element (content, bounding box, font size/weight/color/alignment, background chips) into a structured slide model.
3. **Edit** — a canvas editor renders the background image with draggable/resizable text boxes. Change text, font, size, color, alignment, fill; add or delete boxes.
4. **Export** — download a native **PPTX** (real, editable `<a:t>` text runs over the background image) or a **PDF**.

## Running locally

```bash
cp .env.example .env.local      # add your ANTHROPIC_API_KEY
npm install
npm run dev                     # http://localhost:3000
```

Build for production / self-hosting:

```bash
npm run build && npm start
```

The app is a standard Next.js (App Router) project and runs anywhere Node 18+ is available — locally, on a VM, or on a serverless host. Conversion calls the Claude API; everything else (ingestion, rendering, export) runs in-process.

## Configuration

| Variable            | Required | Default            | Purpose                                   |
| ------------------- | -------- | ------------------ | ----------------------------------------- |
| `ANTHROPIC_API_KEY` | yes      | —                  | Claude API key for vision conversion.     |
| `CLAUDE_MODEL`      | no       | `claude-opus-4-8`  | Model for conversion (`claude-sonnet-4-6` is faster/cheaper). |

## How accuracy is achieved

- **Visual fidelity:** the rendered slide is preserved as a background image, so all non-text graphics (shapes, charts, photos, gradients, logos) look identical to the source.
- **Clean editable text:** after Claude vision extracts each text element, re·present *inpaints* the background — sampling the solid color around each text region and painting over the baked-in glyphs — then places transparent, editable text on top. This removes the "double text" you'd otherwise get from overlaying new text on the original. Text on photos/gradients (non-uniform backgrounds) is left untouched and can be edited or deleted manually.
- **Exact positioning:** text blocks use normalized 0–1 coordinates that map precisely onto the slide in both the editor and exports.
- **Cost/latency:** the vision system prompt is prompt-cached across slides. Set `CLAUDE_MODEL=claude-sonnet-4-6` for faster, cheaper conversion.
- The untouched original render is kept on each slide (`originalBackground`) for comparison/restore. If conversion is unavailable, harvested source text is laid out as a fallback so the slide is still editable.

## Architecture

```
src/
  lib/
    types.ts            Deck / Slide / TextBlock model
    ingest/             pptx, pdf, markdown, link -> normalized slide images
    convert/vision.ts   Claude vision -> structured editable text blocks
    export/             pptx (pptxgenjs), pdf (pdf-lib)
    store.ts            temp-file deck persistence (no DB required)
  app/
    page.tsx            upload / link landing
    editor/[id]/        canvas editor (background + react-rnd text boxes)
    api/
      ingest/           POST file or { url }
      convert/          POST { deckId, slideIndex? } -> run vision
      deck/[id]/        GET / PUT deck
      export/           GET ?deckId=&format=pptx|pdf
```
