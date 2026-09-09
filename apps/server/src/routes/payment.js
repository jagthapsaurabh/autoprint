import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { razorpay, razorpayEnabled, verifyRazorpaySignature } from "../lib/razorpay.js";

export const paymentRouter = Router();

// Public: create a Razorpay order for a print job's amount
paymentRouter.post("/order", async (req, res) => {
  try {
    const { jobId } = req.body;
    const job = await prisma.printJob.findUnique({ where: { id: jobId } });
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (job.amount <= 0) return res.status(400).json({ error: "No payment required for this job" });

    if (!razorpayEnabled) {
      // Dev/demo fallback so the flow still works without real gateway keys.
      return res.json({
        mode: "manual",
        message:
          "Payment gateway keys are not configured. Add RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET in apps/server/.env to enable real UPI/card checkout. Falling back to manual confirm.",
        amount: job.amount,
        jobId: job.id,
      });
    }

    const order = await razorpay.orders.create({
      amount: Math.round(job.amount * 100),
      currency: "INR",
      receipt: job.id,
      notes: { jobId: job.id, shopId: job.shopId },
    });

    await prisma.printJob.update({ where: { id: job.id }, data: { razorpayOrderId: order.id } });

    res.json({
      mode: "razorpay",
      keyId: process.env.RAZORPAY_KEY_ID,
      order,
      amount: job.amount,
      jobId: job.id,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create payment order" });
  }
});

// Public: verify payment signature & mark job paid + queue it
paymentRouter.post("/verify", async (req, res) => {
  try {
    const { jobId, razorpay_order_id, razorpay_payment_id, razorpay_signature, manualConfirm } = req.body;
    const job = await prisma.printJob.findUnique({ where: { id: jobId } });
    if (!job) return res.status(404).json({ error: "Job not found" });

    let verified = false;
    if (razorpayEnabled && razorpay_order_id && razorpay_payment_id && razorpay_signature) {
      verified = verifyRazorpaySignature({
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature,
      });
    } else if (!razorpayEnabled && manualConfirm) {
      // demo-mode manual confirm (no gateway keys configured)
      verified = true;
    }

    if (!verified) return res.status(400).json({ error: "Payment verification failed" });

    const shop = await prisma.shop.findUnique({ where: { id: job.shopId } });
    const nextStatus = shop.approvalRequired ? "PENDING_APPROVAL" : "QUEUED";

    const updated = await prisma.printJob.update({
      where: { id: job.id },
      data: {
        paymentStatus: "PAID",
        razorpayPaymentId: razorpay_payment_id || "manual",
        status: nextStatus,
      },
    });

    const netAmount = shop.upiId ? job.amount : Math.round(job.amount * 0.96 * 100) / 100; // 4% gateway fee unless direct-to-UPI
    await prisma.$transaction([
      prisma.shop.update({ where: { id: shop.id }, data: { walletBalance: { increment: netAmount } } }),
      prisma.walletTransaction.create({
        data: { shopId: shop.id, amount: netAmount, type: "CREDIT", jobId: job.id, note: `Print job ${job.fileName}` },
      }),
    ]);

    req.app.get("io").to(`shop:${shop.id}`).emit("job:new", updated);
    res.json({ job: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to verify payment" });
  }
});

// Shop owner: create the Rs 499 subscription order
paymentRouter.get("/config", async (req, res) => {
  res.json({ razorpayEnabled, keyId: razorpayEnabled ? process.env.RAZORPAY_KEY_ID : null });
});
