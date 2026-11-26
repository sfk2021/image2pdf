export type Pt = { x: number; y: number };
// top-left, top-right, bottom-right, bottom-left, each 0..1 of the image
export type Corners = [Pt, Pt, Pt, Pt];
export type FilterId = "original" | "magic" | "gray" | "bw";
export type Adjust = { brightness: number; contrast: number }; // -100..100

export const NO_ADJUST: Adjust = { brightness: 0, contrast: 0 };

export const FILTERS: { id: FilterId; label: string }[] = [
  { id: "original", label: "Original" },
  { id: "magic", label: "Magic color" },
  { id: "gray", label: "Gray" },
  { id: "bw", label: "B&W" },
];

// Speed / quality knobs. Lower these if a very old phone struggles.
export const DECODE_MAX = 2400; // photo is read at this size before cropping
export const OUT_MAX = 1700; // scanned page: longest side in pixels
export const THUMB_SIZE = 360; // list thumbnails
export const JPEG_QUALITY = 0.88;

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
export async function loadSource(file: File, maxSide: number): Promise<HTMLCanvasElement> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bmp = await createImageBitmap(file);
  }
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * s));
  c.height = Math.max(1, Math.round(bmp.height * s));
  c.getContext("2d", { willReadFrequently: true })!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

export function canvasToFile(
  c: HTMLCanvasElement,
  name: string,
  quality = JPEG_QUALITY
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

/** Small JPEG preview as an object URL (remember to revoke it). */
export function makeThumb(src: HTMLCanvasElement, size = THUMB_SIZE): Promise<string> {
  const s = Math.min(1, size / Math.max(src.width, src.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(src.width * s));
  c.height = Math.max(1, Math.round(src.height * s));
  c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
  return new Promise((resolve, reject) =>
    c.toBlob(
      (b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error("Could not make preview"))),
      "image/jpeg",
      0.7
    )
  );
}