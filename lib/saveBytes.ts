import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

function toBase64(bytes: Uint8Array) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** Saves or shares a PDF. Returns false if the person cancelled the share sheet. */
export async function saveBytes(bytes: Uint8Array, fileName: string): Promise<boolean> {
  // Native app (Capacitor): save the file, then open the share sheet
  if (Capacitor.isNativePlatform()) {
    const file = await Filesystem.writeFile({
      path: fileName,
      data: toBase64(bytes),
      directory: Directory.Cache,
    });
    try {
      await Share.share({ title: fileName, url: file.uri });
      return true;
    } catch (e) {
      if (/cancel/i.test(String((e as Error)?.message))) return false;
      throw e;
    }
  }

  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], {
    type: "application/pdf",
  });
  const file = new File([blob], fileName, { type: "application/pdf" });

  // Mobile browsers: share sheet (Save to Files, AirDrop, WhatsApp...)
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName });
      return true;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return false;
      // anything else: fall through to a normal download
    }
  }

  // Desktop / fallback: normal download
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}