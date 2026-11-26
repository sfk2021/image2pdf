"use client";

import { useEffect, useRef, useState } from "react";
import { Crop, PageItem, Source, fullSize, renderItem } from "@/lib/pdfEdit";

type Props = {
  item: PageItem;
  source?: Source;
  pageNumber: number;
  pageCount: number;
  onApply: (crop: Crop | null, applyAll: boolean) => void;
  onCancel: () => void;
};

type Rect = { x0: number; y0: number; x1: number; y1: number };
type HandleId = "move" | "tl" | "tr" | "br" | "bl" | "t" | "r" | "b" | "l";

const MIN = 0.05; // smallest allowed crop (5% of the page)
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));

const toRect = (c: Crop | null): Rect =>
  c
    ? { x0: c.u, y0: c.v, x1: c.u + c.w, y1: c.v + c.h }
    : { x0: 0, y0: 0, x1: 1, y1: 1 };

const PRESETS = [
  { id: "free", label: "Free" },
  { id: "orig", label: "Original" },
  { id: "a4", label: "A4" },
  { id: "letter", label: "Letter" },
  { id: "square", label: "Square" },
];

export default function CropEditor({
  item,
  source,
  pageNumber,
  pageCount,
  onApply,
  onCancel,
}: Props) {
  const full = fullSize(item); // whole page, in points
  const pageRatio = full.w / full.h;

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ h: HandleId; x: number; y: number; start: Rect } | null>(null);
  const cancelRef = useRef(onCancel);
  useEffect(() => {
    cancelRef.current = onCancel;
  });

  const [rect, setRect] = useState<Rect>(() => toRect(item.crop));
  const [lock, setLock] = useState<number | null>(null); // locked width / height ratio
  const [preset, setPreset] = useState("free");
  const [applyAll, setApplyAll] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  // Draw the whole page (ignoring any existing crop)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.round(Math.min(window.innerWidth, 900) * dpr);
        const c = await renderItem({ ...item, crop: null }, source, w);
        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;
        canvas.width = c.width;
        canvas.height = c.height;
        canvas.getContext("2d")!.drawImage(c, 0, 0);
        setStatus("ready");
      } catch (e) {
        console.error(e);
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lock page scroll, Escape cancels
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && cancelRef.current();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const raw = (e: React.PointerEvent): [number, number] => {
    const r = stageRef.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };

  function down(h: HandleId, e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = raw(e);
    dragRef.current = { h, x, y, start: rect };
  }

  function move(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d || !stageRef.current) return;
    const [rx, ry] = raw(e);
    const s = d.start;

    // drag the whole box
    if (d.h === "move") {
      const w = s.x1 - s.x0;
      const h = s.y1 - s.y0;
      const nx = clamp(s.x0 + (rx - d.x), 0, 1 - w);
      const ny = clamp(s.y0 + (ry - d.y), 0, 1 - h);
      setRect({ x0: nx, y0: ny, x1: nx + w, y1: ny + h });
      return;
    }

    const x = clamp(rx, 0, 1);
    const y = clamp(ry, 0, 1);

    // corner with a locked shape: the opposite corner stays where it is
    if (lock && d.h.length === 2) {
      const k = (lock * full.h) / full.w; // width/height ratio in page fractions
      const left = d.h.includes("l");
      const top = d.h.includes("t");
      const ax = left ? s.x1 : s.x0;
      const ay = top ? s.y1 : s.y0;
      const sx = left ? -1 : 1;
      const sy = top ? -1 : 1;

      let fx = Math.max((x - ax) * sx, (y - ay) * sy * k, 0);
      const maxFx = Math.min(sx > 0 ? 1 - ax : ax, (sy > 0 ? 1 - ay : ay) * k);
      fx = Math.min(Math.max(fx, MIN), maxFx);
      const fy = fx / k;

      const cx = ax + sx * fx;
      const cy = ay + sy * fy;
      setRect({
        x0: Math.min(ax, cx),
        y0: Math.min(ay, cy),
        x1: Math.max(ax, cx),
        y1: Math.max(ay, cy),
      });
      return;
    }

    // free resize (corners and edges)
    let { x0, y0, x1, y1 } = s;
    if (d.h.includes("l")) x0 = clamp(x, 0, x1 - MIN);
    if (d.h.includes("r")) x1 = clamp(x, x0 + MIN, 1);
    if (d.h.includes("t")) y0 = clamp(y, 0, y1 - MIN);
    if (d.h.includes("b")) y1 = clamp(y, y0 + MIN, 1);
    setRect({ x0, y0, x1, y1 });
  }

  const up = () => {
    dragRef.current = null;
  };

  const bind = (h: HandleId) => ({
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => down(h, e),
    onPointerMove: move,
    onPointerUp: up,
    onPointerCancel: up,
  });

  // Largest box of the chosen shape that fits inside the current box
  function fitRatio(s: Rect, r: number): Rect {
    const k = (r * full.h) / full.w;
    const w = s.x1 - s.x0;
    const h = s.y1 - s.y0;
    const fx = Math.max(MIN, Math.min(w, h * k));
    const fy = fx / k;
    const cx = (s.x0 + s.x1) / 2;
    const cy = (s.y0 + s.y1) / 2;
    const x0 = clamp(cx - fx / 2, 0, 1 - fx);
    const y0 = clamp(cy - fy / 2, 0, 1 - fy);
    return { x0, y0, x1: x0 + fx, y1: y0 + fy };
  }

  function choose(id: string) {
    setPreset(id);
    let r: number | null = null;
    if (id === "orig") r = pageRatio;
    else if (id === "a4") r = pageRatio >= 1 ? 297 / 210 : 210 / 297;
    else if (id === "letter") r = pageRatio >= 1 ? 11 / 8.5 : 8.5 / 11;
    else if (id === "square") r = 1;
    setLock(r);
    if (r) setRect((cur) => fitRatio(cur, r));
  }

  function reset() {
    setRect({ x0: 0, y0: 0, x1: 1, y1: 1 });
    setLock(null);
    setPreset("free");
  }

  function done() {
    const isFull = rect.x0 <= 0.002 && rect.y0 <= 0.002 && rect.x1 >= 0.998 && rect.y1 >= 0.998;
    onApply(
      isFull ? null : { u: rect.x0, v: rect.y0, w: rect.x1 - rect.x0, h: rect.y1 - rect.y0 },
      applyAll
    );
  }

  const w = rect.x1 - rect.x0;
  const h = rect.y1 - rect.y0;
  const pct = (n: number) => `${n * 100}%`;
  const mm = (frac: number, pts: number) => Math.round((frac * pts * 25.4) / 72);
  const dim = `M0 0H1V1H0Z M${rect.x0} ${rect.y0}H${rect.x1}V${rect.y1}H${rect.x0}Z`;

  return (
    <div className="se" role="dialog" aria-label="Crop page">
      <div className="se-top">
        <button className="se-link" onClick={onCancel}>
          Cancel
        </button>
        <div className="ce-title">
          <strong>Crop page {pageNumber}</strong>
          <span>of {pageCount}</span>
        </div>
        <button className="se-save" onClick={done} disabled={status !== "ready"}>
          Done
        </button>
      </div>

      <div className="se-view">
        <div
          ref={stageRef}
          className="se-stage"
          style={{
            aspectRatio: `${full.w} / ${full.h}`,
            width: `min(100%, calc((100dvh - 260px) * ${pageRatio}))`,
          }}
        >
          <canvas ref={canvasRef} className="ce-canvas" />

          <svg viewBox="0 0 1 1" preserveAspectRatio="none">
            <path d={dim} fillRule="evenodd" className="se-dim" />
            <g className="ce-grid">
              <line x1={rect.x0 + w / 3} y1={rect.y0} x2={rect.x0 + w / 3} y2={rect.y1} />
              <line x1={rect.x0 + (2 * w) / 3} y1={rect.y0} x2={rect.x0 + (2 * w) / 3} y2={rect.y1} />
              <line x1={rect.x0} y1={rect.y0 + h / 3} x2={rect.x1} y2={rect.y0 + h / 3} />
              <line x1={rect.x0} y1={rect.y0 + (2 * h) / 3} x2={rect.x1} y2={rect.y0 + (2 * h) / 3} />
            </g>
            <rect
              x={rect.x0}
              y={rect.y0}
              width={w}
              height={h}
              className="se-poly"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {/* drag inside the box to move it */}
          <div
            className="ce-body"
            style={{ left: pct(rect.x0), top: pct(rect.y0), width: pct(w), height: pct(h) }}
            {...bind("move")}
          />

          {/* edge handles (only when the shape is free) */}
          {!lock && (
            <>
              <div className="ce-edge" style={{ left: pct((rect.x0 + rect.x1) / 2), top: pct(rect.y0) }} {...bind("t")} />
              <div className="ce-edge" style={{ left: pct((rect.x0 + rect.x1) / 2), top: pct(rect.y1) }} {...bind("b")} />
              <div className="ce-edge v" style={{ left: pct(rect.x0), top: pct((rect.y0 + rect.y1) / 2) }} {...bind("l")} />
              <div className="ce-edge v" style={{ left: pct(rect.x1), top: pct((rect.y0 + rect.y1) / 2) }} {...bind("r")} />
            </>
          )}

          {/* corner handles */}
          <div className="se-handle" style={{ left: pct(rect.x0), top: pct(rect.y0) }} {...bind("tl")} />
          <div className="se-handle" style={{ left: pct(rect.x1), top: pct(rect.y0) }} {...bind("tr")} />
          <div className="se-handle" style={{ left: pct(rect.x1), top: pct(rect.y1) }} {...bind("br")} />
          <div className="se-handle" style={{ left: pct(rect.x0), top: pct(rect.y1) }} {...bind("bl")} />
        </div>

        {status === "loading" && (
          <div className="se-busy">
            <div className="spinner" />
            <span>Loading page…</span>
          </div>
        )}
        {status === "error" && (
          <div className="se-busy">
            <span>Could not show this page.</span>
          </div>
        )}
      </div>

      <p className="ce-size">
        {mm(w, full.w)} × {mm(h, full.h)} mm
      </p>

      <div className="se-bottom col">
        <div className="se-chips">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              className={`se-btn ${preset === p.id ? "on" : ""}`}
              onClick={() => choose(p.id)}
            >
              {p.label}
            </button>
          ))}
          <button className="se-btn" onClick={reset}>
            Reset
          </button>
        </div>

        {pageCount > 1 && (
          <label className="se-check">
            <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} />
            Apply the same crop to all {pageCount} pages
          </label>
        )}
      </div>
    </div>
  );
}