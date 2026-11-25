"use client";

import { useState } from "react";
import { jsPDF } from "jspdf";
import { savePdf } from "@/lib/savePdf";

// ====== LIMITS: change these if you like ======
const MAX_IMAGES = 50;
const MAX_FILE_MB = 30;
// ==============================================

type PageSize = "a4" | "letter" | "fit";
type Img = { id: string; url: string; file: File; rotation: number };

const isImage = (f: File) =>
  f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name);

const formatSize = (bytes: number) =>
  bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

// Fix orientation, apply rotation, resize, flatten transparency, compress
async function toJpeg(file: File, rotation: number, maxSize = 1800) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
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
  upload:
    "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12",
  up: "M18 15l-6-6-6 6",
  down: "M6 9l6 6 6-6",
  rotate: "M23 4v6h-6 M20.5 15a9 9 0 1 1-2.1-9.4L23 10",
  trash:
    "M3 6h18 M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6 M10 11v6 M14 11v6 M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M9 15h6 M9 11h2",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3",
};

export default function Home() {
  const [images, setImages] = useState<Img[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [success, setSuccess] = useState(false);
  const [pageSize, setPageSize] = useState<PageSize>("a4");
  const [fileName, setFileName] = useState("scan");

  const count = images.length;
  const remaining = MAX_IMAGES - count;
  const full = remaining <= 0;

  function addFiles(files: FileList | null) {
    if (!files || !files.length) return;
    setError("");
    setSuccess(false);

    const all = Array.from(files);
    const messages: string[] = [];

    let valid = all.filter(isImage);
    if (valid.length < all.length) {
      messages.push(`${all.length - valid.length} file(s) skipped: not an image.`);
    }

    const tooBig = valid.filter((f) => f.size > MAX_FILE_MB * 1024 * 1024);
    if (tooBig.length) {
      messages.push(
        `${tooBig.length} image(s) skipped: larger than ${MAX_FILE_MB} MB.`
      );
      valid = valid.filter((f) => f.size <= MAX_FILE_MB * 1024 * 1024);
    }

    if (valid.length > remaining) {
      messages.push(
        `Limit is ${MAX_IMAGES} images. ${valid.length - remaining} image(s) were not added.`
      );
      valid = valid.slice(0, Math.max(0, remaining));
    }

    setWarning(messages.join(" "));

    const added: Img[] = valid.map((f) => ({
      id: crypto.randomUUID(),
      url: URL.createObjectURL(f),
      file: f,
      rotation: 0,
    }));
    if (added.length) setImages((prev) => [...prev, ...added]);
  }

  function remove(id: string) {
    setSuccess(false);
    setWarning("");
    setImages((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target) URL.revokeObjectURL(target.url);
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

  function clearAll() {
    images.forEach((i) => URL.revokeObjectURL(i.url));
    setImages([]);
    setError("");
    setWarning("");
    setSuccess(false);
  }

  async function createPdf() {
    if (!images.length) return;
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

        // Page format
        let format: string | [number, number];
        let pageW: number;
        let pageH: number;
        if (pageSize === "fit") {
          const longSide = 297; // mm
          const k = longSide / Math.max(w, h);
          pageW = w * k;
          pageH = h * k;
          format = [Math.min(pageW, pageH), Math.max(pageW, pageH)];
        } else {
          format = pageSize;
        }

        if (!pdf) {
          pdf = new jsPDF({ orientation, unit: "mm", format });
        } else {
          pdf.addPage(format, orientation);
        }

        pageW = pdf.internal.pageSize.getWidth();
        pageH = pdf.internal.pageSize.getHeight();
        const ratio = Math.min(
          (pageW - 2 * margin) / w,
          (pageH - 2 * margin) / h
        );
        const iw = w * ratio;
        const ih = h * ratio;
        pdf.addImage(dataUrl, "JPEG", (pageW - iw) / 2, (pageH - ih) / 2, iw, ih);

        setProgress(Math.round(((n + 1) / images.length) * 100));
        // let the UI repaint between pages
        await new Promise((r) => setTimeout(r, 0));
      }

      if (pdf) {
        const safe = fileName.trim().replace(/[^\w\- ]+/g, "") || "scan";
        await savePdf(pdf, `${safe}.pdf`);
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

  const sizes: { id: PageSize; label: string }[] = [
    { id: "a4", label: "A4" },
    { id: "letter", label: "Letter" },
    { id: "fit", label: "Fit image" },
  ];

  return (
    <>
      <main className="app">
        {/* Header */}
        <header className="hero">
          <div className="brand">
            <div className="logo">
              <Icon d={ICONS.file} size={24} />
            </div>
            <h1>Image to PDF</h1>
          </div>
          <p>
            Snap photos or upload images, arrange the pages, and get one clean
            PDF. Everything stays on your device.
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
          <label className={`tile camera ${full || busy ? "disabled" : ""}`}>
            <span className="icon-wrap">
              <Icon d={ICONS.camera} size={26} />
            </span>
            Camera
            <small>Take a photo</small>
            <input
              className="visually-hidden"
              type="file"
              accept="image/*"
              capture="environment"
              disabled={full || busy}
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>

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
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </div>

        {/* Messages */}
        {warning && <div className="notice warn">⚠️ {warning}</div>}
        {error && <div className="notice error">❌ {error}</div>}
        {success && (
          <div className="notice ok">✅ Your PDF is ready and was saved.</div>
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
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.url}
                      alt={`Page ${i + 1}`}
                      style={{ transform: `rotate(${img.rotation}deg)` }}
                    />
                    <span className="num">{i + 1}</span>
                  </div>

                  <div className="meta">
                    <div className="name">{img.file.name || `Photo ${i + 1}`}</div>
                    <div className="size">{formatSize(img.file.size)}</div>
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
            disabled={!count || busy}
          >
            {busy && <div className="progress" style={{ width: `${progress}%` }} />}
            {busy ? (
              <>
                <div className="spinner" />
                <span>Creating PDF… {progress}%</span>
              </>
            ) : (
              <>
                <Icon d={ICONS.download} size={20} />
                <span>
                  {count ? `Create PDF (${count} ${count === 1 ? "page" : "pages"})` : "Add images to start"}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </>
  );
}
