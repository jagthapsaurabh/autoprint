import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { nanoid } from "nanoid";
import { prisma } from "../lib/prisma.js";
import { computeAmount } from "../lib/pricing.js";
import { mergeFilesToPdf, isSupportedForMerge, loadPdfPageCount } from "../lib/merge.js";
import { parsePageSpec } from "../lib/pageSelection.js";

export const publicRouter = Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_FILES = 20;
const MAX_FILE_SIZE = 30 * 1024 * 1024; // 30MB per file
const MAX_TOTAL_SIZE = 150 * 1024 * 1024; // 150MB combined per upload batch
const MAX_MERGED_PAGES = 2000; // hard cap on total physical pages per print job

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || "";
    cb(null, `${nanoid(16)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${file.originalname}. Please upload PDF, JPG, PNG or WEBP files.`));
  },
});

function cleanupFiles(files = []) {
  for (const f of files) {
    fs.unlink(f.path, () => {});
  }
}

function multerErrorHandler(err, req, res, next) {
  if (err) {
    if (req.files?.length) cleanupFiles(req.files);
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "One of the files is too large (max 30MB each)." });
      if (err.code === "LIMIT_FILE_COUNT") return res.status(413).json({ error: `You can upload at most ${MAX_FILES} files at once.` });
      return res.status(400).json({ error: err.message });
    }
    return res.status(400).json({ error: err.message || "Upload failed" });
  }
  next();
}

// Public: fetch shop info by shop token (used to render the customer QR-landing page)
publicRouter.get("/shop/:token", async (req, res) => {
  const shop = await prisma.shop.findUnique({ where: { shopToken: req.params.token } });
  if (!shop) return res.status(404).json({ error: "Shop not found. QR may be invalid." });
  if (!shop.subscriptionActive) {
    return res.status(403).json({ error: "This shop's Auto Print service is not active." });
  }
  res.json({
    shop: {
      id: shop.id,
      name: shop.name,
      printRule: shop.printRule,
      paymentMode: shop.paymentMode,
      colorRate: shop.colorRate,
      grayRate: shop.grayRate,
      upiId: shop.upiId,
    },
  });
});

// Public: upload one or more files (PDFs and/or images), merge them in order
// into a single print-ready PDF, and get a computed quote (pages/amount)
// before creating a job. Supports multi-page PDFs and multiple images/PDFs
// combined into one print job.
publicRouter.post("/shop/:token/quote", upload.array("files", MAX_FILES), multerErrorHandler, async (req, res) => {
  try {
    const shop = await prisma.shop.findUnique({ where: { shopToken: req.params.token } });
    if (!shop) {
      cleanupFiles(req.files);
      return res.status(404).json({ error: "Shop not found" });
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "At least one file is required" });
    }

    const totalSize = req.files.reduce((sum, f) => sum + f.size, 0);
    if (totalSize > MAX_TOTAL_SIZE) {
      cleanupFiles(req.files);
      return res.status(413).json({ error: "Combined file size is too large (max 150MB per print job)." });
    }

    for (const f of req.files) {
      if (!isSupportedForMerge(f.mimetype)) {
        cleanupFiles(req.files);
        return res.status(400).json({ error: `Unsupported file type: ${f.originalname}. Please upload PDF, JPG, PNG or WEBP files.` });
      }
    }

    let colorMode = (req.body.colorMode || "GRAY").toUpperCase();
    if (shop.printRule === "ONLY_COLOR") colorMode = "COLOR";
    if (shop.printRule === "ONLY_GRAY") colorMode = "GRAY";

    // Per-file page selection + copies. The web app sends `pageSpecs` as a
    // JSON array aligned with the files' upload order, e.g.
    //   [{"pages":"2-4, 7","copies":2}, {"pages":"","copies":1}]
    // Old clients that only send a single global `copies` (all pages) keep
    // working unchanged.
    const globalCopies = Math.max(1, Math.min(200, parseInt(req.body.copies || "1", 10)));
    let specList = null;
    if (req.body.pageSpecs !== undefined) {
      try {
        specList = JSON.parse(req.body.pageSpecs);
        if (!Array.isArray(specList)) specList = null;
      } catch {
        specList = null;
      }
      if (!specList || specList.length !== req.files.length) {
        return res.status(400).json({ error: "Invalid page selection — it must match the number of files." });
      }
    }

    // Plan each file: how many selected pages it has and how many copies.
    const filePlans = [];
    for (let i = 0; i < req.files.length; i += 1) {
      const f = req.files[i];
      const spec = specList ? specList[i] || {} : {};
      const copies = Math.max(1, Math.min(200, parseInt(spec.copies ?? globalCopies, 10) || 1));

      let selectedPages; // 1-based page numbers to print from this file
      let pagesLabel;
      if (f.mimetype === "application/pdf") {
        let pageCount;
        try {
          pageCount = await loadPdfPageCount(f.path);
        } catch (err) {
          console.error("Failed to read PDF pages:", err);
          cleanupFiles(req.files);
          return res.status(422).json({
            error:
              "Could not process one of the files. If a PDF is password-protected or corrupted, please remove the password / re-export it and try again.",
          });
        }
        const parsed = parsePageSpec(spec.pages, pageCount);
        if (parsed.error) {
          cleanupFiles(req.files);
          return res.status(400).json({ error: `${f.originalname}: ${parsed.error}` });
        }
        selectedPages = parsed.pages;
        pagesLabel = spec.pages ? `pages ${String(spec.pages).trim()}` : `all ${pageCount} pages`;
      } else {
        selectedPages = [1];
        pagesLabel = "1 page";
      }

      filePlans.push({ fileName: f.originalname, pages: selectedPages.length, copies, pageSelection: selectedPages, pagesLabel });
    }

    // If every file wants the same number of copies, don't duplicate pages
    // in the PDF — let the agent print the whole document that many times
    // (one print command, and the dashboard keeps "pages" and "copies"
    // separate). Only when copy counts differ do we bake copies into the
    // merged PDF, since one print command can't vary copies per section.
    const uniformCopies = filePlans.every((p) => p.copies === filePlans[0].copies);
    const jobCopies = uniformCopies ? filePlans[0].copies : 1;
    const bakeInCopies = !uniformCopies;

    const mergedFileName = `${nanoid(16)}.pdf`;
    const mergedFilePath = path.join(UPLOAD_DIR, mergedFileName);

    let pages;
    try {
      const result = await mergeFilesToPdf(
        req.files.map((f, i) => ({
          filePath: f.path,
          mimeType: f.mimetype,
          pageSelection: filePlans[i].pageSelection,
          copies: bakeInCopies ? filePlans[i].copies : 1,
        })),
        mergedFilePath
      );
      pages = result.pages;
    } catch (err) {
      console.error("Merge failed:", err);
      cleanupFiles(req.files);
      return res.status(422).json({
        error:
          "Could not process one of the files. If a PDF is password-protected or corrupted, please remove the password / re-export it and try again.",
      });
    } finally {
      cleanupFiles(req.files);
    }

    if (pages * jobCopies > MAX_MERGED_PAGES) {
      fs.unlinkSync(mergedFilePath);
      return res.status(400).json({
        error: `That's ${pages * jobCopies} pages for one print job (max ${MAX_MERGED_PAGES}). Please split it into smaller jobs.`,
      });
    }

    const amount =
      shop.paymentMode === "NO_PAYMENT"
        ? 0
        : computeAmount({ pages, copies: jobCopies, colorMode, colorRate: shop.colorRate, grayRate: shop.grayRate });

    const fileNames = req.files.map((f) => f.originalname);
    const fileLabel =
      fileNames.length === 1 ? fileNames[0] : `${fileNames.length} files (${fileNames.join(", ")})`;

    res.json({
      fileToken: mergedFileName,
      fileName: fileLabel,
      fileType: "application/pdf",
      fileCount: req.files.length,
      sourceFileNames: fileNames,
      pages,
      copies: jobCopies,
      colorMode,
      amount,
      perFile: filePlans.map((p) => ({ fileName: p.fileName, pages: p.pages, copies: p.copies, pagesLabel: p.pagesLabel })),
      paymentRequired: shop.paymentMode !== "NO_PAYMENT" && amount > 0,
    });
  } catch (err) {
    console.error(err);
    if (req.files?.length) cleanupFiles(req.files);
    res.status(500).json({ error: err.message || "Failed to process file(s)" });
  }
});

// Public: create the print job (called after quote, and after payment if required)
publicRouter.post("/shop/:token/jobs", async (req, res) => {
  try {
    const shop = await prisma.shop.findUnique({ where: { shopToken: req.params.token } });
    if (!shop) return res.status(404).json({ error: "Shop not found" });

    const {
      fileToken,
      fileName,
      fileType,
      pages,
      copies,
      colorMode,
      amount,
      customerName,
      customerContact,
      paperSize,
    } = req.body;

    if (!fileToken) return res.status(400).json({ error: "fileToken is required" });
    // fileToken is a server-generated nanoid filename — reject anything that
    // could be a path traversal attempt before touching the filesystem.
    if (fileToken.includes("/") || fileToken.includes("\\") || fileToken.includes("..")) {
      return res.status(400).json({ error: "Invalid file reference" });
    }
    const filePath = path.join(UPLOAD_DIR, fileToken);
    if (!fs.existsSync(filePath)) return res.status(400).json({ error: "Uploaded file expired, please re-upload" });

    // Only ONLINE mode actually routes money through the payment gateway
    // into the platform's account — that's the only case where the shop's
    // in-app wallet should ever be credited (see routes/payment.js). CASH
    // jobs are paid directly to shop staff at the counter and must never
    // touch the wallet/payout flow, even though a price is still shown.
    const onlinePaymentRequired = shop.paymentMode === "ONLINE" && Number(amount) > 0;
    const payAtCounter = shop.paymentMode === "CASH" && Number(amount) > 0;
    const initialStatus = onlinePaymentRequired
      ? "AWAITING_PAYMENT"
      : shop.approvalRequired
      ? "PENDING_APPROVAL"
      : "QUEUED";
    const initialPaymentStatus = onlinePaymentRequired ? "PENDING" : payAtCounter ? "PAY_AT_COUNTER" : "NOT_REQUIRED";

    const job = await prisma.printJob.create({
      data: {
        shopId: shop.id,
        customerName: customerName || null,
        customerContact: customerContact || null,
        fileName: (fileName || fileToken).slice(0, 500),
        filePath,
        fileType: fileType || "application/pdf",
        pages: Number(pages) || 1,
        copies: Number(copies) || 1,
        colorMode: colorMode === "COLOR" ? "COLOR" : "GRAY",
        paperSize: paperSize || "A4",
        amount: Number(amount) || 0,
        paymentMode: shop.paymentMode,
        paymentStatus: initialPaymentStatus,
        status: initialStatus,
      },
    });

    req.app.get("io").to(`shop:${shop.id}`).emit("job:new", job);
    res.json({ job });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create print job" });
  }
});

// Public: poll job status (customer page uses this while waiting for print)
publicRouter.get("/jobs/:id", async (req, res) => {
  const job = await prisma.printJob.findUnique({ where: { id: req.params.id } });
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json({ job });
});
