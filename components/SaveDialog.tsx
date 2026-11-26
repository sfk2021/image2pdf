"use client";

import { useEffect, useRef, useState } from "react";
import { cleanName } from "@/lib/fileName";

type Props = {
  defaultName: string;
  detail?: string; // e.g. "3 pages · 1.2 MB"
  saving: boolean;
  error?: string;
  onSave: (name: string) => void; // name without ".pdf"
  onPreview?: () => void; // opens the PDF so it can be checked first
  onCancel: () => void;
};

export default function SaveDialog({
  defaultName,
  detail,
  saving,
  error,
  onSave,
  onPreview,
  onCancel,
}: Props) {
  const [name, setName] = useState(defaultName);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(onCancel);
  const savingRef = useRef(saving);

  useEffect(() => {
    cancelRef.current = onCancel;
    savingRef.current = saving;
  });

  const clean = cleanName(name, "");
  const changed = clean !== "" && clean !== name.trim();

  // Focus and select the suggested name so the person can type straight away
  useEffect(() => {
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 60);
    return () => clearTimeout(t);
  }, []);

  // Lock page scroll, close on Escape
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !savingRef.current) cancelRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!clean || saving) return;
    onSave(clean);
  }

  return (
    <div className="sd-modal" onClick={() => !saving && onCancel()}>
      <form
        className="sd-card"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sd-title"
      >
        <div className="sd-ico">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M9 15h6 M9 11h2" />
          </svg>
        </div>

        <h3 id="sd-title">Name your PDF</h3>
        {detail && <p className="sd-sub">{detail}</p>}

        {onPreview && (
          <button type="button" className="sd-preview" onClick={onPreview} disabled={saving}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
            </svg>
            Preview PDF
          </button>
        )}

        <label htmlFor="sd-name">File name</label>
        <div className="input-wrap">
          <input
            id="sd-name"
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="done"
            disabled={saving}
          />
          <span>.pdf</span>
        </div>

        {!clean && <p className="sd-warn">Please enter a file name.</p>}
        {changed && (
          <p className="sd-note">Will be saved as “{clean}.pdf” (some characters can’t be used).</p>
        )}
        {error && <p className="sd-err">{error}</p>}

        <div className="sd-actions">
          <button type="button" className="sd-btn ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="sd-btn primary" disabled={!clean || saving}>
            {saving ? (
              <>
                <div className="spinner" /> Saving…
              </>
            ) : (
              "Save PDF"
            )}
          </button>
        </div>

        <p className="sd-note center">
          On a phone this opens the share sheet. Choose “Save to Files” (iPhone) or a folder or
          Drive (Android).
        </p>
      </form>
    </div>
  );
}