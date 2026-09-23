// Computes how much of a customer's online payment the shop should actually
// be credited in their in-app wallet.
//
// A shop is NOT owed the full amount the customer paid: Razorpay (or any
// gateway) deducts its own transaction fee + GST on that fee before
// settling money to the platform's account, and (optionally) the platform
// itself may take a small commission on top of the flat ₹499/mo
// subscription. Both of those must be subtracted before crediting the
// shop's wallet, or the dashboard balance would overstate what's actually
// available to withdraw.
//
// IMPORTANT: this only applies to ONLINE payments that actually flow
// through the payment gateway into the platform's account. Cash-at-counter
// jobs are paid directly to shop staff and never touch the platform, so
// they must never be credited to the wallet (see routes/public.js and
// routes/payment.js) — crediting those would represent money the platform
// doesn't actually hold.

// Platform's own cut of each online payment, on top of the ₹499/mo
// subscription. Off by default — the business model here is subscription
// revenue, not transaction commission — but configurable if that changes.
const PLATFORM_COMMISSION_PERCENT = Number(process.env.PLATFORM_COMMISSION_PERCENT || 0);

// Used ONLY when we can't ask Razorpay for the real per-payment fee (e.g.
// demo/manual-confirm mode with no gateway keys configured, or if the
// fee-lookup API call fails). Razorpay's published standard domestic rate
// is 2% + 18% GST on that fee (~2.36% effective) for cards/wallets/
// netbanking; UPI is currently fee-free under RBI's zero-MDR mandate but we
// use the blended card/UPI-mix rate as a conservative default so payouts
// aren't overstated when the real figure isn't available.
const ASSUMED_GATEWAY_FEE_PERCENT = Number(process.env.RAZORPAY_ASSUMED_FEE_PERCENT || 2.36);

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * @param {object} opts
 * @param {number} opts.grossAmount - what the customer paid, in rupees.
 * @param {number|null} [opts.gatewayFee] - actual fee Razorpay charged for
 *   this payment, in rupees, already inclusive of GST (Razorpay's `fee`
 *   field is fee-including-tax; `tax` is just the GST portion of it for
 *   display). Pass null/undefined to fall back to the estimated rate.
 * @param {boolean} [opts.isEstimate] - true if gatewayFee wasn't sourced
 *   from a real Razorpay payment lookup (demo mode or a failed API call).
 */
export function computeOnlinePayout({ grossAmount, gatewayFee = null, isEstimate = false }) {
  const gross = round2(Number(grossAmount) || 0);
  const fee =
    gatewayFee != null && !Number.isNaN(gatewayFee)
      ? round2(Number(gatewayFee))
      : round2((gross * ASSUMED_GATEWAY_FEE_PERCENT) / 100);
  const usedEstimate = gatewayFee == null || isEstimate;

  const commission = round2((gross * PLATFORM_COMMISSION_PERCENT) / 100);
  const netPayout = Math.max(0, round2(gross - fee - commission));

  const parts = [`₹${gross.toFixed(2)} collected`, `₹${fee.toFixed(2)} gateway fee${usedEstimate ? " (est.)" : ""}`];
  if (commission > 0) parts.push(`₹${commission.toFixed(2)} platform fee`);
  parts.push(`₹${netPayout.toFixed(2)} credited`);

  return {
    grossAmount: gross,
    gatewayFee: fee,
    platformCommission: commission,
    netPayout,
    isEstimate: usedEstimate,
    summary: parts.join(", "),
  };
}
