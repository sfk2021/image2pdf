/** Cleans what the user typed so it is safe as a file name (without ".pdf"). */
export function cleanName(raw: string, fallback = "document"): string {
  // eslint-disable-next-line no-control-regex
  let s = raw.replace(/[\u0000-\u001f\\/:*?"<>|]/g, "").trim();
  s = s.replace(/\.pdf$/i, "").trim();
  s = s.replace(/[. ]+$/g, "");
  s = s.slice(0, 80);
  return s || fallback;
}

/** Suggested name such as "scan-2026-11-26-1042". */
export function defaultName(prefix: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${prefix}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(
    d.getHours()
  )}${p(d.getMinutes())}`;
}