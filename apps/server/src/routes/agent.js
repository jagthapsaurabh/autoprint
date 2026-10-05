import { Router } from "express";
import fs from "node:fs";
import { prisma } from "../lib/prisma.js";
import { requireAgent, requireAuth } from "../middleware/auth.js";
import { streamAgentPackageZip, ZIP_FILENAME } from "../lib/agentBundle.js";

export const agentRouter = Router();

// Shop owner downloads the ready-to-run portable agent package (Windows).
// The zip already contains this shop's server URL + runtime key, so on the
// shop PC it's: unzip -> double-click "Start AutoPrint Agent.bat".
// The first download may take a few minutes (the server downloads the
// portable Node runtime once, then serves a cached build).
agentRouter.get("/package", requireAuth, async (req, res) => {
  try {
    const shop = await prisma.shop.findUnique({ where: { ownerId: req.user.id } });
    if (!shop) return res.status(404).json({ error: "No shop found for this account" });
    if (!shop.subscriptionActive) {
      return res.status(403).json({ error: "Activate the Auto Print add-on first, then download the agent." });
    }

    // Best-guess public URL the agent should talk back to. PUBLIC_BASE_URL
    // (used for QR codes) wins; behind a reverse proxy req.protocol honors
    // x-forwarded-proto (trust proxy is set).
    const serverUrl =
      process.env.PUBLIC_BASE_URL ||
      (req.headers.origin ? new URL(req.headers.origin).origin : null) ||
      `${req.protocol}://${req.get("host")}`;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${ZIP_FILENAME}"`);
    await streamAgentPackageZip(res, { serverUrl, runtimeKey: shop.runtimeKey });
  } catch (err) {
    console.error("[agent-package] failed:", err);
    if (!res.headersSent) {
      res.status(502).json({ error: err.userMessage || "Could not build the agent package. Try again in a minute." });
    } else {
      res.destroy();
    }
  }
});

// Agent verifies its runtime key & reports basic info. Used by "Verify & Setup".
agentRouter.post("/handshake", requireAgent, async (req, res) => {
  const { printers = [], version, osInfo } = req.body;
  const shop = req.shop;
  await prisma.agentStatus.upsert({
    where: { shopId: shop.id },
    create: {
      shopId: shop.id,
      online: true,
      version,
      osInfo,
      printers: JSON.stringify(printers),
      lastSeenAt: new Date(),
    },
    update: {
      online: true,
      version,
      osInfo,
      printers: JSON.stringify(printers),
      lastSeenAt: new Date(),
    },
  });
  if (!shop.defaultPrinterName && printers.length) {
    await prisma.shop.update({ where: { id: shop.id }, data: { defaultPrinterName: printers[0] } });
  }
  res.json({ ok: true, shop: { id: shop.id, name: shop.name } });
});

// Agent heartbeat, keeps "online" status fresh
agentRouter.post("/heartbeat", requireAgent, async (req, res) => {
  await prisma.agentStatus.upsert({
    where: { shopId: req.shop.id },
    create: { shopId: req.shop.id, online: true, lastSeenAt: new Date() },
    update: { online: true, lastSeenAt: new Date() },
  });
  res.json({ ok: true });
});

// Agent polls for the next job(s) ready to print
agentRouter.get("/queue", requireAgent, async (req, res) => {
  const shop = req.shop;
  const jobs = await prisma.printJob.findMany({
    where: {
      shopId: shop.id,
      status: shop.approvalRequired ? "APPROVED" : "QUEUED",
    },
    orderBy: { createdAt: "asc" },
    take: 5,
  });
  res.json({
    jobs: jobs.map((j) => ({
      id: j.id,
      fileName: j.fileName,
      fileType: j.fileType,
      copies: j.copies,
      colorMode: j.colorMode,
      paperSize: j.paperSize,
      downloadUrl: `/api/agent/jobs/${j.id}/file`,
    })),
    settings: {
      defaultPrinterName: shop.defaultPrinterName,
      // Per-mode printer overrides: color jobs use colorPrinterName,
      // B&W/gray jobs use grayPrinterName; either falls back to
      // defaultPrinterName, then to the Windows default (see agent).
      colorPrinterName: shop.colorPrinterName,
      grayPrinterName: shop.grayPrinterName,
      printRule: shop.printRule,
    },
  });
});

// Agent downloads the actual file bytes to print
agentRouter.get("/jobs/:id/file", requireAgent, async (req, res) => {
  const job = await prisma.printJob.findFirst({ where: { id: req.params.id, shopId: req.shop.id } });
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (!fs.existsSync(job.filePath)) return res.status(410).json({ error: "File no longer available" });
  res.setHeader("Content-Type", job.fileType);
  res.setHeader("Content-Disposition", `attachment; filename="${job.fileName}"`);
  fs.createReadStream(job.filePath).pipe(res);
});

// Agent reports job start/result
agentRouter.post("/jobs/:id/status", requireAgent, async (req, res) => {
  const { status, failureReason } = req.body;
  const allowed = ["PRINTING", "PRINTED", "FAILED"];
  if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid status" });
  const job = await prisma.printJob.findFirst({ where: { id: req.params.id, shopId: req.shop.id } });
  if (!job) return res.status(404).json({ error: "Job not found" });
  const updated = await prisma.printJob.update({
    where: { id: job.id },
    data: {
      status,
      failureReason: status === "FAILED" ? failureReason || "Print failed" : null,
      printedAt: status === "PRINTED" ? new Date() : job.printedAt,
    },
  });
  req.app.get("io").to(`shop:${req.shop.id}`).emit("job:updated", updated);
  res.json({ job: updated });
});
