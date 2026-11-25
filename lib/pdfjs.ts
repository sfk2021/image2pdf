/* eslint-disable @typescript-eslint/no-explicit-any */
let cached: Promise<any> | null = null;

/** Loads PDF.js at runtime from /public/pdfjs (see scripts/copy-pdfjs.mjs). */
export function getPdfjs(): Promise<any> {
  if (!cached) {
    const url = "/pdfjs/pdf.min.mjs";
    cached = import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url).then(
      (m: any) => {
        m.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
        return m;
      }
    );
  }
  return cached;
}