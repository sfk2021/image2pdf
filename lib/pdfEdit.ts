/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  LineCapStyle,
  degrees,
  rgb,
} from "pdf-lib";
import { uid } from "@/lib/uid";

export type Tool = "select" | "text" | "draw" | "highlight" | "cover";

// All positions are 0..1 fractions of the page AS DISPLAYED (top-left origin).
// size/width are fractions of the displayed page width.
export type TextAnnot = {
  id: string; type: "text"; u: number; v: number;
  text: string; size: number; color: string;
};
export type DrawAnnot = {
  id: string; type: "draw"; points: [number, number][];
  width: number; color: string;
};
export type RectAnnot = {
  id: string; type: "highlight" | "cover";
  u: number; v: number; w: number; h: number; color: string;
};
export type Annot = TextAnnot | DrawAnnot | RectAnnot;

export type PdfSource = {
  id: string; kind: "pdf"; name: string; bytes: Uint8Array; doc: any;
};
export type ImgSource = {
  id: string; kind: "image"; name: string; bytes: Uint8Array; url: string;
};
export type Source = PdfSource | ImgSource;

export type PageItem = {
  id: string;
  src: string; // source id ("" for blank pages)
  index: number; // page index inside a PDF source
  blank: boolean;
  w: number; // displayed size in points at extra rotation 0
  h: number;
  rotation: number; // extra rotation set by the user: 0 / 90 / 180 / 270
  annots: Annot[];
};

export const A4 = { w: 595.28, h: 841.89 };

export function dispSize(it: PageItem) {
  return it.rotation % 180 === 90 ? { w: it.h, h: it.w } : { w: it.w, h: it.h };
}

export function translateAnnot(a: Annot, du: number, dv: number): Annot {
  if (a.type === "draw") {
    return {
      ...a,
      points: a.points.map(([u, v]) => [u + du, v + dv] as [number, number]),
    };
  }
  return { ...a, u: a.u + du, v: a.v + dv };
}

/** Moves an annotation along with its page when the page turns 90° clockwise.
 *  Dw/Dh = displayed page size in points BEFORE the turn. */
export function rotateAnnotCW(a: Annot, Dw: number, Dh: number): Annot {
  if (a.type === "draw") {
    return {
      ...a,
      points: a.points.map(([u, v]) => [1 - v, u] as [number, number]),
      width: (a.width * Dw) / Dh,
    };
  }
  if (a.type === "text") {
    const lines = a.text.split("\n");
    const maxLen = Math.max(...lines.map((l) => l.length), 1);
    const bw = maxLen * 0.55 * a.size * Dw; // estimated box size in points
    const bh = lines.length * 1.2 * a.size * Dw;
    const cu = a.u + bw / Dw / 2;
    const cv = a.v + bh / Dh / 2;
    return {
      ...a,
      size: (a.size * Dw) / Dh,
      u: 1 - cv - bw / Dh / 2,
      v: cu - bh / Dw / 2,
    };
  }
  return { ...a, u: 1 - (a.v + a.h), v: a.u, w: a.h, h: a.w };
}

/* ---------- Rendering (preview) ---------- */

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image failed to load"));
    img.src = url;
  });
}

/** Renders one page (without annotations) to a new canvas of width targetW. */
export async function renderItem(
  item: PageItem,
  source: Source | undefined,
  targetW: number
): Promise<HTMLCanvasElement> {
  const d = dispSize(item);
  const cw = Math.max(1, Math.round(targetW));
  const ch = Math.max(1, Math.round((targetW * d.h) / d.w));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, cw, ch);

  if (item.blank || !source) return canvas;

  if (source.kind === "image") {
    const img = await loadImage(source.url);
    const rot90 = item.rotation % 180 === 90;
    const w = rot90 ? ch : cw;
    const h = rot90 ? cw : ch;
    ctx.save();
    ctx.translate(cw / 2, ch / 2);
    ctx.rotate((item.rotation * Math.PI) / 180);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
    return canvas;
  }

  const page = await source.doc.getPage(item.index + 1);
  const rotation = (page.rotate + item.rotation) % 360;
  const vp0 = page.getViewport({ scale: 1, rotation });
  const vp = page.getViewport({ scale: cw / vp0.width, rotation });
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const c2 = canvas.getContext("2d")!;
  c2.fillStyle = "#fff";
  c2.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: c2, viewport: vp }).promise;
  return canvas;
}

/** Image file -> JPEG source (any format the browser can decode). */
export async function imageToSource(
  file: File
): Promise<{ source: ImgSource; w: number; h: number }> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const s = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const cw = Math.max(1, Math.round(bmp.width * s));
  const ch = Math.max(1, Math.round(bmp.height * s));
  const c = document.createElement("canvas");
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(bmp, 0, 0, cw, ch);
  bmp.close();

  const blob = await new Promise<Blob>((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/jpeg", 0.9)
  );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const k = Math.min(841.89 / Math.max(cw, ch), 595.28 / Math.min(cw, ch));
  return {
    source: { id: uid(), kind: "image", name: file.name, bytes, url: URL.createObjectURL(blob) },
    w: cw * k,
    h: ch * k,
  };
}

/* ---------- Export with pdf-lib ---------- */

function hex(c: string) {
  const n = parseInt(c.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// Standard fonts only support Latin characters
function safeText(font: PDFFont, s: string) {
  let out = "";
  for (const ch of s) {
    try {
      font.widthOfTextAtSize(ch, 1);
      out += ch;
    } catch {
      out += "?";
    }
  }
  return out;
}

type Box = { x: number; y: number; width: number; height: number };

// Display coordinates (0..1, top-left origin) -> PDF user space for rotation R
function toUser(u: number, v: number, b: Box, R: number) {
  switch (R) {
    case 90:
      return { x: b.x + v * b.width, y: b.y + u * b.height };
    case 180:
      return { x: b.x + (1 - u) * b.width, y: b.y + v * b.height };
    case 270:
      return { x: b.x + (1 - v) * b.width, y: b.y + (1 - u) * b.height };
    default:
      return { x: b.x + u * b.width, y: b.y + (1 - v) * b.height };
  }
}

function drawAnnots(page: PDFPage, font: PDFFont, annots: Annot[], R: number) {
  const box = page.getCropBox();
  const swap = R % 180 === 90;
  const Dw = swap ? box.height : box.width;
  const Dh = swap ? box.width : box.height;

  for (const a of annots) {
    const color = hex(a.color);

    if (a.type === "text") {
      const fs = a.size * Dw;
      a.text.split("\n").forEach((line, k) => {
        if (!line) return;
        const vb = a.v + ((0.95 + 1.2 * k) * fs) / Dh;
        const p = toUser(a.u, vb, box, R);
        page.drawText(safeText(font, line), {
          x: p.x, y: p.y, size: fs, font, color, rotate: degrees(R),
        });
      });
    } else if (a.type === "draw") {
      const thickness = Math.max(0.3, a.width * Dw);
      const pts = a.points.map(([u, v]) => toUser(u, v, box, R));
      if (pts.length === 1) {
        page.drawCircle({ x: pts[0].x, y: pts[0].y, size: thickness / 2, color });
      } else {
        for (let i = 1; i < pts.length; i++) {
          page.drawLine({
            start: pts[i - 1], end: pts[i], thickness, color,
            lineCap: LineCapStyle.Round,
          });
        }
      }
    } else {
      const p1 = toUser(a.u, a.v, box, R);
      const p2 = toUser(a.u + a.w, a.v + a.h, box, R);
      page.drawRectangle({
        x: Math.min(p1.x, p2.x),
        y: Math.min(p1.y, p2.y),
        width: Math.abs(p2.x - p1.x),
        height: Math.abs(p2.y - p1.y),
        color,
        opacity: a.type === "highlight" ? 0.35 : 1,
        borderWidth: 0,
      });
    }
  }
}

export async function buildPdf(
  items: PageItem[],
  sources: Map<string, Source>
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const loaded = new Map<string, PDFDocument>();

  for (const it of items) {
    const src = sources.get(it.src);
    let page: PDFPage;

    if (it.blank || !src) {
      page = out.addPage([it.w, it.h]);
    } else if (src.kind === "image") {
      const img = await out.embedJpg(src.bytes);
      page = out.addPage([it.w, it.h]);
      page.drawImage(img, { x: 0, y: 0, width: it.w, height: it.h });
    } else {
      let doc = loaded.get(src.id);
      if (!doc) {
        doc = await PDFDocument.load(src.bytes);
        loaded.set(src.id, doc);
      }
      const [copied] = await out.copyPages(doc, [it.index]);
      page = out.addPage(copied);
    }

    const total = (((page.getRotation().angle + it.rotation) % 360) + 360) % 360;
    page.setRotation(degrees(total));
    if (it.annots.length) drawAnnots(page, font, it.annots, total);
  }

  return out.save();
}