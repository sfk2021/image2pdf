export type Pt = { x: number; y: number };
// top-left, top-right, bottom-right, bottom-left, each 0..1 of the image
export type Corners = [Pt, Pt, Pt, Pt];
export type FilterId = "original" | "magic" | "gray" | "bw";

export const FILTERS: { id: FilterId; label: string }[] = [
  { id: "original", label: "Original" },
  { id: "magic", label: "Magic color" },
  { id: "gray", label: "Gray" },
  { id: "bw", label: "B&W" },
];

export const fullCorners = (): Corners => [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

export const insetCorners = (m = 0.08): Corners => [
  { x: m, y: m },
  { x: 1 - m, y: m },
  { x: 1 - m, y: 1 - m },
  { x: m, y: 1 - m },
];

/** Load a file into a canvas with EXIF rotation applied, downscaled to maxSide. */
export async function loadSource(
  file: File,
  maxSide: number
): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * s));
  c.height = Math.max(1, Math.round(bmp.height * s));
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

export function canvasToFile(
  c: HTMLCanvasElement,
  name: string,
  quality = 0.9
): Promise<File> {
  return new Promise((resolve, reject) =>
    c.toBlob(
      (b) =>
        b
          ? resolve(new File([b], name, { type: "image/jpeg" }))
          : reject(new Error("Could not encode image")),
      "image/jpeg",
      quality
    )
  );
}

/* ---------- Perspective warp ---------- */

// Gauss-Jordan solve of an n x n system
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  for (let i = 0; i < n; i++) A[i].push(b[i]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    }
    if (Math.abs(A[piv][col]) < 1e-10) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let c = col; c <= n; c++) A[r][c] -= f * A[col][c];
    }
  }
  return A.map((row, i) => row[n] / row[i]);
}

// Maps points in `dst` space to points in `src` space
function homography(dst: Pt[], src: Pt[]): number[] | null {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = dst[i];
    const { x: u, y: v } = src[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  return solve(A, b);
}

function warp(
  src: HTMLCanvasElement,
  corners: Corners,
  maxOut: number
): HTMLCanvasElement {
  const sw = src.width;
  const sh = src.height;
  const P = corners.map((c) => ({ x: c.x * sw, y: c.y * sh }));
  const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

  let ow = Math.max(dist(P[0], P[1]), dist(P[3], P[2]));
  let oh = Math.max(dist(P[0], P[3]), dist(P[1], P[2]));
  const k = Math.min(1, maxOut / Math.max(ow, oh, 1));
  ow = Math.max(2, Math.round(ow * k));
  oh = Math.max(2, Math.round(oh * k));

  const out = document.createElement("canvas");
  out.width = ow;
  out.height = oh;
  const octx = out.getContext("2d")!;

  const H = homography(
    [
      { x: 0, y: 0 },
      { x: ow, y: 0 },
      { x: ow, y: oh },
      { x: 0, y: oh },
    ],
    P
  );
  if (!H) {
    octx.drawImage(src, 0, 0, ow, oh);
    return out;
  }

  const sd = src.getContext("2d")!.getImageData(0, 0, sw, sh).data;
  const od = octx.createImageData(ow, oh);
  const o = od.data;

  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const d = H[6] * px + H[7] * py + 1;
      let u = (H[0] * px + H[1] * py + H[2]) / d - 0.5;
      let v = (H[3] * px + H[4] * py + H[5]) / d - 0.5;
      if (u < 0) u = 0;
      else if (u > sw - 1) u = sw - 1;
      if (v < 0) v = 0;
      else if (v > sh - 1) v = sh - 1;

      const x0 = u | 0;
      const y0 = v | 0;
      const x1 = x0 + 1 < sw ? x0 + 1 : x0;
      const y1 = y0 + 1 < sh ? y0 + 1 : y0;
      const fx = u - x0;
      const fy = v - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      const oi = (y * ow + x) * 4;

      for (let c = 0; c < 3; c++) {
        const top = sd[i00 + c] + (sd[i10 + c] - sd[i00 + c]) * fx;
        const bot = sd[i01 + c] + (sd[i11 + c] - sd[i01 + c]) * fx;
        o[oi + c] = top + (bot - top) * fy;
      }
      o[oi + 3] = 255;
    }
  }
  octx.putImageData(od, 0, 0);
  return out;
}

/* ---------- Filters ---------- */

// Estimates the paper/lighting colour per area (used to remove shadows)
function background(img: ImageData): ImageData {
  const { width: w, height: h, data } = img;
  const f = Math.max(8, Math.round(Math.max(w, h) / 60));
  const bw = Math.ceil(w / f);
  const bh = Math.ceil(h / f);
  const small = new ImageData(bw, bh);

  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const x0 = bx * f;
      const y0 = by * f;
      const x1 = Math.min(w, x0 + f);
      const y1 = Math.min(h, y0 + f);

      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          n++;
        }
      }
      const mean = sum / n;

      // average only the brighter half, so dark text doesn't darken the estimate
      let r = 0;
      let g = 0;
      let b = 0;
      let m = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          if (lum >= mean) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            m++;
          }
        }
      }
      const o = (by * bw + bx) * 4;
      if (m === 0) {
        small.data[o] = small.data[o + 1] = small.data[o + 2] = mean;
      } else {
        small.data[o] = r / m;
        small.data[o + 1] = g / m;
        small.data[o + 2] = b / m;
      }
      small.data[o + 3] = 255;
    }
  }

  const sc = document.createElement("canvas");
  sc.width = bw;
  sc.height = bh;
  sc.getContext("2d")!.putImageData(small, 0, 0);

  const bc = document.createElement("canvas");
  bc.width = w;
  bc.height = h;
  const bctx = bc.getContext("2d")!;
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = "high";
  bctx.drawImage(sc, 0, 0, w, h);
  return bctx.getImageData(0, 0, w, h);
}

export function applyFilter(canvas: HTMLCanvasElement, filter: FilterId) {
  if (filter === "original") return;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const bg = background(img).data;
  const d = img.data;
  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

  for (let i = 0; i < d.length; i += 4) {
    if (filter === "magic") {
      for (let c = 0; c < 3; c++) {
        const v = (d[i + c] / Math.max(bg[i + c], 1)) * 255;
        d[i + c] = clamp(((v - 35) * 255) / 200);
      }
    } else {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const bl = Math.max(0.299 * bg[i] + 0.587 * bg[i + 1] + 0.114 * bg[i + 2], 1);
      const v = (lum / bl) * 255;
      const out =
        filter === "gray" ? clamp(((v - 35) * 255) / 200) : clamp(((v - 120) * 255) / 75);
      d[i] = d[i + 1] = d[i + 2] = out;
    }
  }
  ctx.putImageData(img, 0, 0);
}
export type Adjust = { brightness: number; contrast: number }; // -100..100
export const NO_ADJUST: Adjust = { brightness: 0, contrast: 0 };

export function applyAdjust(canvas: HTMLCanvasElement, adj: Adjust) {
  if (!adj.brightness && !adj.contrast) return;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const f = 1 + adj.contrast / 100;
  const b = adj.brightness * 1.28;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = (d[i] - 128) * f + 128 + b; // Uint8ClampedArray clamps for us
    d[i + 1] = (d[i + 1] - 128) * f + 128 + b;
    d[i + 2] = (d[i + 2] - 128) * f + 128 + b;
  }
  ctx.putImageData(img, 0, 0);
}
/** Crop + straighten + filter + adjust. Pass null corners to keep the whole image. */
export function renderScan(
  src: HTMLCanvasElement,
  corners: Corners | null,
  filter: FilterId,
  maxOut: number,
  adjust: Adjust = NO_ADJUST
): HTMLCanvasElement {
  const out = warp(src, corners ?? fullCorners(), maxOut);
  applyFilter(out, filter);
  applyAdjust(out, adjust);
  return out;
}