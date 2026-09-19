// Merges one or more uploaded files (PDFs and/or images) into a single
// print-ready PDF, in the order they were uploaded. This is what lets a
// customer add multiple photos and/or multiple PDFs in one go and get them
// all queued (and printed) as a single job — instead of only supporting one
// file at a time.
//
// Images are decoded with `jimp` (pure JS, no native build step) and each
// placed on its own A4-ish page sized to the image's own aspect ratio so
// photos aren't awkwardly stretched. PDF pages are copied through as-is
// (including their own page counts) via pdf-lib.
import { PDFDocument } from "pdf-lib";
import { Jimp } from "jimp";
import fs from "node:fs/promises";

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/bmp", "image/gif"]);
const PDF_MIME_TYPE = "application/pdf";

// A4 at 72dpi (PDF's default unit), matches how pdf-lib measures pages.
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MAX_DIMENSION = 2000; // downscale very large phone photos before embedding

export function isSupportedForMerge(mimeType) {
  return mimeType === PDF_MIME_TYPE || IMAGE_MIME_TYPES.has(mimeType);
}

export function isImage(mimeType) {
  return IMAGE_MIME_TYPES.has(mimeType);
}

async function countPdfPages(filePath, password) {
  const bytes = await fs.readFile(filePath);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, password });
  return doc.getPageCount() || 1;
}

/**
 * Returns the number of pages a single file will occupy once merged
 * (PDFs: their real page count; images: always 1).
 */
export async function countPagesForFile(filePath, mimeType, password) {
  if (mimeType === PDF_MIME_TYPE) {
    try {
      return await countPdfPages(filePath, password);
    } catch {
      return 1;
    }
  }
  return 1;
}

async function embedImagePage(pdfDoc, filePath) {
  const image = await Jimp.read(filePath);
  // Downscale oversized phone camera photos to keep the merged PDF small
  // and printing fast, without visibly hurting print quality.
  if (image.bitmap.width > MAX_DIMENSION || image.bitmap.height > MAX_DIMENSION) {
    image.scaleToFit({ w: MAX_DIMENSION, h: MAX_DIMENSION });
  }
  const jpegBuffer = await image.getBuffer("image/jpeg", { quality: 92 });
  // pdf-lib's JPEG embedder reads `buffer.buffer` directly with a DataView,
  // ignoring byteOffset/length — if the Buffer we hand it is a view into a
  // larger pooled ArrayBuffer (common with small buffers from libraries like
  // jimp), that breaks with "SOI not found in JPEG". Copying into a
  // dedicated Uint8Array avoids that footgun.
  const jpegBytes = Uint8Array.from(jpegBuffer);
  const embedded = await pdfDoc.embedJpg(jpegBytes);

  // Fit the image onto an A4 page (with a small margin), preserving aspect ratio.
  const margin = 24;
  const maxW = A4_WIDTH - margin * 2;
  const maxH = A4_HEIGHT - margin * 2;
  const scale = Math.min(maxW / embedded.width, maxH / embedded.height, 1);
  const drawW = embedded.width * scale;
  const drawH = embedded.height * scale;

  const page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  page.drawImage(embedded, {
    x: (A4_WIDTH - drawW) / 2,
    y: (A4_HEIGHT - drawH) / 2,
    width: drawW,
    height: drawH,
  });
}

async function appendPdf(pdfDoc, filePath, password) {
  const bytes = await fs.readFile(filePath);
  const srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true, password });
  const pageIndices = srcDoc.getPageIndices();
  const copiedPages = await pdfDoc.copyPages(srcDoc, pageIndices);
  copiedPages.forEach((page) => pdfDoc.addPage(page));
}

/**
 * Merges an ordered list of uploaded files into a single PDF on disk.
 * @param {{filePath: string, mimeType: string, password?: string}[]} files
 * @param {string} outputPath
 * @returns {Promise<{pages: number}>}
 */
export async function mergeFilesToPdf(files, outputPath) {
  const pdfDoc = await PDFDocument.create();

  for (const file of files) {
    if (file.mimeType === PDF_MIME_TYPE) {
      await appendPdf(pdfDoc, file.filePath, file.password);
    } else if (IMAGE_MIME_TYPES.has(file.mimeType)) {
      await embedImagePage(pdfDoc, file.filePath);
    } else {
      throw new Error(`Unsupported file type for printing: ${file.mimeType}`);
    }
  }

  const mergedBytes = await pdfDoc.save();
  await fs.writeFile(outputPath, mergedBytes);
  return { pages: pdfDoc.getPageCount() };
}
