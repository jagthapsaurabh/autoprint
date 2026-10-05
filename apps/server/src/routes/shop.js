import { Router } from "express";
import QRCode from "qrcode";
import { nanoid } from "nanoid";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

export const shopRouter = Router();

async function getOwnedShop(req, res) {
  const shop = await prisma.shop.findUnique({ where: { ownerId: req.user.id } });
  if (!shop) {
    res.status(404).json({ error: "No shop found for this account" });
    return null;
  }
  return shop;
}

shopRouter.get("/me", requireAuth, async (req, res) => {
  const shop = await getOwnedShop(req, res);
  if (!shop) return;
  const agent = await prisma.agentStatus.findUnique({ where: { shopId: shop.id } });
  res.json({ shop, agent });
});

shopRouter.patch("/settings", requireAuth, async (req, res) => {
  const shop = await getOwnedShop(req, res);
  if (!shop) return;
  const {
    printRule,
    paymentMode,
    approvalRequired,
    colorRate,
    grayRate,
    upiId,
    defaultPrinterName,
    colorPrinterName,
    grayPrinterName,
    name,
    address,
    whatsapp,
  } = req.body;

  const updated = await prisma.shop.update({
    where: { id: shop.id },
    data: {
      ...(printRule !== undefined ? { printRule } : {}),
      ...(paymentMode !== undefined ? { paymentMode } : {}),
      ...(approvalRequired !== undefined ? { approvalRequired } : {}),
      ...(colorRate !== undefined ? { colorRate: Number(colorRate) } : {}),
      ...(grayRate !== undefined ? { grayRate: Number(grayRate) } : {}),
      ...(upiId !== undefined ? { upiId } : {}),
      ...(defaultPrinterName !== undefined ? { defaultPrinterName } : {}),
      // Per-mode printer overrides — empty string clears the override so the
      // job falls back to the default printer (see agent queue + agent).
      ...(colorPrinterName !== undefined ? { colorPrinterName: colorPrinterName || null } : {}),
      ...(grayPrinterName !== undefined ? { grayPrinterName: grayPrinterName || null } : {}),
      ...(name !== undefined ? { name } : {}),
      ...(address !== undefined ? { address } : {}),
      ...(whatsapp !== undefined ? { whatsapp } : {}),
    },
  });
  res.json({ shop: updated });
});

// Activate the Rs 499/mo Auto Print add-on. In production this should be gated
// behind a real payment; for now the shop owner can toggle it (billing hook
// point is `POST /api/payment/subscription/order`).
shopRouter.post("/subscription/activate", requireAuth, async (req, res) => {
  const shop = await getOwnedShop(req, res);
  if (!shop) return;
  const until = new Date();
  until.setMonth(until.getMonth() + 1);
  const updated = await prisma.shop.update({
    where: { id: shop.id },
    data: { subscriptionActive: true, subscriptionUntil: until },
  });
  res.json({ shop: updated });
});

shopRouter.post("/qr/regenerate", requireAuth, async (req, res) => {
  const shop = await getOwnedShop(req, res);
  if (!shop) return;
  const updated = await prisma.shop.update({
    where: { id: shop.id },
    data: { shopToken: nanoid(12) },
  });
  res.json({ shop: updated });
});

shopRouter.get("/qr.png", requireAuth, async (req, res) => {
  const shop = await getOwnedShop(req, res);
  if (!shop) return;
  const base = process.env.PUBLIC_BASE_URL || "http://localhost:5173";
  const url = `${base}/print/${shop.shopToken}`;
  const png = await QRCode.toBuffer(url, { width: 480, margin: 2 });
  res.setHeader("Content-Type", "image/png");
  res.send(png);
});

shopRouter.get("/jobs", requireAuth, async (req, res) => {
  const shop = await getOwnedShop(req, res);
  if (!shop) return;
  const jobs = await prisma.printJob.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json({ jobs });
});

shopRouter.post("/jobs/:id/approve", requireAuth, async (req, res) => {
  const shop = await getOwnedShop(req, res);
  if (!shop) return;
  const job = await prisma.printJob.findFirst({ where: { id: req.params.id, shopId: shop.id } });
  if (!job) return res.status(404).json({ error: "Job not found" });
  const updated = await prisma.printJob.update({
    where: { id: job.id },
    data: { status: shop.approvalRequired ? "APPROVED" : "QUEUED" },
  });
  req.app.get("io").to(`shop:${shop.id}`).emit("job:updated", updated);
  res.json({ job: updated });
});

shopRouter.post("/jobs/:id/reject", requireAuth, async (req, res) => {
  const shop = await getOwnedShop(req, res);
  if (!shop) return;
  const job = await prisma.printJob.findFirst({ where: { id: req.params.id, shopId: shop.id } });
  if (!job) return res.status(404).json({ error: "Job not found" });
  const updated = await prisma.printJob.update({
    where: { id: job.id },
    data: { status: "CANCELLED", failureReason: "Rejected by shop" },
  });
  req.app.get("io").to(`shop:${shop.id}`).emit("job:updated", updated);
  res.json({ job: updated });
});

shopRouter.delete("/jobs/:id", requireAuth, async (req, res) => {
  const shop = await getOwnedShop(req, res);
  if (!shop) return;
  await prisma.printJob.deleteMany({ where: { id: req.params.id, shopId: shop.id } });
  res.json({ ok: true });
});

shopRouter.get("/wallet", requireAuth, async (req, res) => {
  const shop = await getOwnedShop(req, res);
  if (!shop) return;
  const transactions = await prisma.walletTransaction.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json({ balance: shop.walletBalance, transactions });
});

shopRouter.post("/wallet/withdraw", requireAuth, async (req, res) => {
  const shop = await getOwnedShop(req, res);
  if (!shop) return;
  const amount = Number(req.body.amount || shop.walletBalance);
  if (amount <= 0 || amount > shop.walletBalance) {
    return res.status(400).json({ error: "Invalid withdrawal amount" });
  }
  await prisma.$transaction([
    prisma.shop.update({ where: { id: shop.id }, data: { walletBalance: { decrement: amount } } }),
    prisma.walletTransaction.create({
      data: { shopId: shop.id, amount: -amount, type: "PAYOUT_REQUEST", note: "Withdrawal requested" },
    }),
  ]);
  res.json({ ok: true });
});
