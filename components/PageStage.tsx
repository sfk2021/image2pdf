"use client";

import { useEffect, useRef, useState } from "react";
import {
  Annot,
  DrawAnnot,
  RectAnnot,
  PageItem,
  Source,
  Tool,
  dispSize,
  renderItem,
  translateAnnot,
} from "@/lib/pdfEdit";
import { uid } from "@/lib/uid";

type Draft = DrawAnnot | RectAnnot;

type Props = {
  item: PageItem;
  source?: Source;
  tool: Tool;
  color: string;
  penSize: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (annots: Annot[]) => void;
  onTextRequest: (req: { id?: string; u: number; v: number; text: string }) => void;
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export default function PageStage({
  item,
  source,
  tool,
  color,
  penSize,
  selectedId,
  onSelect,
  onChange,
  onTextRequest,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const tokenRef = useRef(0);
  const startRef = useRef<[number, number]>([0, 0]);
  const dragRef = useRef<{ id: string; start: [number, number]; orig: Annot } | null>(null);

  const [sw, setSw] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);

  const d = dispSize(item);
  const sh = (sw * d.h) / d.w;
  const interactive = tool === "select";

  // Measure the width available for the page
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSw(el.clientWidth));
    ro.observe(el);
    setSw(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Render the page into the canvas
  useEffect(() => {
    if (!sw) return;
    const token = ++tokenRef.current;
    (async () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const tmp = await renderItem(item, source, Math.round(sw * dpr));
      const c = canvasRef.current;
      if (token !== tokenRef.current || !c) return;
      c.width = tmp.width;
      c.height = tmp.height;
      c.getContext("2d")!.drawImage(tmp, 0, 0);
    })().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.rotation, item.index, item.w, item.h, source, sw]);

  const pos = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = overlayRef.current!.getBoundingClientRect();
    return [clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height)];
  };

  /* ----- drawing new things ----- */
  function down(e: React.PointerEvent<HTMLDivElement>) {
    const [u, v] = pos(e);
    if (tool === "select") {
      onSelect(null);
      return;
    }
    if (tool === "text") {
      onTextRequest({ u, v, text: "" });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    startRef.current = [u, v];
    if (tool === "draw") {
      setDraft({ id: "draft", type: "draw", points: [[u, v]], width: penSize, color });
    } else {
      setDraft({ id: "draft", type: tool, u, v, w: 0, h: 0, color });
    }
  }

  function move(e: React.PointerEvent<HTMLDivElement>) {
    if (!draft) return;
    const [u, v] = pos(e);
    if (draft.type === "draw") {
      setDraft({ ...draft, points: [...draft.points, [u, v]] });
    } else {
      const [su, sv] = startRef.current;
      setDraft({
        ...draft,
        u: Math.min(su, u),
        v: Math.min(sv, v),
        w: Math.abs(u - su),
        h: Math.abs(v - sv),
      });
    }
  }

  function up() {
    if (!draft) return;
    const ok = draft.type === "draw" || (draft.w > 0.005 && draft.h > 0.005);
    if (ok) onChange([...item.annots, { ...draft, id: uid() }]);
    setDraft(null);
  }

  /* ----- moving existing things (select tool) ----- */
  function startDrag(e: React.PointerEvent<Element>, a: Annot) {
    e.stopPropagation();
    onSelect(a.id);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragRef.current = { id: a.id, start: pos(e), orig: a };
  }

  function moveDrag(e: React.PointerEvent<Element>) {
    const g = dragRef.current;
    if (!g) return;
    const [u, v] = pos(e);
    onChange(
      item.annots.map((a) =>
        a.id === g.id ? translateAnnot(g.orig, u - g.start[0], v - g.start[1]) : a
      )
    );
  }

  const endDrag = () => {
    dragRef.current = null;
  };

  const all: Annot[] = draft ? [...item.annots, draft] : item.annots;
  const pe = interactive ? "auto" : "none";

  return (
    <div ref={wrapRef} className="pe-stage" style={{ aspectRatio: `${d.w} / ${d.h}` }}>
      <canvas ref={canvasRef} className="pe-canvas" />

      <div
        ref={overlayRef}
        className={`pe-overlay tool-${tool}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        {sw > 0 && (
          <svg className="pe-svg" width={sw} height={sh} viewBox={`0 0 ${sw} ${sh}`}>
            {all.map((a) => {
              if (a.type !== "draw") return null;
              const pts = a.points.map(([u, v]) => `${u * sw},${v * sh}`).join(" ");
              const sel = a.id === selectedId;
              const sWidth = Math.max(1, a.width * sw);
              const handlers = {
                onPointerDown: (e: React.PointerEvent<SVGElement>) => startDrag(e, a),
                onPointerMove: moveDrag,
                onPointerUp: endDrag,
              };
              return (
                <g key={a.id}>
                  {sel && (
                    <polyline
                      points={pts}
                      fill="none"
                      stroke="#3b82f6"
                      strokeOpacity={0.35}
                      strokeWidth={sWidth + 8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                  {a.points.length === 1 ? (
                    <circle cx={a.points[0][0] * sw} cy={a.points[0][1] * sh} r={sWidth / 2} fill={a.color} />
                  ) : (
                    <polyline
                      points={pts}
                      fill="none"
                      stroke={a.color}
                      strokeWidth={sWidth}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                  <polyline
                    points={pts}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={Math.max(sWidth, 18)}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pointerEvents={interactive ? "stroke" : "none"}
                    style={{ touchAction: "none" }}
                    {...handlers}
                  />
                </g>
              );
            })}
          </svg>
        )}

        {all.map((a) => {
          if (a.type === "text") {
            return (
              <div
                key={a.id}
                className={`pe-text ${a.id === selectedId ? "sel" : ""}`}
                style={{
                  left: `${a.u * 100}%`,
                  top: `${a.v * 100}%`,
                  fontSize: a.size * sw,
                  color: a.color,
                  pointerEvents: pe,
                }}
                onPointerDown={(e) => startDrag(e, a)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onDoubleClick={() =>
                  onTextRequest({ id: a.id, u: a.u, v: a.v, text: a.text })
                }
              >
                {a.text}
              </div>
            );
          }
          if (a.type === "highlight" || a.type === "cover") {
            return (
              <div
                key={a.id}
                className={`pe-rect ${a.id === selectedId ? "sel" : ""}`}
                style={{
                  left: `${a.u * 100}%`,
                  top: `${a.v * 100}%`,
                  width: `${a.w * 100}%`,
                  height: `${a.h * 100}%`,
                  background: a.color,
                  opacity: a.type === "highlight" ? 0.35 : 1,
                  pointerEvents: pe,
                }}
                onPointerDown={(e) => startDrag(e, a)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
              />
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}