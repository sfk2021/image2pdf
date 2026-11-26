"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useRef, useState } from "react";
import { getPdfjs } from "@/lib/pdfjs";

type Props = {
  bytes: Uint8Array;
  title: string;
  onClose: () => void;
};

const ZOOMS = [1, 1.5, 2, 3];
const MAX_BASE = 900; // widest a page gets at 100% on big screens

function PageCanvas({
  doc,
  num,
  width,
  aspect,
  rootRef,
}: {
  doc: any;
  num: number;
  width: number;
  aspect: number;
  rootRef: React.RefObject<HTMLDivElement | null>;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);

  // Only pages near the screen are drawn
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), {
      root: rootRef.current,
      rootMargin: "800px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [rootRef]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    if (!visible || width < 10) {
      c.width = 0; // free memory for pages that are far away
      c.height = 0;
      return;
    }

    let cancelled = false;
    let task: any = null;

    (async () => {
      try {
        const page = await doc.getPage(num);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const vp0 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: (width * dpr) / vp0.width });
        if (cancelled) return;
        c.width = Math.floor(vp.width);
        c.height = Math.floor(vp.height);
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, c.width, c.height);
        task = page.render({ canvasContext: ctx, viewport: vp });
        await task.promise;
      } catch {
        /* a cancelled render throws; nothing to do */
      }
    })();

    return () => {
      cancelled = true;
      task?.cancel?.();
    };
  }, [visible, width, doc, num]);

  return (
    <div ref={holder} className="pv-page" style={{ width, height: width * aspect }}>
      <canvas ref={canvas} style={{ width: "100%", height: "100%" }} />
      <span className="pv-num">{num}</span>
    </div>
  );
}

export default function PdfViewer({ bytes, title, onClose }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  const [doc, setDoc] = useState<any>(null);
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([]);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(0);
  const [boxW, setBoxW] = useState(0);

  // Load the PDF
  useEffect(() => {
    let cancelled = false;
    let loaded: any = null;

    (async () => {
      try {
        const pdfjs = await getPdfjs();
        const d = await pdfjs.getDocument({ data: bytes.slice() }).promise;
        loaded = d;
        if (cancelled) {
          d.destroy();
          return;
        }
        const list: { w: number; h: number }[] = [];
        for (let i = 1; i <= d.numPages; i++) {
          const p = await d.getPage(i);
          const vp = p.getViewport({ scale: 1 });
          list.push({ w: vp.width, h: vp.height });
        }
        if (cancelled) return;
        setSizes(list);
        setDoc(d);
      } catch (e) {
        console.error(e);
        if (!cancelled) setError("Could not show this PDF here.");
      }
    })();

    return () => {
      cancelled = true;
      loaded?.destroy?.();
    };
  }, [bytes]);

  // Measure the width available for pages
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    setBoxW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Lock page scroll; Escape closes only the viewer (not the window under it)
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);

  function openInTab() {
    const url = URL.createObjectURL(
      new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/pdf" })
    );
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  const base = Math.max(0, Math.min(boxW - 24, MAX_BASE));
  const pageW = base * ZOOMS[zoom];

  return (
    <div className="pv" role="dialog" aria-label="PDF preview">
      <div className="pv-top">
        <button className="pv-close" onClick={onClose}>
          ✕ Close
        </button>
        <div className="pv-title">
          <strong>{title}</strong>
          {sizes.length > 0 && (
            <span>
              {sizes.length} {sizes.length === 1 ? "page" : "pages"}
            </span>
          )}
        </div>
        <div className="pv-zoom">
          <button onClick={() => setZoom((z) => Math.max(0, z - 1))} disabled={zoom === 0} aria-label="Zoom out">
            −
          </button>
          <span>{Math.round(ZOOMS[zoom] * 100)}%</span>
          <button
            onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}
            disabled={zoom === ZOOMS.length - 1}
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      </div>

      <div className="pv-scroll" ref={scrollRef}>
        {error ? (
          <div className="pv-state">
            <p>{error}</p>
            <button className="pv-close" onClick={openInTab}>
              Open in a new tab
            </button>
          </div>
        ) : !doc || boxW === 0 ? (
          <div className="pv-state">
            <div className="spinner" />
            <p>Opening PDF…</p>
          </div>
        ) : (
          <div className="pv-pages">
            {sizes.map((s, i) => (
              <PageCanvas
                key={i}
                doc={doc}
                num={i + 1}
                width={pageW}
                aspect={s.h / s.w}
                rootRef={scrollRef}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}