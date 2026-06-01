import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import type { TextBlock, Container, Bbox, Shape } from "../types";

// Background reconstruction for re-present.
//
// After Claude vision extracts text + containers, we produce a "cleaned"
// background image where the baked-in text (and the box it sat in) is removed,
// then we REPAINT a crisp container so the editable text can sit on top with
// no doubling. Three strategies, chosen per text block:
//
//   1. Block has a container  -> paint out the whole container region, then
//      redraw a clean box (fill/border/glow/radius) from vision's description.
//   2. No container, uniform surrounding color -> flat-fill the text region
//      with the sampled color.
//   3. No container, textured surrounding -> glyph-level inpaint (remove only
//      strokes + halo, diffuse the surrounding graphic back in).

type RGB = { r: number; g: number; b: number };

function toHex({ r, g, b }: RGB): string {
  const h = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const s = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return {
    r: parseInt(s.slice(0, 2), 16) || 0,
    g: parseInt(s.slice(2, 4), 16) || 0,
    b: parseInt(s.slice(4, 6), 16) || 0,
  };
}

function dist2(a: RGB, b: RGB): number {
  return (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;
}

// ---------- dominant-color sampling (for uniform backgrounds) ----------

// Find the dominant color of a set of samples, robust to a minority of outlier
// pixels (decorative lines/borders crossing the sample ring). Returns null if
// no color owns a clear majority (i.e. the area is textured/gradient).
function dominantColor(samples: RGB[]): string | null {
  if (samples.length < 6) return null;
  const TOL2 = 36 * 36;
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
  if (top.members.length / samples.length < 0.6) return null;
  const m = top.members.reduce(
    (a, s) => ({ r: a.r + s.r, g: a.g + s.g, b: a.b + s.b }),
    { r: 0, g: 0, b: 0 }
  );
  const n = top.members.length;
  return toHex({ r: m.r / n, g: m.g / n, b: m.b / n });
}

function ringPoints(bbox: Bbox, W: number, H: number): Array<[number, number]> {
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

// ---------- diffusion inpainting (for textured backgrounds) ----------

function dilate(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  if (radius <= 0) return mask;
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          out[ny * w + nx] = 1;
        }
      }
    }
  }
  return out;
}

function diffusionFill(
  data: Uint8ClampedArray,
  mask: Uint8Array,
  w: number,
  h: number
): void {
  const known = Uint8Array.from(mask, (m) => (m ? 0 : 1));
  for (let pass = 0; pass < 64; pass++) {
    const idxs: number[] = [];
    const rr: number[] = [];
    const gg: number[] = [];
    const bb: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (known[idx]) continue;
        let sr = 0, sg = 0, sb = 0, cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            if (nx < 0 || nx >= w) continue;
            const nIdx = ny * w + nx;
            if (!known[nIdx]) continue;
            const p = nIdx * 4;
            sr += data[p];
            sg += data[p + 1];
            sb += data[p + 2];
            cnt++;
          }
        }
        if (cnt > 0) {
          idxs.push(idx);
          rr.push(sr / cnt);
          gg.push(sg / cnt);
          bb.push(sb / cnt);
        }
      }
    }
    if (idxs.length === 0) break;
    for (let i = 0; i < idxs.length; i++) {
      const p = idxs[i] * 4;
      data[p] = rr[i];
      data[p + 1] = gg[i];
      data[p + 2] = bb[i];
      known[idxs[i]] = 1;
    }
  }
}

// Remove baked text strokes from a region by masking pixels matching the
// extracted text color (interior only, to protect box borders), rejecting long
// line-runs, dilating to catch the halo, then diffusion-filling.
function inpaintGlyphs(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  textColor: RGB
): void {
  if (w <= 0 || h <= 0) return;
  const region = ctx.getImageData(x, y, w, h);
  const data = region.data;
  const n = w * h;
  const mask = new Uint8Array(n);
  const TOL2 = 72 * 72;
  const marginX = Math.max(2, Math.round(w * 0.05));
  const marginY = Math.max(2, Math.round(h * 0.12));

  for (let yy = marginY; yy < h - marginY; yy++) {
    for (let xx = marginX; xx < w - marginX; xx++) {
      const i = yy * w + xx;
      const p = i * 4;
      const dr = data[p] - textColor.r;
      const dg = data[p + 1] - textColor.g;
      const db = data[p + 2] - textColor.b;
      if (dr * dr + dg * dg + db * db <= TOL2) mask[i] = 1;
    }
  }
  // Reject border/divider lines (long runs).
  for (let yy = 0; yy < h; yy++) {
    let c = 0;
    for (let xx = 0; xx < w; xx++) c += mask[yy * w + xx];
    if (c > w * 0.7) for (let xx = 0; xx < w; xx++) mask[yy * w + xx] = 0;
  }
  for (let xx = 0; xx < w; xx++) {
    let c = 0;
    for (let yy = 0; yy < h; yy++) c += mask[yy * w + xx];
    if (c > h * 0.7) for (let yy = 0; yy < h; yy++) mask[yy * w + xx] = 0;
  }
  const radius = Math.max(1, Math.round(Math.min(w, h) * 0.015));
  const grown = dilate(mask, w, h, radius);
  let count = 0;
  for (let i = 0; i < n; i++) count += grown[i];
  if (count === 0 || count > n * 0.45) return;
  diffusionFill(data, grown, w, h);
  ctx.putImageData(region, x, y);
}

// ---------- container repaint ----------

function roundRectPath(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

// First erase the original container+text region (so nothing shows through),
// then repaint a clean box per vision's description.
function repaintContainer(
  ctx: SKRSContext2D,
  c: Container,
  textColor: RGB,
  W: number,
  H: number
): void {
  const bx = c.bbox.x * W;
  const by = c.bbox.y * H;
  const bw = c.bbox.w * W;
  const bh = c.bbox.h * H;
  const radius = (c.radius / 720) * H;
  const border = (c.borderWidth / 720) * H;

  // 1. Erase the original region. Inpaint a small margin around the box so the
  //    old border/glow blends away, then we draw fresh on top.
  const pad = Math.max(4, border + radius * 0.5 + Math.min(bw, bh) * 0.06);
  const ex = Math.max(0, Math.floor(bx - pad));
  const ey = Math.max(0, Math.floor(by - pad));
  const ew = Math.min(W - ex, Math.ceil(bw + pad * 2));
  const eh = Math.min(H - ey, Math.ceil(bh + pad * 2));
  inpaintGlyphs(ctx, ex, ey, ew, eh, textColor);

  // 2. Glow: a soft outer halo (drawn as a blurred stroke).
  if (c.glow) {
    ctx.save();
    ctx.shadowColor = c.glow;
    ctx.shadowBlur = Math.max(6, border * 4 + radius * 0.6);
    ctx.lineWidth = Math.max(1.5, border || 2);
    ctx.strokeStyle = c.glow;
    roundRectPath(ctx, bx, by, bw, bh, radius);
    ctx.stroke();
    ctx.restore();
  }

  // 3. Interior fill.
  if (c.fill) {
    ctx.fillStyle = c.fill;
    roundRectPath(ctx, bx, by, bw, bh, radius);
    ctx.fill();
  }

  // 4. Crisp border on top.
  if (c.borderColor && border > 0) {
    ctx.lineWidth = border;
    ctx.strokeStyle = c.borderColor;
    roundRectPath(ctx, bx, by, bw, bh, radius);
    ctx.stroke();
  }
}

// Erase a shape from the background. For a filled rect/panel we fill its area
// (plus a small margin) with the surrounding color; for a thin line/divider we
// fill a band along it. If the surroundings aren't a uniform color, we
// diffusion-inpaint instead so textured backgrounds reconstruct.
function eraseRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  sampleRing: (bbox: Bbox) => string | null,
  bboxForSample: Bbox
): void {
  if (w <= 0 || h <= 0) return;
  const color = sampleRing(bboxForSample);
  if (color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  } else {
    const region = ctx.getImageData(x, y, w, h);
    const mask = new Uint8Array(w * h).fill(1);
    for (let xx = 0; xx < w; xx++) {
      mask[xx] = 0;
      mask[(h - 1) * w + xx] = 0;
    }
    for (let yy = 0; yy < h; yy++) {
      mask[yy * w] = 0;
      mask[yy * w + (w - 1)] = 0;
    }
    diffusionFill(region.data, mask, w, h);
    ctx.putImageData(region, x, y);
  }
}

function eraseShape(
  ctx: SKRSContext2D,
  sh: Shape,
  W: number,
  H: number,
  sampleRing: (bbox: Bbox) => string | null
): void {
  const stroke = Math.max(1, (sh.strokeWidth / 720) * H);
  const bx = sh.bbox.x * W;
  const by = sh.bbox.y * H;
  const bw = sh.bbox.w * W;
  const bh = sh.bbox.h * H;

  // A rect that is large relative to the slide is a PANEL holding other content
  // (text/illustrations). We must NOT erase its interior or we destroy that
  // content; the repainted editable shape sits behind everything and its fill
  // is visually identical to the background we'd leave anyway. So for any rect
  // (filled or outlined) we only erase the thin BORDER bands to avoid doubling
  // the stroke. Small solid rects (chips) still get a full erase.
  const isLargePanel =
    sh.kind === "rect" && (sh.bbox.w > 0.25 || sh.bbox.h > 0.25);
  const bordersOnly =
    sh.kind === "rect" && (isLargePanel || (!sh.fill && !!sh.stroke));
  if (sh.kind === "line" || bordersOnly) {
    const band = stroke + Math.max(3, stroke); // generous to catch glow/AA
    if (sh.kind === "rect") {
      // top, bottom, left, right bands around the frame
      const segs: Array<[number, number, number, number, Bbox]> = [
        [bx - band, by - band, bw + band * 2, band * 2, { x: sh.bbox.x, y: sh.bbox.y - 0.02, w: sh.bbox.w, h: 0.02 }],
        [bx - band, by + bh - band, bw + band * 2, band * 2, { x: sh.bbox.x, y: sh.bbox.y + sh.bbox.h, w: sh.bbox.w, h: 0.02 }],
        [bx - band, by - band, band * 2, bh + band * 2, { x: sh.bbox.x - 0.02, y: sh.bbox.y, w: 0.02, h: sh.bbox.h }],
        [bx + bw - band, by - band, band * 2, bh + band * 2, { x: sh.bbox.x + sh.bbox.w, y: sh.bbox.y, w: 0.02, h: sh.bbox.h }],
      ];
      for (const [sx, sy, sw, sh2, ring] of segs) {
        const x = Math.max(0, Math.floor(sx));
        const y = Math.max(0, Math.floor(sy));
        const ww = Math.min(W - x, Math.ceil(sw));
        const hh = Math.min(H - y, Math.ceil(sh2));
        eraseRect(ctx, x, y, ww, hh, sampleRing, ring);
      }
    } else {
      // A line: erase a band along its bbox (bbox is already thin in one axis).
      const pad = band;
      const x = Math.max(0, Math.floor(bx - pad));
      const y = Math.max(0, Math.floor(by - pad));
      const ww = Math.min(W - x, Math.ceil(bw + pad * 2));
      const hh = Math.min(H - y, Math.ceil(bh + pad * 2));
      eraseRect(ctx, x, y, ww, hh, sampleRing, sh.bbox);
    }
    return;
  }

  // Filled rect/panel: erase the whole region (plus margin).
  const pad = Math.max(2, stroke + Math.min(bw, bh) * 0.04);
  const x = Math.max(0, Math.floor(bx - pad));
  const y = Math.max(0, Math.floor(by - pad));
  const w = Math.min(W - x, Math.ceil(bw + pad * 2));
  const h = Math.min(H - y, Math.ceil(bh + pad * 2));
  eraseRect(ctx, x, y, w, h, sampleRing, sh.bbox);
}

// ---------- main entry ----------

export async function cleanBackground(
  backgroundDataUrl: string,
  blocks: TextBlock[],
  shapes: Shape[] = []
): Promise<{ background: string; blocks: TextBlock[] }> {
  if (!backgroundDataUrl.startsWith("data:") || (blocks.length === 0 && shapes.length === 0)) {
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

  const sampleRing = (bbox: Bbox): string | null => {
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

  // 0. Erase detected shapes from the background so they become editable
  //    overlays without doubling. Fill each shape's region from the color just
  //    outside it (so panels/dividers vanish into the surrounding background).
  for (const sh of shapes) {
    eraseShape(ctx, sh, W, H, sampleRing);
  }

  // Process containers first (they erase larger regions), then plain text.
  const withContainer = blocks.filter((b) => b.container);
  const plain = blocks.filter((b) => !b.container);

  for (const b of withContainer) {
    repaintContainer(ctx, b.container!, hexToRgb(b.color), W, H);
  }

  for (const b of plain) {
    const fontPx = (b.fontSize / 720) * H;
    const padX = b.bbox.w * W * 0.06 + fontPx * 0.25 + 3;
    const padY = Math.max(b.bbox.h * H * 0.35, fontPx * 0.7) + 3;
    const x = Math.max(0, Math.floor(b.bbox.x * W - padX));
    const y = Math.max(0, Math.floor(b.bbox.y * H - padY));
    const w = Math.min(W - x, Math.ceil(b.bbox.w * W + padX * 2));
    const h = Math.min(H - y, Math.ceil(b.bbox.h * H + padY * 2));
    if (w <= 0 || h <= 0) continue;

    const solid = b.fill ?? sampleRing(b.bbox);
    if (solid) {
      ctx.fillStyle = solid;
      ctx.fillRect(x, y, w, h);
    } else {
      inpaintGlyphs(ctx, x, y, w, h, hexToRgb(b.color));
    }
  }

  const png = canvas.toBuffer("image/png");
  const cleaned = `data:image/png;base64,${png.toString("base64")}`;
  // Containers are now baked into the cleaned background, so clear them from
  // the editable blocks (text renders transparent on top of the repainted box).
  const cleanedBlocks = blocks.map((b) => ({ ...b, fill: null, container: null }));
  return { background: cleaned, blocks: cleanedBlocks };
}

// Remove an image element region from a background, filling with its sampled
// color (or diffusion-fill from neighbors if textured). Used by the editor's
// "delete image" action via the /api/deck PUT or a dedicated endpoint.
export async function removeImageRegion(
  backgroundDataUrl: string,
  bbox: Bbox,
  fillColor: string | null
): Promise<string> {
  if (!backgroundDataUrl.startsWith("data:")) return backgroundDataUrl;
  let img;
  try {
    img = await loadImage(Buffer.from(backgroundDataUrl.split(",")[1], "base64"));
  } catch {
    return backgroundDataUrl;
  }
  const W = img.width;
  const H = img.height;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  const x = Math.max(0, Math.floor(bbox.x * W));
  const y = Math.max(0, Math.floor(bbox.y * H));
  const w = Math.min(W - x, Math.ceil(bbox.w * W));
  const h = Math.min(H - y, Math.ceil(bbox.h * H));
  if (w <= 0 || h <= 0) return backgroundDataUrl;

  const color = fillColor
    ? fillColor
    : // sample the ring around the region
      dominantColor(
        ringPoints(bbox, W, H).map(([px, py]) => {
          const cx = Math.max(0, Math.min(W - 1, Math.round(px)));
          const cy = Math.max(0, Math.min(H - 1, Math.round(py)));
          const d = ctx.getImageData(cx, cy, 1, 1).data;
          return { r: d[0], g: d[1], b: d[2] };
        })
      );

  if (color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  } else {
    // Textured surroundings: mask the whole region and diffuse neighbors in.
    const region = ctx.getImageData(x, y, w, h);
    const mask = new Uint8Array(w * h).fill(1);
    // Keep a 1px ring known so diffusion has a seed.
    for (let xx = 0; xx < w; xx++) {
      mask[xx] = 0;
      mask[(h - 1) * w + xx] = 0;
    }
    for (let yy = 0; yy < h; yy++) {
      mask[yy * w] = 0;
      mask[yy * w + (w - 1)] = 0;
    }
    diffusionFill(region.data, mask, w, h);
    ctx.putImageData(region, x, y);
  }

  const png = canvas.toBuffer("image/png");
  return `data:image/png;base64,${png.toString("base64")}`;
}
