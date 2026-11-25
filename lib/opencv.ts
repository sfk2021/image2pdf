/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Corners } from "@/lib/scan";

let loading: Promise<any> | null = null;

/** Loads OpenCV.js from the CDN once (about 9 MB). Rejects if offline. */
export function loadOpenCV(): Promise<any> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("No window"));
  }
  const w = window as any;
  if (w.cv && w.cv.Mat) return Promise.resolve(w.cv);
  if (loading) return loading;

  loading = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      loading = null;
      reject(new Error("OpenCV load timed out"));
    }, 30000);

    const s = document.createElement("script");
    s.src = "https://docs.opencv.org/4.x/opencv.js";
    s.async = true;

    s.onload = async () => {
      try {
        let cv = w.cv;
        if (cv && typeof cv.then === "function") {
          cv = await cv; // newer builds expose a promise
          w.cv = cv;
        }
        if (cv && cv.Mat) {
          clearTimeout(timer);
          resolve(cv);
        } else if (cv) {
          cv.onRuntimeInitialized = () => {
            clearTimeout(timer);
            resolve(w.cv);
          };
        } else {
          throw new Error("OpenCV not available");
        }
      } catch (e) {
        clearTimeout(timer);
        loading = null;
        reject(e);
      }
    };
    s.onerror = () => {
      clearTimeout(timer);
      loading = null;
      reject(new Error("Could not load OpenCV"));
    };
    document.head.appendChild(s);
  });

  return loading;
}

/** Finds the largest 4-sided shape (the page). Returns null if none found. */
export function detectDocument(cv: any, src: HTMLCanvasElement): Corners | null {
  const scale = Math.min(1, 500 / Math.max(src.width, src.height));
  const small = document.createElement("canvas");
  small.width = Math.max(1, Math.round(src.width * scale));
  small.height = Math.max(1, Math.round(src.height * scale));
  small.getContext("2d")!.drawImage(src, 0, 0, small.width, small.height);

  const mat = cv.imread(small);
  const gray = new cv.Mat();
  const blur = new cv.Mat();
  const edges = new cv.Mat();
  const dil = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();

  try {
    cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
    cv.Canny(blur, edges, 60, 160);
    cv.dilate(edges, dil, kernel);
    cv.findContours(dil, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    const minArea = small.width * small.height * 0.15;
    let bestArea = 0;
    let best: number[] | null = null;

    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const area = cv.contourArea(c);
      if (area > minArea && area > bestArea) {
        const approx = new cv.Mat();
        cv.approxPolyDP(c, approx, 0.02 * cv.arcLength(c, true), true);
        if (approx.rows === 4 && cv.isContourConvex(approx)) {
          bestArea = area;
          best = Array.from(approx.data32S as Int32Array);
        }
        approx.delete();
      }
      c.delete();
    }

    if (!best) return null;

    const pts = [0, 1, 2, 3].map((i) => ({ x: best![i * 2], y: best![i * 2 + 1] }));
    const bySum = [...pts].sort((a, b) => a.x + a.y - (b.x + b.y));
    const byDiff = [...pts].sort((a, b) => a.y - a.x - (b.y - b.x));
    const tl = bySum[0];
    const br = bySum[3];
    const tr = byDiff[0];
    const bl = byDiff[3];
    const n = (p: { x: number; y: number }) => ({
      x: Math.min(1, Math.max(0, p.x / small.width)),
      y: Math.min(1, Math.max(0, p.y / small.height)),
    });
    return [n(tl), n(tr), n(br), n(bl)];
  } finally {
    mat.delete();
    gray.delete();
    blur.delete();
    edges.delete();
    dil.delete();
    kernel.delete();
    contours.delete();
    hierarchy.delete();
  }
}