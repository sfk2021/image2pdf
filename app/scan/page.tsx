"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { jsPDF } from "jspdf";
import { savePdf } from "@/lib/savePdf";
import { setPendingPdf } from "@/lib/pdfStore";
import { uid } from "@/lib/uid";
import AppNav from "@/components/AppNav";
import CameraCapture from "@/components/CameraCapture";
import ScanEditor from "@/components/ScanEditor";
import {
  Adjust,
  Corners,
  FilterId,
  FILTERS,
  DECODE_MAX,
  JPEG_QUALITY,
  NO_ADJUST,
  OUT_MAX,
  THUMB_SIZE,
  canvasToFile,
  loadSource,
  makeThumb,
} from "@/lib/scan";
import { scanCanvas } from "@/lib/scanWorker";

// ====== LIMITS: change these if you like ======
const MAX_IMAGES = 30;
const MAX_FILE_MB = 25;
// ==============================================

type PageSize = "a4" | "letter" | "fit";
type Img = {
  id: string;
  url: string; // small preview ("" until it is ready)
  file: File; // current (processed) image used in the PDF
  source: File; // untouched original, used for re-cropping
  rotation: number;
  corners: Corners | null;
  filter: FilterId;
  adjust: Adjust;
  scanned: boolean;
  processing: boolean;
};
type Job = {
  id: string;
  source: File;
  corners: Corners | null;
  detect: boolean; // find the page edges automatically
  scan: boolean; // false = only make a preview
  filter: FilterId;
  adjust: Adjust;
};

const isImage = (f: File) =>
  f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name);

const formatSize = (bytes: number) =>
  bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

// Fix orientation, apply rotation, resize, flatten transparency, compress
async function toJpeg(file: File, rotation: number, maxSize = 1800) {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bmp = await createImageBitmap(file);
  }
  const scale = Math.min(1, maxSize / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);

  const rot = ((rotation % 360) + 360) % 360;
  const swap = rot === 90 || rot === 270;
  const cw = swap ? h : w;
  const ch = swap ? w : h;

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cw, ch);
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
  bmp.close();

  return { dataUrl: canvas.toDataURL("image/jpeg", 0.85), w: cw, h: ch };
}

/* ---------- Icons ---------- */
const Icon = ({ d, size = 20 }: { d: string; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
);

const ICONS = {
  camera:
    "M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12",
  up: "M18 15l-6-6-6 6",
  down: "M6 9l6 6 6-6",
  rotate: "M23 4v6h-6 M20.5 15a9 9 0 1 1-2.1-9.4L23 10",
  crop: "M6 2v14a2 2 0 0 0 2 2h14 M18 22V8a2 2 0 0 0-2-2H2",
  trash:
    "M3 6h18 M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6 M10 11v6 M14 11v6 M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M9 15h6 M9 11h2",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3",
};

export default function ScanPage() {
  const router = useRouter();

  const [images, setImages] = useState<Img[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [success, setSuccess] = useState(false);
  const [lastPdf, setLastPdf] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [pageSize, setPageSize] = useState<PageSize>("a4");
  const [fileName, setFileName] = useState("scan");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [autoScan, setAutoScan] = useState(true);
  const [defaultFilter, setDefaultFilter] = useState<FilterId>("magic");
  const [editingId, setEditingId] = useState<string | null>(null);

  // Always-current values for async work and rapid camera taps
  const countRef = useRef(0);
  const imagesRef = useRef<Img[]>([]);
  const removedRef = useRef(new Set<string>());
  const scanOpts = useRef({ autoScan: true, defaultFilter: "magic" as FilterId });
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const nativeCameraRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    countRef.current = images.length;
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    scanOpts.current = { autoScan, defaultFilter };
  }, [autoScan, defaultFilter]);

  const count = images.length;
  const remaining = MAX_IMAGES - count;
  const full = remaining <= 0;
  const processingCount = images.filter((i) => i.processing).length;
  const processing = processingCount > 0;
  const editing = images.find((i) => i.id === editingId) ?? null;

  /* ----- Scanning: one page at a time, the heavy work runs in a worker ----- */
  async function runJob(job: Job) {
    try {
      if (removedRef.current.has(job.id)) return;

      let file = job.source;
      let corners = job.corners;
      let url = "";

      if (job.scan) {
        const src = await loadSource(job.source, DECODE_MAX);
        const res = await scanCanvas(src, {
          corners: job.corners,
          detect: job.detect,
          filter: job.filter,
          adjust: job.adjust,
          maxOut: OUT_MAX,
        });
        corners = res.corners;
        file = await canvasToFile(res.canvas, `scan-${Date.now()}.jpg`, JPEG_QUALITY);
        url = await makeThumb(res.canvas);
      } else {
        const small = await loadSource(job.source, THUMB_SIZE);
        url = await makeThumb(small);
      }

      if (removedRef.current.has(job.id)) {
        URL.revokeObjectURL(url);
        return;
      }
      const old = imagesRef.current.find((i) => i.id === job.id);
      if (old?.url) URL.revokeObjectURL(old.url);

      setImages((prev) =>
        prev.map((i) =>
          i.id === job.id
            ? {
                ...i,
                file,
                url,
                corners,
                filter: job.filter,
                adjust: job.adjust,
                scanned: job.scan,
                processing: false,
              }
            : i
        )
      );
    } catch (e) {
      console.error(e);
      // keep the original photo so the page is still usable
      let url = "";
      try {
        url = await makeThumb(await loadSource(job.source, THUMB_SIZE));
      } catch {
        /* no preview available */
      }
      if (removedRef.current.has(job.id)) {
        if (url) URL.revokeObjectURL(url);
        return;
      }
      setImages((prev) =>
        prev.map((i) =>
          i.id === job.id ? { ...i, url: i.url || url, processing: false } : i
        )
      );
      setWarning(
        "A page could not be scanned and was kept as it is. Use the crop button to fix it by hand."
      );
    }
  }

  function enqueue(jobs: Job[]) {
    if (!jobs.length) return;
    const ids = new Set(jobs.map((j) => j.id));
    setImages((prev) => prev.map((i) => (ids.has(i.id) ? { ...i, processing: true } : i)));
    for (const job of jobs) {
      queueRef.current = queueRef.current.then(() => runJob(job));
    }
  }

  function addFiles(files: File[]) {
    if (!files.length) return;
    setError("");
    setSuccess(false);

    const messages: string[] = [];

    let valid = files.filter(isImage);
    if (valid.length < files.length) {
      messages.push(`${files.length - valid.length} file(s) skipped: not an image.`);
    }

    const tooBig = valid.filter((f) => f.size > MAX_FILE_MB * 1024 * 1024);
    if (tooBig.length) {
      messages.push(`${tooBig.length} image(s) skipped: larger than ${MAX_FILE_MB} MB.`);
      valid = valid.filter((f) => f.size <= MAX_FILE_MB * 1024 * 1024);
    }

    const room = MAX_IMAGES - countRef.current;
    if (valid.length > room) {
      messages.push(
        `Limit is ${MAX_IMAGES} images. ${valid.length - Math.max(0, room)} image(s) were not added.`
      );
      valid = valid.slice(0, Math.max(0, room));
    }

    setWarning(messages.join(" "));

    const added: Img[] = valid.map((f) => ({
      id: uid(),
      url: "",
      file: f,
      source: f,
      rotation: 0,
      corners: null,
      filter: "original",
      adjust: NO_ADJUST,
      scanned: false,
      processing: false,
    }));

    if (added.length) {
      countRef.current += added.length;
      setImages((prev) => [...prev, ...added]);
      const { autoScan: scan, defaultFilter: filter } = scanOpts.current;
      enqueue(
        added.map((a) => ({
          id: a.id,
          source: a.source,
          corners: null,
          detect: scan,
          scan,
          filter: scan ? filter : "original",
          adjust: NO_ADJUST,
        }))
      );
    }
  }

  function remove(id: string) {
    removedRef.current.add(id);
    setSuccess(false);
    setWarning("");
    setImages((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target?.url) URL.revokeObjectURL(target.url);
      return prev.filter((i) => i.id !== id);
    });
  }

  function move(index: number, dir: -1 | 1) {
    setImages((prev) => {
      const j = index + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }

  function rotate(id: string) {
    setImages((prev) =>
      prev.map((i) => (i.id === id ? { ...i, rotation: i.rotation + 90 } : i))
    );
  }

  function applyEdit(
    id: string,
    r: {
      file: File;
      thumbUrl: string;
      corners: Corners;
      filter: FilterId;
      adjust: Adjust;
      applyAll: boolean;
    }
  ) {
    const old = imagesRef.current.find((i) => i.id === id);
    if (old?.url) URL.revokeObjectURL(old.url);
    setImages((prev) =>
      prev.map((i) =>
        i.id === id
          ? {
              ...i,
              file: r.file,
              url: r.thumbUrl,
              corners: r.corners,
              filter: r.filter,
              adjust: r.adjust,
              scanned: true,
              processing: false,
            }
          : i
      )
    );
    setEditingId(null);
    setSuccess(false);

    // Batch: re-process all other pages with the same filter + adjustments
    if (r.applyAll) {
      enqueue(
        imagesRef.current
          .filter((i) => i.id !== id && !i.processing)
          .map((i) => ({
            id: i.id,
            source: i.source,
            corners: i.corners,
            detect: !i.scanned && !i.corners,
            scan: true,
            filter: r.filter,
            adjust: r.adjust,
          }))
      );
    }
  }

  function clearAll() {
    images.forEach((i) => {
      removedRef.current.add(i.id);
      if (i.url) URL.revokeObjectURL(i.url);
    });
    setImages([]);
    setError("");
    setWarning("");
    setSuccess(false);
  }

  async function createPdf() {
    if (!images.length || processing) return;
    setBusy(true);
    setProgress(0);
    setError("");
    setSuccess(false);

    try {
      const margin = pageSize === "fit" ? 0 : 10;
      let pdf: jsPDF | null = null;

      for (let n = 0; n < images.length; n++) {
        const img = images[n];
        const { dataUrl, w, h } = await toJpeg(img.file, img.rotation);
        const orientation = w > h ? "l" : "p";

        let format: string | [number, number];
        if (pageSize === "fit") {
          const longSide = 297; // mm
          const k = longSide / Math.max(w, h);
          const pw = w * k;
          const ph = h * k;
          format = [Math.min(pw, ph), Math.max(pw, ph)];
        } else {
          format = pageSize;
        }

        if (!pdf) {
          pdf = new jsPDF({ orientation, unit: "mm", format });
        } else {
          pdf.addPage(format, orientation);
        }

        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        const ratio = Math.min((pageW - 2 * margin) / w, (pageH - 2 * margin) / h);
        const iw = w * ratio;
        const ih = h * ratio;
        pdf.addImage(dataUrl, "JPEG", (pageW - iw) / 2, (pageH - ih) / 2, iw, ih);

        setProgress(Math.round(((n + 1) / images.length) * 100));
        await new Promise((r) => setTimeout(r, 0)); // let the UI repaint
      }

      if (pdf) {
        const safe = fileName.trim().replace(/[^\w\- ]+/g, "") || "scan";
        const buf = pdf.output("arraybuffer");
        await savePdf(pdf, `${safe}.pdf`);
        setLastPdf({ name: safe, bytes: new Uint8Array(buf) });
        setSuccess(true);
      }
    } catch (e) {
      console.error(e);
      setError(
        "Could not create the PDF. One of the files may be an unsupported image (for example HEIC on some browsers)."
      );
    } finally {
      setBusy(false);
    }
  }

  function editPdf() {
    if (!lastPdf) return;
    setPendingPdf(`${lastPdf.name}.pdf`, lastPdf.bytes);
    router.push("/editor/");
  }

  const sizes: { id: PageSize; label: string }[] = [
    { id: "a4", label: "A4" },
    { id: "letter", label: "Letter" },
    { id: "fit", label: "Fit image" },
  ];

  const filterLabel = (id: FilterId) => FILTERS.find((f) => f.id === id)?.label ?? "";

  return (
    <>
      <AppNav />

      <main className="app">
        {/* Header */}
        <header className="hero">
          <div className="brand">
            <div className="logo">
              <Icon d={ICONS.file} size={24} />
            </div>
            <h1>Scan to PDF</h1>
          </div>
          <p>
            Scan documents with your camera or upload images. Pages are
            auto-cropped and cleaned up, then saved as one PDF. Everything stays
            on your device.
          </p>
        </header>

        {/* Counter */}
        <section className="card pull-up">
          <div className="counter-row">
            <strong>
              {count} / {MAX_IMAGES} images
            </strong>
            <span>{full ? "Limit reached" : `${remaining} more allowed`}</span>
          </div>
          <div className={`bar ${full ? "full" : ""}`}>
            <div style={{ width: `${(count / MAX_IMAGES) * 100}%` }} />
          </div>
          <p className="limit-note">
            Maximum {MAX_IMAGES} images per PDF, up to {MAX_FILE_MB} MB each.
          </p>
        </section>

        {/* Add images */}
        <div className="actions">
          <button
            type="button"
            className={`tile camera ${full || busy ? "disabled" : ""}`}
            onClick={() => setCameraOpen(true)}
            disabled={full || busy}
          >
            <span className="icon-wrap">
              <Icon d={ICONS.camera} size={26} />
            </span>
            Camera
            <small>Take one or many</small>
          </button>

          <label className={`tile upload ${full || busy ? "disabled" : ""}`}>
            <span className="icon-wrap">
              <Icon d={ICONS.upload} size={26} />
            </span>
            Upload
            <small>From gallery or files</small>
            <input
              className="visually-hidden"
              type="file"
              accept="image/*"
              multiple
              disabled={full || busy}
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </label>
        </div>

        {/* Fallback: phone's own camera app (used if in-app camera is blocked) */}
        <input
          ref={nativeCameraRef}
          className="visually-hidden"
          type="file"
          accept="image/*"
          capture="environment"
          tabIndex={-1}
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />

        {/* Smart scan options */}
        <section className="card">
          <div className="switch-row">
            <div>
              <strong>Smart scan</strong>
              <small>Auto-crop and clean up each new page</small>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoScan}
              aria-label="Smart scan"
              className={`switch ${autoScan ? "on" : ""}`}
              onClick={() => setAutoScan((v) => !v)}
            >
              <span />
            </button>
          </div>
          {autoScan && (
            <div className="chips">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`chip ${defaultFilter === f.id ? "on" : ""}`}
                  onClick={() => setDefaultFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Messages */}
        {warning && <div className="notice warn">⚠️ {warning}</div>}
        {error && <div className="notice error">❌ {error}</div>}
        {success && lastPdf && (
          <div className="notice ok ok-row">
            <span>✅ Your PDF is ready and was saved.</span>
            <button type="button" className="notice-btn" onClick={editPdf}>
              Edit this PDF →
            </button>
          </div>
        )}

        {/* Settings */}
        {count > 0 && (
          <section className="card">
            <h2 className="section-title">PDF settings</h2>
            <div className="segmented" role="tablist" aria-label="Page size">
              {sizes.map((s) => (
                <button
                  key={s.id}
                  className={pageSize === s.id ? "active" : ""}
                  onClick={() => setPageSize(s.id)}
                  disabled={busy}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="field">
              <label htmlFor="fname">File name</label>
              <div className="input-wrap">
                <input
                  id="fname"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  placeholder="scan"
                  maxLength={60}
                  disabled={busy}
                />
                <span>.pdf</span>
              </div>
            </div>
          </section>
        )}

        {/* Pages */}
        {count === 0 ? (
          <div className="empty">
            <div className="big">🗂️</div>
            <b>No pages yet</b>
            Use Camera or Upload to add your first image.
          </div>
        ) : (
          <section className="card">
            <div className="list-head">
              <h2 className="section-title" style={{ margin: 0 }}>
                Pages ({count})
              </h2>
              <button className="link-btn" onClick={clearAll} disabled={busy}>
                Clear all
              </button>
            </div>

            <ul className="pages">
              {images.map((img, i) => (
                <li key={img.id} className="page-item">
                  <div className="thumb">
                    {img.url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={img.url}
                        alt={`Page ${i + 1}`}
                        style={{ transform: `rotate(${img.rotation}deg)` }}
                      />
                    )}
                    <span className="num">{i + 1}</span>
                    {img.processing && (
                      <div className="thumb-busy">
                        <div className="spinner" />
                      </div>
                    )}
                  </div>

                  <div className="meta">
                    <div className="name">{img.source.name || `Photo ${i + 1}`}</div>
                    <div className="size">
                      {formatSize(img.file.size)}
                      {img.processing ? (
                        <span className="badge">Scanning…</span>
                      ) : img.scanned ? (
                        <span className="badge">{filterLabel(img.filter)}</span>
                      ) : null}
                    </div>
                  </div>

                  <div className="row-actions">
                    <button
                      className="icon-btn"
                      onClick={() => move(i, -1)}
                      disabled={i === 0 || busy}
                      aria-label="Move up"
                    >
                      <Icon d={ICONS.up} size={18} />
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => move(i, 1)}
                      disabled={i === count - 1 || busy}
                      aria-label="Move down"
                    >
                      <Icon d={ICONS.down} size={18} />
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => setEditingId(img.id)}
                      disabled={busy || img.processing}
                      aria-label="Crop and filter"
                    >
                      <Icon d={ICONS.crop} size={18} />
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => rotate(img.id)}
                      disabled={busy}
                      aria-label="Rotate"
                    >
                      <Icon d={ICONS.rotate} size={18} />
                    </button>
                    <button
                      className="icon-btn danger"
                      onClick={() => remove(img.id)}
                      disabled={busy}
                      aria-label="Remove"
                    >
                      <Icon d={ICONS.trash} size={18} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="footer">Private by design: no uploads, no servers.</p>
      </main>

      {/* Sticky action bar */}
      <div className="dock">
        <div className="dock-inner">
          <button
            className="cta"
            onClick={createPdf}
            disabled={!count || busy || processing}
          >
            {busy && <div className="progress" style={{ width: `${progress}%` }} />}
            {busy ? (
              <>
                <div className="spinner" />
                <span>Creating PDF… {progress}%</span>
              </>
            ) : processing ? (
              <>
                <div className="spinner" />
                <span>Scanning pages… ({processingCount} left)</span>
              </>
            ) : (
              <>
                <Icon d={ICONS.download} size={20} />
                <span>
                  {count
                    ? `Create PDF (${count} ${count === 1 ? "page" : "pages"})`
                    : "Add images to start"}
                </span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Multi-shot camera */}
      {cameraOpen && (
        <CameraCapture
          count={count}
          max={MAX_IMAGES}
          onCapture={(file) => addFiles([file])}
          onClose={() => setCameraOpen(false)}
          onFallback={() => {
            setCameraOpen(false);
            setTimeout(() => nativeCameraRef.current?.click(), 50);
          }}
        />
      )}

      {/* Crop / filter editor */}
      {editing && (
        <ScanEditor
          key={editing.id}
          source={editing.source}
          corners={editing.corners}
          filter={editing.scanned ? editing.filter : defaultFilter}
          adjust={editing.adjust}
          canApplyAll={count > 1}
          onSave={(r) => applyEdit(editing.id, r)}
          onCancel={() => setEditingId(null)}
        />
      )}
    </>
  );
}