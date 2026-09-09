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
