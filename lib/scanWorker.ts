import type { Adjust, Corners, FilterId } from "@/lib/scan";

type Reply = {
  id: number;
  error?: string;
  width?: number;
  height?: number;
  buffer?: ArrayBuffer;
  corners?: Corners | null;
};

type Pending = {
  resolve: (r: Reply) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function failAll(message: string) {
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(new Error(message));
  }
  pending.clear();
}

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker("/scan-worker.js?v=3");

  w.onmessage = (e: MessageEvent<Reply>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    clearTimeout(p.timer);
    if (e.data.error) p.reject(new Error(e.data.error));
    else p.resolve(e.data);
  };

  w.onerror = () => {
    failAll("Scan worker failed");
    w.terminate();
    if (worker === w) worker = null;
  };

  worker = w;
  return w;
}

function call(msg: Record<string, unknown>, transfer: Transferable[]): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Scanning took too long"));
    }, 30000);
    pending.set(id, { resolve, reject, timer });
    try {
      getWorker().postMessage({ ...msg, id }, transfer);
    } catch (e) {
      clearTimeout(timer);
      pending.delete(id);
      reject(e instanceof Error ? e : new Error("Could not start the scan worker"));
    }
  });
}

export type ScanOptions = {
  corners: Corners | null;
  detect: boolean; // find the page edges automatically (ignores `corners`)
  filter: FilterId;
  adjust: Adjust;
  maxOut: number; // longest side of the result, in pixels
};

/** Crop + straighten + filter + adjust, all inside the worker. */
export async function scanCanvas(
  src: HTMLCanvasElement,
  o: ScanOptions
): Promise<{ canvas: HTMLCanvasElement; corners: Corners | null }> {
  const img = src.getContext("2d")!.getImageData(0, 0, src.width, src.height);
  const buffer = img.data.buffer as ArrayBuffer;

  const res = await call(
    {
      type: "process",
      width: src.width,
      height: src.height,
      buffer,
      corners: o.corners,
      detect: o.detect,
      filter: o.filter,
      brightness: o.adjust.brightness,
      contrast: o.adjust.contrast,
      maxOut: o.maxOut,
    },
    [buffer]
  );

  const w = res.width!;
  const h = res.height!;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas
    .getContext("2d")!
    .putImageData(new ImageData(new Uint8ClampedArray(res.buffer as ArrayBuffer), w, h), 0, 0);

  return { canvas, corners: res.corners ?? null };
}

/** Finds the page corners only. Returns null if no page was found. */
export async function detectOnly(src: HTMLCanvasElement): Promise<Corners | null> {
  const img = src.getContext("2d")!.getImageData(0, 0, src.width, src.height);
  const buffer = img.data.buffer as ArrayBuffer;
  const res = await call(
    { type: "detect", width: src.width, height: src.height, buffer },
    [buffer]
  );
  return res.corners ?? null;
}