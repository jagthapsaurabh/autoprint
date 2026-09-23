import Razorpay from "razorpay";
import crypto from "node:crypto";

const keyId = process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;

export const razorpayEnabled = Boolean(keyId && keySecret);

export const razorpay = razorpayEnabled
  ? new Razorpay({ key_id: keyId, key_secret: keySecret })
  : null;

export function verifyRazorpaySignature({ orderId, paymentId, signature }) {
  if (!razorpayEnabled) return false;
  const expected = crypto
    .createHmac("sha256", keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return expected === signature;
}

// Looks up the ACTUAL fee Razorpay charged for a captured payment (their
// `fee` field is already inclusive of GST), so payouts can be based on real
// numbers instead of an assumed flat rate. Returns null if unavailable
// (payment not yet settled/fee not populated, network error, etc.) so the
// caller can fall back to an estimate.
export async function fetchRazorpayPaymentFee(paymentId) {
  if (!razorpayEnabled || !paymentId) return null;
  try {
    const payment = await razorpay.payments.fetch(paymentId);
    if (typeof payment?.fee === "number") {
      return payment.fee / 100; // paise -> rupees
    }
    return null;
  } catch (err) {
    console.error(`Could not fetch Razorpay fee for ${paymentId}:`, err.message || err);
    return null;
  }
}
