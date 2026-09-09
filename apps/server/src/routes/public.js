import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { nanoid } from "nanoid";
import { prisma } from "../lib/prisma.js";
import { countPages, computeAmount } from "../lib/pricing.js";

export const publicRouter = Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || "";
    cb(null, `${nanoid(16)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Unsupported file type"));
  },
});

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

// Public: upload a file & get a computed quote (pages/amount) before creating a job
publicRouter.post("/shop/:token/quote", upload.single("file"), async (req, res) => {
  try {
    const shop = await prisma.shop.findUnique({ where: { shopToken: req.params.token } });
    if (!shop) return res.status(404).json({ error: "Shop not found" });
    if (!req.file) return res.status(400).json({ error: "File is required" });

    const pages = await countPages(req.file.path, req.file.mimetype);
    const copies = Math.max(1, parseInt(req.body.copies || "1", 10));
    let colorMode = (req.body.colorMode || "GRAY").toUpperCase();
    if (shop.printRule === "ONLY_COLOR") colorMode = "COLOR";
    if (shop.printRule === "ONLY_GRAY") colorMode = "GRAY";

    const amount =
      shop.paymentMode === "NO_PAYMENT"
        ? 0
        : computeAmount({ pages, copies, colorMode, colorRate: shop.colorRate, grayRate: shop.grayRate });

    res.json({
      fileToken: req.file.filename,
      fileName: req.file.originalname,
      fileType: req.file.mimetype,
      pages,
      copies,
      colorMode,
      amount,
      paymentRequired: shop.paymentMode !== "NO_PAYMENT" && amount > 0,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to process file" });
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
        fileName: fileName || fileToken,
        filePath,
        fileType: fileType || "application/octet-stream",
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
