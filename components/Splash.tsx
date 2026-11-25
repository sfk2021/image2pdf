"use client";

import { useEffect, useRef, useState } from "react";

export default function Splash() {
  const [phase, setPhase] = useState<"show" | "out" | "gone">("show");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    let seen = false;
    try {
      seen = sessionStorage.getItem("splash-seen") === "1";
    } catch {}
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (seen || reduce) {
      setPhase("gone");
      return;
    }
    try {
      sessionStorage.setItem("splash-seen", "1");
    } catch {}
    setTimeout(() => setPhase("out"), 1800);
    setTimeout(() => setPhase("gone"), 2500);
  }, []);

  if (phase === "gone") return null;

  return (
    <div className={`splash ${phase === "out" ? "out" : ""}`} aria-hidden="true">
      <div className="splash-logo">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M9 15h6 M9 11h2" />
        </svg>
        <span className="splash-scan" />
      </div>
      <div className="splash-name">Image to PDF</div>
      <div className="splash-tag">Scan · Clean up · Edit · Share</div>
      <div className="splash-bar">
        <span />
      </div>
    </div>
  );
}