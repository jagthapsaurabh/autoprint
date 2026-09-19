// Dev helper: generates a throwaway multi-page PDF for manually testing the
// multi-file upload/merge flow (not used by the app itself).
//
// Usage:
//   cd apps/server && node scripts/make-test-pdf.mjs [outputPath] [pageCount]
import { PDFDocument } from "pdf-lib";
import fs from "node:fs";

const outputPath = process.argv[2] || "/tmp/multipage.pdf";
const pageCount = Number(process.argv[3]) || 3;

const doc = await PDFDocument.create();
for (let i = 0; i < pageCount; i++) {
  doc.addPage([200, 200]);
}
const bytes = await doc.save();
fs.writeFileSync(outputPath, bytes);
console.log(`created ${pageCount}-page pdf at ${outputPath}`);
