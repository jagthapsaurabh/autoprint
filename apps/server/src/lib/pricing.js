import { PDFDocument } from "pdf-lib";
import fs from "node:fs/promises";

export async function countPages(filePath, mimeType) {
  if (mimeType === "application/pdf") {
    try {
      const bytes = await fs.readFile(filePath);
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      return doc.getPageCount() || 1;
    } catch (err) {
      return 1;
    }
  }
  // images and everything else count as a single page
  return 1;
}

export function computeAmount({ pages, copies, colorMode, colorRate, grayRate }) {
  const rate = colorMode === "COLOR" ? colorRate : grayRate;
  const total = Math.max(1, pages) * Math.max(1, copies) * rate;
  return Math.round(total * 100) / 100;
}
