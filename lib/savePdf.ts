import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import type { jsPDF } from "jspdf";

export async function savePdf(pdf: jsPDF, fileName: string) {
  if (Capacitor.isNativePlatform()) {
    const base64 = pdf.output("datauristring").split(",")[1];
    const file = await Filesystem.writeFile({
      path: fileName,
      data: base64,
      directory: Directory.Cache,
    });
    await Share.share({ title: fileName, url: file.uri });
  } else {
    pdf.save(fileName);
  }
}