"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/scan/", label: "Scan" },
  { href: "/editor/", label: "Edit PDF" },
];

export default function AppNav() {
  const path = usePathname() || "/";
  const active = (h: string) =>
    h === "/" ? path === "/" : path.startsWith(h.replace(/\/$/, ""));

  return (
    <nav className="appnav" aria-label="Main">
      <Link href="/" className="appnav-brand">
        <span className="appnav-logo">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6" />
          </svg>
        </span>
        <span>Image to PDF</span>
      </Link>
      <div className="appnav-links">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={active(l.href) ? "on" : ""}>
            {l.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}