"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import AppNav from "@/components/AppNav";
import PageStage from "@/components/PageStage";
import { getPdfjs } from "@/lib/pdfjs";
import { takePendingPdf } from "@/lib/pdfStore";
import { saveBytes } from "@/lib/saveBytes";
import { uid } from "@/lib/uid";
import {
  A4,
  Annot,
  PageItem,
  Source,
  TextAnnot,
  Tool,
  buildPdf,
  dispSize,
  imageToSource,
  renderItem,
  rotateAnnotCW,
} from "@/lib/pdfEdit";
import "./editor.css";

const Icon = ({ d, size = 18 }: { d: string; size?: number }) => (
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

const P = {
  select: "M5 3l14 9-6 1.5L10 20z",
  text: "M4 7V4h16v3 M9 20h6 M12 4v16",
  draw: "M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  highlight:
    "M9 11l-6 6v3h9l3-3 M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4",
  cover: "M3 5h18v14H3z",
  undo: "M3 7v6h6 M3 13a9 9 0 1 0 3-7.7L3 8",
  trash:
    "M3 6h18 M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6 M10 11v6 M14 11v6 M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2",
  left: "M15 18l-6-6 6-6",
  right: "M9 18l6-6-6-6",
  rotate: "M23 4v6h-6 M20.5 15a9 9 0 1 1-2.1-9.4L23 10",
  copy: "M8 8h12v12H8z M4 16V4h12",
  plus: "M12 5v14 M5 12h14",
  filePlus:
    "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M12 18v-6 M9 15h6",
  save: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z M17 21v-8H7v8 M7 3v5h8",
  edit: "M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
};

const TOOLS: { id: Tool; label: string; d: string }[] = [
  { id: "select", label: "Select", d: P.select },
  { id: "text", label: "Text", d: P.text },
  { id: "draw", label: "Draw", d: P.draw },
  { id: "highlight", label: "Highlight", d: P.highlight },
  { id: "cover", label: "Cover", d: P.cover },
];

const SWATCHES = ["#111827", "#ef4444", "#2563eb", "#16a34a", "#f59e0b", "#facc15", "#ffffff"];

type Msg = { kind: "error" | "ok" | "warn"; text: string } | null;

export default function PdfEditor() {
  const sources = useRef(new Map<string, Source>());
  const thumbsRef = useRef<Record<string, string>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const startedRef = useRef(false);

  const [items, setItems] = useState<PageItem[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [colors, setColors] = useState<Record<Tool, string>>({
    select: "#111827",
    text: "#111827",
    draw: "#2563eb",
    highlight: "#facc15",
    cover: "#ffffff",
  });
  const [textSize, setTextSize] = useState(0.03);
  const [penSize, setPenSize] = useState(0.005);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [textDlg, setTextDlg] = useState<{ id?: string; u: number; v: number; text: string } | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [fileName, setFileName] = useState("edited");
  const [loading, setLoading] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [dragOver, setDragOver] = useState(false);

  const idx = items.findIndex((i) => i.id === currentId);
  const current = idx >= 0 ? items[idx] : null;
  const selected = current?.annots.find((a) => a.id === selectedId) ?? null;

  /* ---------- Opening files ---------- */
  async function openFiles(files: File[]) {
    if (!files.length) return;
    setMsg(null);
    setLoading("Opening…");
    const added: PageItem[] = [];
    const firstOpen = items.length === 0;

    try {
      for (const f of files) {
        if (f.size > 80 * 1024 * 1024) {
          setMsg({ kind: "warn", text: `${f.name} is larger than 80 MB and was skipped.` });
          continue;
        }

        if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
          const bytes = new Uint8Array(await f.arrayBuffer());
          const pdfjs = await getPdfjs();
          const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
          const id = uid();
          sources.current.set(id, { id, kind: "pdf", name: f.name, bytes, doc });
          for (let i = 0; i < doc.numPages; i++) {
            const page = await doc.getPage(i + 1);
            const vp = page.getViewport({ scale: 1 });
            added.push({
              id: uid(), src: id, index: i, blank: false,
              w: vp.width, h: vp.height, rotation: 0, annots: [],
            });
          }
          if (firstOpen && added.length === doc.numPages) {
            setFileName(f.name.replace(/\.pdf$/i, "") + "-edited");
          }
        } else if (f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name)) {
          const { source, w, h } = await imageToSource(f);
          sources.current.set(source.id, source);
          added.push({
            id: uid(), src: source.id, index: 0, blank: false,
            w, h, rotation: 0, annots: [],
          });
        }
      }
    } catch (e) {
      console.error(e);
      const name = (e as { name?: string })?.name;
      setMsg({
        kind: "error",
        text:
          name === "PasswordException" || /encrypt/i.test(String((e as Error)?.message))
            ? "This PDF is password-protected. Remove the password first, then open it again."
            : "Could not open that file. Make sure it is a valid PDF or image.",
      });
    } finally {
      setLoading("");
    }

    if (added.length) {
      setItems((prev) => [...prev, ...added]);
      setCurrentId((prev) => prev ?? added[0].id);
    }
  }

  // PDF handed over from the scanner page
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const pending = takePendingPdf();
    if (pending) {
      const file = new File([pending.bytes.slice().buffer as ArrayBuffer], pending.name, {
        type: "application/pdf",
      });
      openFiles([file]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- Thumbnails (rendered one by one) ---------- */
  const sig = useMemo(() => items.map((i) => `${i.id}:${i.rotation}`).join("|"), [items]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const it of items) {
        const key = `${it.id}:${it.rotation}`;
        if (thumbsRef.current[key]) continue;
        try {
          const c = await renderItem(it, sources.current.get(it.src), 220);
          if (cancelled) return;
          thumbsRef.current[key] = c.toDataURL("image/jpeg", 0.7);
          setThumbs({ ...thumbsRef.current });
        } catch (e) {
          console.error(e);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  useEffect(() => {
    if (!currentId) return;
    document
      .getElementById(`thumb-${currentId}`)
      ?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [currentId]);

  /* ---------- Page operations ---------- */
  const patch = (id: string, fn: (i: PageItem) => PageItem) =>
    setItems((prev) => prev.map((i) => (i.id === id ? fn(i) : i)));

  function goTo(id: string) {
    setCurrentId(id);
    setSelectedId(null);
  }

  function movePage(dir: -1 | 1) {
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    setItems((prev) => {
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }

  function rotatePage() {
    if (!current) return;
    const d = dispSize(current);
    patch(current.id, (i) => ({
      ...i,
      rotation: (i.rotation + 90) % 360,
      annots: i.annots.map((a) => rotateAnnotCW(a, d.w, d.h)),
    }));
    setSelectedId(null);
  }

  function duplicatePage() {
    if (!current) return;
    const copy: PageItem = {
      ...current,
      id: uid(),
      annots: current.annots.map((a) => ({ ...a, id: uid() }) as Annot),
    };
    setItems((prev) => [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)]);
    goTo(copy.id);
  }

  function deletePage() {
    if (!current) return;
    const next = items[idx + 1] ?? items[idx - 1] ?? null;
    setItems((prev) => prev.filter((i) => i.id !== current.id));
    setCurrentId(next ? next.id : null);
    setSelectedId(null);
  }

  function addBlank() {
    const blank: PageItem = {
      id: uid(), src: "", index: 0, blank: true,
      w: A4.w, h: A4.h, rotation: 0, annots: [],
    };
    const at = idx >= 0 ? idx + 1 : items.length;
    setItems((prev) => [...prev.slice(0, at), blank, ...prev.slice(at)]);
    goTo(blank.id);
  }

  /* ---------- Annotation operations ---------- */
  const setAnnots = (annots: Annot[]) => current && patch(current.id, (i) => ({ ...i, annots }));

  function updateAnnot(id: string, fn: (a: Annot) => Annot) {
    if (!current) return;
    patch(current.id, (i) => ({ ...i, annots: i.annots.map((a) => (a.id === id ? fn(a) : a)) }));
  }

  function deleteAnnot(id: string) {
    if (!current) return;
    patch(current.id, (i) => ({ ...i, annots: i.annots.filter((a) => a.id !== id) }));
    setSelectedId(null);
  }

  function undo() {
    if (!current || !current.annots.length) return;
    patch(current.id, (i) => ({ ...i, annots: i.annots.slice(0, -1) }));
    setSelectedId(null);
  }

  function changeTool(t: Tool) {
    setTool(t);
    setSelectedId(null);
  }

  function pickColor(c: string) {
    if (selected) updateAnnot(selected.id, (a) => ({ ...a, color: c }) as Annot);
    else setColors((prev) => ({ ...prev, [tool]: c }));
  }

  const sizeKind: "text" | "draw" | null =
    selected?.type === "text" ? "text"
    : selected?.type === "draw" ? "draw"
    : selected ? null
    : tool === "text" ? "text"
    : tool === "draw" ? "draw"
    : null;

  const sizeVal =
    selected?.type === "text" ? selected.size
    : selected?.type === "draw" ? selected.width
    : sizeKind === "text" ? textSize
    : penSize;

  function setSizeVal(v: number) {
    if (selected?.type === "text") updateAnnot(selected.id, (a) => ({ ...a, size: v }) as Annot);
    else if (selected?.type === "draw") updateAnnot(selected.id, (a) => ({ ...a, width: v }) as Annot);
    else if (sizeKind === "text") setTextSize(v);
    else setPenSize(v);
  }

  function submitText() {
    if (!textDlg || !current) return;
    const t = textDlg.text.replace(/\s+$/, "");
    if (textDlg.id) {
      if (!t) deleteAnnot(textDlg.id);
      else updateAnnot(textDlg.id, (a) => (a.type === "text" ? { ...a, text: t } : a));
    } else if (t) {
      const a: TextAnnot = {
        id: uid(), type: "text", u: textDlg.u, v: textDlg.v,
        text: t, size: textSize, color: colors.text,
      };
      patch(current.id, (i) => ({ ...i, annots: [...i.annots, a] }));
    }
    setTextDlg(null);
  }

  // Delete key removes the selected annotation (desktop)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || textDlg) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        deleteAnnot(selectedId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, textDlg, currentId]);

  /* ---------- Save ---------- */
  async function save() {
    if (!items.length) return;
    setSaving(true);
    setMsg(null);
    try {
      const bytes = await buildPdf(items, sources.current);
      const safe = fileName.trim().replace(/[^\w\- ]+/g, "") || "edited";
      await saveBytes(bytes, `${safe}.pdf`);
      setMsg({ kind: "ok", text: "Your edited PDF was saved." });
    } catch (e) {
      console.error(e);
      setMsg({
        kind: "error",
        text: "Could not save the PDF. If it keeps failing, try removing very large pages or reopening the file.",
      });
    } finally {
      setSaving(false);
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    openFiles(Array.from(e.dataTransfer.files));
  };

  /* ---------- UI ---------- */
  return (
    <>
      <AppNav />

      <input
        ref={fileInput}
        type="file"
        className="visually-hidden"
        accept="application/pdf,.pdf,image/*"
        multiple
        tabIndex={-1}
        onChange={(e) => {
          openFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      {items.length === 0 ? (
        <main
          className="pe-open"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <div className={`pe-drop ${dragOver ? "over" : ""}`}>
            <div className="pe-drop-ico">
              <Icon d={P.edit} size={30} />
            </div>
            <h1>Edit a PDF</h1>
            <p>
              Open a PDF from your phone or laptop. Add text, draw or sign, highlight, cover parts,
              and rearrange pages, then save.
            </p>
            <button className="pe-primary" onClick={() => fileInput.current?.click()}>
              Choose a PDF
            </button>
            <small>or drop a file here. Images can be added as pages too.</small>
            <Link href="/scan/" className="pe-alt">
              Make a PDF from photos instead →
            </Link>
          </div>
          {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}
        </main>
      ) : (
        <div className="pe">
          {/* Top bar */}
          <div className="pe-head">
            <div className="input-wrap pe-name">
              <input
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                maxLength={60}
                aria-label="File name"
                disabled={saving}
              />
              <span>.pdf</span>
            </div>
            <button className="pe-primary" onClick={save} disabled={saving}>
              {saving ? <div className="spinner" /> : <Icon d={P.save} />}
              <span>{saving ? "Saving…" : "Save PDF"}</span>
            </button>
          </div>

          {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}

          <div className="pe-body">
            {/* Main: tools + page */}
            <div className="pe-main">
              <div className="pe-tools" role="toolbar" aria-label="Tools">
                {TOOLS.map((t) => (
                  <button
                    key={t.id}
                    className={`pe-tool ${tool === t.id ? "on" : ""}`}
                    onClick={() => changeTool(t.id)}
                  >
                    <Icon d={t.d} />
                    <span>{t.label}</span>
                  </button>
                ))}
                <span className="pe-sep" />
                <button className="pe-tool" onClick={undo} disabled={!current?.annots.length}>
                  <Icon d={P.undo} />
                  <span>Undo</span>
                </button>
              </div>

              {(tool !== "select" || selected) && (
                <div className="pe-ctx">
                  <div className="pe-swatches">
                    {SWATCHES.map((c) => (
                      <button
                        key={c}
                        className={`pe-sw ${(selected ? selected.color : colors[tool]) === c ? "on" : ""}`}
                        style={{ background: c }}
                        onClick={() => pickColor(c)}
                        aria-label={`Color ${c}`}
                      />
                    ))}
                  </div>

                  {sizeKind && (
                    <label className="pe-size">
                      <span>Size</span>
                      <input
                        type="range"
                        min={sizeKind === "text" ? 0.012 : 0.002}
                        max={sizeKind === "text" ? 0.09 : 0.02}
                        step={sizeKind === "text" ? 0.002 : 0.001}
                        value={sizeVal}
                        onChange={(e) => setSizeVal(Number(e.target.value))}
                      />
                    </label>
                  )}

                  {selected && (
                    <div className="pe-sel-actions">
                      {selected.type === "text" && (
                        <button
                          className="pe-chip"
                          onClick={() =>
                            setTextDlg({ id: selected.id, u: selected.u, v: selected.v, text: selected.text })
                          }
                        >
                          <Icon d={P.edit} size={15} /> Edit text
                        </button>
                      )}
                      <button className="pe-chip danger" onClick={() => deleteAnnot(selected.id)}>
                        <Icon d={P.trash} size={15} /> Delete
                      </button>
                    </div>
                  )}
                </div>
              )}

              <p className="pe-hint">
                {tool === "select" && "Tap an item to select, move or recolor it. Double-click text to edit."}
                {tool === "text" && "Tap on the page where you want to add text."}
                {tool === "draw" && "Draw or sign with your finger or mouse."}
                {tool === "highlight" && "Drag over an area to highlight it."}
                {tool === "cover" && "Drag to cover an area with a solid box."}
              </p>

              <div className="pe-pager">
                <button className="icon-btn" onClick={() => items[idx - 1] && goTo(items[idx - 1].id)} disabled={idx <= 0} aria-label="Previous page">
                  <Icon d={P.left} />
                </button>
                <strong>
                  Page {idx + 1} of {items.length}
                </strong>
                <button className="icon-btn" onClick={() => items[idx + 1] && goTo(items[idx + 1].id)} disabled={idx >= items.length - 1} aria-label="Next page">
                  <Icon d={P.right} />
                </button>
              </div>

              <div className="pe-stage-card">
                {current && (
                  <PageStage
                    key={current.id}
                    item={current}
                    source={sources.current.get(current.src)}
                    tool={tool}
                    color={colors[tool]}
                    penSize={penSize}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onChange={setAnnots}
                    onTextRequest={(req) => setTextDlg(req)}
                  />
                )}
              </div>
            </div>

            {/* Side: page organizer */}
            <aside className="pe-side">
              <div className="pe-pagebar">
                <button className="pe-chip" onClick={() => movePage(-1)} disabled={idx <= 0} title="Move earlier">
                  <Icon d={P.left} size={15} /> Earlier
                </button>
                <button className="pe-chip" onClick={() => movePage(1)} disabled={idx >= items.length - 1} title="Move later">
                  Later <Icon d={P.right} size={15} />
                </button>
                <button className="pe-chip" onClick={rotatePage}>
                  <Icon d={P.rotate} size={15} /> Rotate
                </button>
                <button className="pe-chip" onClick={duplicatePage}>
                  <Icon d={P.copy} size={15} /> Duplicate
                </button>
                <button className="pe-chip danger" onClick={deletePage}>
                  <Icon d={P.trash} size={15} /> Delete
                </button>
                <button className="pe-chip" onClick={addBlank}>
                  <Icon d={P.plus} size={15} /> Blank page
                </button>
                <button className="pe-chip" onClick={() => fileInput.current?.click()}>
                  <Icon d={P.filePlus} size={15} /> Add PDF / images
                </button>
              </div>

              <div className="pe-pages">
                {items.map((it, n) => {
                  const key = `${it.id}:${it.rotation}`;
                  const d = dispSize(it);
                  return (
                    <button
                      key={it.id}
                      id={`thumb-${it.id}`}
                      className={`pe-thumb ${it.id === currentId ? "on" : ""}`}
                      onClick={() => goTo(it.id)}
                      aria-label={`Page ${n + 1}`}
                    >
                      <div className="pe-thumb-img" style={{ aspectRatio: `${d.w} / ${d.h}` }}>
                        {thumbs[key] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumbs[key]} alt="" />
                        ) : (
                          <div className="pe-skel" />
                        )}
                      </div>
                      <span className="pe-num">{n + 1}</span>
                      {it.annots.length > 0 && <span className="pe-dot" />}
                    </button>
                  );
                })}
              </div>
            </aside>
          </div>
        </div>
      )}

      {loading && (
        <div className="pe-loading">
          <div className="spinner" />
          <span>{loading}</span>
        </div>
      )}

      {textDlg && (
        <div className="pe-modal" onClick={() => setTextDlg(null)}>
          <div className="pe-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>{textDlg.id ? "Edit text" : "Add text"}</h3>
            <textarea
              autoFocus
              rows={4}
              value={textDlg.text}
              placeholder="Type here…"
              onChange={(e) => setTextDlg({ ...textDlg, text: e.target.value })}
            />
            <p className="pe-dialog-note">Letters from English and most European languages are supported.</p>
            <div className="pe-dialog-actions">
              <button className="pe-chip" onClick={() => setTextDlg(null)}>
                Cancel
              </button>
              <button className="pe-primary" onClick={submitText}>
                {textDlg.id ? "Update" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}