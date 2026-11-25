"use client";

import { useEffect, useRef, useState } from "react";
import {
  Adjust,
  Corners,
  FilterId,
  FILTERS,
  canvasToFile,
  fullCorners,
  insetCorners,
  loadSource,
  renderScan,
} from "@/lib/scan";
import { detectDocument, loadOpenCV } from "@/lib/opencv";

type Props = {
  source: File;
  corners: Corners | null;
  filter: FilterId;
  adjust: Adjust;
  canApplyAll: boolean;
  onSave: (r: {
    file: File;
    corners: Corners;
    filter: FilterId;
    adjust: Adjust;
    applyAll: boolean;
  }) => void;
  onCancel: () => void;
};

export default function ScanEditor({
  source,
  corners: initCorners,
  filter: initFilter,
  adjust: initAdjust,
  canApplyAll,
  onSave,
  onCancel,
}: Props) {
  const srcRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);

  const [previewUrl, setPreviewUrl] = useState("");
  const [aspect, setAspect] = useState(1);
  const [tab, setTab] = useState<"crop" | "filter">("crop");
  const [corners, setCorners] = useState<Corners>(initCorners ?? insetCorners());
  const [filter, setFilter] = useState<FilterId>(initFilter);
  const [adjust, setAdjust] = useState<Adjust>(initAdjust);
  const [applyAll, setApplyAll] = useState(false);
  const [status, setStatus] = useState<"loading" | "detecting" | "ready" | "saving">("loading");
  const [note, setNote] = useState("");

  async function autoDetect(c: HTMLCanvasElement) {
    setNote("");
    try {
      const cv = await loadOpenCV();
      const found = detectDocument(cv, c);
      if (found) {
        setCorners(found);
      } else {
        setCorners(insetCorners());
        setNote("No page edges found. Drag the corners to fit your page.");
      }
    } catch {
      setCorners(insetCorners());
      setNote("Auto-detect needs an internet connection. Drag the corners manually.");
    }
  }

  // Load the image once
  useEffect(() => {
    let cancelled = false;
    let url = "";

    (async () => {
      try {
        const c = await loadSource(source, 1400);
        if (cancelled) return;
        srcRef.current = c;
        const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.85));
        if (!blob || cancelled) return;
        url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        setAspect(c.width / c.height);

        if (!initCorners) {
          setStatus("detecting");
          await autoDetect(c);
        }
        if (!cancelled) setStatus("ready");
      } catch {
        if (!cancelled) {
          setNote("Could not open this image.");
          setStatus("ready");
        }
      }
    })();

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  // Lock page scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Live filter preview
  useEffect(() => {
    if (tab !== "filter" || !srcRef.current || !previewRef.current) return;
    const out = renderScan(srcRef.current, corners, filter, 700, adjust);
    const p = previewRef.current;
    p.width = out.width;
    p.height = out.height;
    p.getContext("2d")!.drawImage(out, 0, 0);
  }, [tab, corners, filter, adjust, status]);

  function down(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function move(i: number, e: React.PointerEvent<HTMLDivElement>) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId) || !stageRef.current) return;
    const r = stageRef.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    setCorners((prev) => {
      const next = [...prev] as Corners;
      next[i] = { x, y };
      return next;
    });
  }

  async function runDetect() {
    if (!srcRef.current) return;
    setStatus("detecting");
    await autoDetect(srcRef.current);
    setStatus("ready");
  }

  async function save() {
    setStatus("saving");
    try {
      const full = await loadSource(source, 2600);
      const out = renderScan(full, corners, filter, 2000, adjust);
      const base = (source.name || "scan").replace(/\.[^.]+$/, "");
      const file = await canvasToFile(out, `${base}-scan.jpg`, 0.9);
      onSave({ file, corners, filter, adjust, applyAll: applyAll && canApplyAll });
    } catch {
      setNote("Could not process this image.");
      setStatus("ready");
    }
  }

  const [c0, c1, c2, c3] = corners;
  const poly = corners.map((c) => `${c.x},${c.y}`).join(" ");
  const dim = `M0 0H1V1H0Z M${c0.x} ${c0.y}L${c1.x} ${c1.y}L${c2.x} ${c2.y}L${c3.x} ${c3.y}Z`;
  const working = status === "loading" || status === "detecting" || status === "saving";

  return (
    <div className="se" role="dialog" aria-label="Scan editor">
      <div className="se-top">
        <button className="se-link" onClick={onCancel} disabled={status === "saving"}>
          Cancel
        </button>
        <div className="se-tabs">
          <button className={tab === "crop" ? "on" : ""} onClick={() => setTab("crop")}>
            Crop
          </button>
          <button className={tab === "filter" ? "on" : ""} onClick={() => setTab("filter")}>
            Filter
          </button>
        </div>
        <button className="se-save" onClick={save} disabled={working}>
          {status === "saving" ? "Saving…" : "Done"}
        </button>
      </div>

      <div className="se-view">
        {tab === "crop" && previewUrl && (
          <div
            ref={stageRef}
            className="se-stage"
            style={{
              aspectRatio: aspect,
              width: `min(100%, calc((100dvh - 220px) * ${aspect}))`,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="" draggable={false} />
            <svg viewBox="0 0 1 1" preserveAspectRatio="none">
              <path d={dim} fillRule="evenodd" className="se-dim" />
              <polygon points={poly} className="se-poly" vectorEffect="non-scaling-stroke" />
            </svg>
            {corners.map((c, i) => (
              <div
                key={i}
                className="se-handle"
                style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
                onPointerDown={down}
                onPointerMove={(e) => move(i, e)}
              />
            ))}
          </div>
        )}

        {tab === "filter" && <canvas ref={previewRef} className="se-preview" />}

        {working && (
          <div className="se-busy">
            <div className="spinner" />
            <span>
              {status === "detecting" ? "Detecting edges…" : status === "saving" ? "Saving…" : "Loading…"}
            </span>
          </div>
        )}
      </div>

      {note && <p className="se-note">{note}</p>}

      {tab === "crop" ? (
        <div className="se-bottom">
          <button className="se-btn" onClick={runDetect} disabled={working}>
            ✨ Auto detect
          </button>
          <button className="se-btn" onClick={() => setCorners(fullCorners())} disabled={working}>
            Reset
          </button>
        </div>
      ) : (
        <div className="se-bottom col">
          <div className="se-chips">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                className={`se-btn ${filter === f.id ? "on" : ""}`}
                onClick={() => setFilter(f.id)}
                disabled={working}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="se-sliders">
            <label>
              <span>Brightness</span>
              <input
                type="range"
                min={-100}
                max={100}
                value={adjust.brightness}
                onChange={(e) => setAdjust({ ...adjust, brightness: Number(e.target.value) })}
              />
            </label>
            <label>
              <span>Contrast</span>
              <input
                type="range"
                min={-100}
                max={100}
                value={adjust.contrast}
                onChange={(e) => setAdjust({ ...adjust, contrast: Number(e.target.value) })}
              />
            </label>
          </div>
          {canApplyAll && (
            <label className="se-check">
              <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} />
              Apply filter &amp; adjustments to all pages
            </label>
          )}
        </div>
      )}
    </div>
  );
}