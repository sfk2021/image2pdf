// Hands a PDF from the scanner page to the editor page (kept in memory only)
let pending: { name: string; bytes: Uint8Array } | null = null;

export function setPendingPdf(name: string, bytes: Uint8Array) {
  pending = { name, bytes };
}

export function takePendingPdf() {
  const p = pending;
  pending = null;
  return p;
}