import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { TextBlock } from "../types";

// Sample the background color behind each text block so an editable text box
// can be filled with that color — cleanly covering the baked-in text in the
// original image while remaining fully editable. This eliminates the "double
// text" artifact and tolerates small bounding-box imprecision.
//
// We read a ring of pixels just OUTSIDE the text box (top/bottom/left/right
// margins) to capture the true surrounding background, not the text pixels.

type RGB = { r: number; g: number; b: number };

function toHex({ r, g, b }: RGB): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function dist2(a: RGB, b: RGB): number {
  return (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;
}

// Find the dominant background color of a ring of samples, robust to a
// minority of "outlier" pixels from decorative lines, borders, or grid
// graphics that cross the ring. We greedily cluster samples by color
// proximity and take the largest cluster. The region is treated as a solid
// background ONLY if that cluster covers a strong majority of the ring AND is
// itself tight — otherwise it's a photo/gradient and we leave it untouched.
function dominantColor(samples: RGB[]): string | null {
  if (samples.length < 6) return null;

  const TOL2 = 36 * 36; // colors within ~36/channel are "the same" background
  const clusters: { center: RGB; members: RGB[] }[] = [];
  for (const s of samples) {
    let best: (typeof clusters)[number] | null = null;
    let bestD = Infinity;
    for (const c of clusters) {
      const d = dist2(s, c.center);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best && bestD <= TOL2) {
      best.members.push(s);
      // running mean
      const n = best.members.length;
      best.center = {
        r: best.center.r + (s.r - best.center.r) / n,
        g: best.center.g + (s.g - best.center.g) / n,
        b: best.center.b + (s.b - best.center.b) / n,
      };
    } else {
      clusters.push({ center: { ...s }, members: [s] });
    }
  }

  clusters.sort((a, b) => b.members.length - a.members.length);
  const top = clusters[0];
  const share = top.members.length / samples.length;
  // Require the dominant color to own a clear majority of the ring.
  if (share < 0.6) return null;

  // Average the dominant cluster's members for a clean fill color.
  const m = top.members.reduce(
    (a, s) => ({ r: a.r + s.r, g: a.g + s.g, b: a.b + s.b }),
    { r: 0, g: 0, b: 0 }
  );
  const n = top.members.length;
  return toHex({ r: m.r / n, g: m.g / n, b: m.b / n });
}

function ringPoints(
  bbox: TextBlock["bbox"],
  W: number,
  H: number
): Array<[number, number]> {
  const x0 = bbox.x * W;
  const y0 = bbox.y * H;
  const w = bbox.w * W;
  const h = bbox.h * H;
  const pad = Math.max(2, Math.min(w, h) * 0.12);
  const pts: Array<[number, number]> = [];
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const fx = x0 + (w * i) / steps;
    pts.push([fx, y0 - pad]);
    pts.push([fx, y0 + h + pad]);
  }
  for (let i = 0; i <= steps; i++) {
    const fy = y0 + (h * i) / steps;
    pts.push([x0 - pad, fy]);
    pts.push([x0 + w + pad, fy]);
  }
  return pts;
}

/**
 * Produce a "cleaned" background: for every text block whose surrounding area
 * is a solid color, paint that color over the block's region (slightly
 * expanded to fully cover the original glyphs). This removes the baked-in
 * text so transparent editable text can sit on top with no doubling, while
 * preserving all non-text graphics, photos, and gradients.
 *
 * Returns the cleaned background data URL plus the blocks (unchanged — they
 * stay transparent since the background itself is now clean). Blocks over
 * non-uniform areas (text on photos/gradients) are left untouched.
 */
export async function cleanBackground(
  backgroundDataUrl: string,
  blocks: TextBlock[]
): Promise<{ background: string; blocks: TextBlock[] }> {
  if (!backgroundDataUrl.startsWith("data:") || blocks.length === 0) {
    return { background: backgroundDataUrl, blocks };
  }
  let img;
  try {
    const b64 = backgroundDataUrl.split(",")[1];
    img = await loadImage(Buffer.from(b64, "base64"));
  } catch {
    return { background: backgroundDataUrl, blocks };
  }

  const W = img.width;
  const H = img.height;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  const sampleRing = (bbox: TextBlock["bbox"]): string | null => {
    const out: RGB[] = [];
    for (const [px, py] of ringPoints(bbox, W, H)) {
      const cx = Math.max(0, Math.min(W - 1, Math.round(px)));
      const cy = Math.max(0, Math.min(H - 1, Math.round(py)));
      const d = ctx.getImageData(cx, cy, 1, 1).data;
      if (d[3] === 0) continue;
      out.push({ r: d[0], g: d[1], b: d[2] });
    }
    return dominantColor(out);
  };

  // Paint over each block region with the sampled solid color.
  for (const b of blocks) {
    const solid = b.fill ?? sampleRing(b.bbox);
    if (!solid) continue; // non-uniform background -> leave original pixels
    // Expand the painted rect to fully cover original glyphs that may extend
    // past the model's tight bbox. Large text needs more headroom (the model
    // tends to underestimate height, and ascenders/descenders grow with font
    // size). Because the fill is the sampled local background color, generous
    // padding does not create a visible rectangle on uniform regions.
    const fontPx = (b.fontSize / 720) * H;
    const padX = b.bbox.w * W * 0.06 + fontPx * 0.25 + 3;
    const padY = Math.max(b.bbox.h * H * 0.35, fontPx * 0.7) + 3;
    const x = Math.max(0, b.bbox.x * W - padX);
    const y = Math.max(0, b.bbox.y * H - padY);
    const w = Math.min(W - x, b.bbox.w * W + padX * 2);
    const h = Math.min(H - y, b.bbox.h * H + padY * 2);
    ctx.fillStyle = solid;
    ctx.fillRect(x, y, w, h);
  }

  const png = canvas.toBuffer("image/png");
  const cleaned = `data:image/png;base64,${png.toString("base64")}`;
  // Text boxes stay transparent (fill cleared) — the background is now clean.
  const cleanedBlocks = blocks.map((b) => ({ ...b, fill: null }));
  return { background: cleaned, blocks: cleanedBlocks };
}
