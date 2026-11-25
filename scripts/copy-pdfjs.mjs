import { copyFileSync, mkdirSync, existsSync } from "node:fs";

const base = "node_modules/pdfjs-dist/legacy/build";
mkdirSync("public/pdfjs", { recursive: true });

for (const f of ["pdf.min.mjs", "pdf.worker.min.mjs"]) {
  const src = `${base}/${f}`;
  if (!existsSync(src)) {
    console.warn(`[copy-pdfjs] missing ${src}. Run: npm install pdfjs-dist@4.10.38`);
    continue;
  }
  copyFileSync(src, `public/pdfjs/${f}`);
}
console.log("[copy-pdfjs] PDF.js copied to public/pdfjs");