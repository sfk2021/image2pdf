import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import type { jsPDF } from "jspdf";

export async function savePdf(pdf: jsPDF, fileName: string) {
  // Native app (Capacitor): save file + open share sheet
  if (Capacitor.isNativePlatform()) {
    const base64 = pdf.output("datauristring").split(",")[1];
    const file = await Filesystem.writeFile({
      path: fileName,
      data: base64,
      directory: Directory.Cache,
    });
    await Share.share({ title: fileName, url: file.uri });
    return;
  }

  // Mobile browsers: try the share sheet with the PDF file
  const blob = pdf.output("blob");
  const file = new File([blob], fileName, { type: "application/pdf" });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName });
      return;
    } catch (e) {
      // User cancelled the sheet: stop quietly
      if (e instanceof DOMException && e.name === "AbortError") return;
      // Otherwise fall through to a normal download
    }
  }

  // Desktop / fallback: normal download
  pdf.save(fileName);
}