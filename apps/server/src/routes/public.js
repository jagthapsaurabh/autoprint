import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { nanoid } from "nanoid";
import { prisma } from "../lib/prisma.js";
import { computeAmount } from "../lib/pricing.js";
import { mergeFilesToPdf, isSupportedForMerge } from "../lib/merge.js";

export const publicRouter = Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_FILES = 20;
const MAX_FILE_SIZE = 30 * 1024 * 1024; // 30MB per file
const MAX_TOTAL_SIZE = 150 * 1024 * 1024; // 150MB combined per upload batch

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

    const copies = Math.max(1, Math.min(200, parseInt(req.body.copies || "1", 10)));
    let colorMode = (req.body.colorMode || "GRAY").toUpperCase();
    if (shop.printRule === "ONLY_COLOR") colorMode = "COLOR";
    if (shop.printRule === "ONLY_GRAY") colorMode = "GRAY";

    const mergedFileName = `${nanoid(16)}.pdf`;
    const mergedFilePath = path.join(UPLOAD_DIR, mergedFileName);

    let pages;
    try {
      const result = await mergeFilesToPdf(
        req.files.map((f) => ({ filePath: f.path, mimeType: f.mimetype })),
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

    const amount =
      shop.paymentMode === "NO_PAYMENT"
        ? 0
        : computeAmount({ pages, copies, colorMode, colorRate: shop.colorRate, grayRate: shop.grayRate });

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
      copies,
      colorMode,
      amount,
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

    const paymentRequired = shop.paymentMode !== "NO_PAYMENT" && Number(amount) > 0;
    const initialStatus = paymentRequired
      ? "AWAITING_PAYMENT"
      : shop.approvalRequired
      ? "PENDING_APPROVAL"
      : "QUEUED";
    const initialPaymentStatus = paymentRequired ? "PENDING" : "NOT_REQUIRED";

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
