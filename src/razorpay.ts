import { config } from "./config.js";
import { AppError } from "./errors.js";

function authHeader() {
  if (!config.RAZORPAY_KEY_ID || !config.RAZORPAY_KEY_SECRET) {
    throw new AppError(503, "PAYMENTS_NOT_CONFIGURED", "Razorpay is not configured");
  }
  return `Basic ${Buffer.from(`${config.RAZORPAY_KEY_ID}:${config.RAZORPAY_KEY_SECRET}`).toString("base64")}`;
}

export async function createRazorpayOrder(input: { amountPaise: number; receipt: string; notes: Record<string, string> }) {
  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      authorization: authHeader(),
      "content-type": "application/json"
    },
    body: JSON.stringify({
      amount: input.amountPaise,
      currency: "INR",
      receipt: input.receipt.slice(0, 40),
      notes: input.notes
    })
  });
  const body = await response.json() as any;
  if (!response.ok) {
    throw new AppError(502, "RAZORPAY_ORDER_FAILED", body?.error?.description || "Could not create Razorpay order");
  }
  return body as { id: string; amount: number; currency: string; receipt: string; status: string };
}

/**
 * SafeHouse Pay QR: provider-issued, fixed-amount, one-time UPI QR.
 * This feature requires Razorpay QR API activation on the merchant account.
 * Do not fabricate UPI payment URIs or store secret keys in the Android APK.
 */
export type RazorpayQrCode = {
  id: string;
  image_url: string;
  status: string;
  close_by?: number;
  payment_amount?: number;
  type?: string;
};
export async function createRentUpiQr(input: { amountPaise: number; invoiceId: string; propertyId: string; studentId: string }): Promise<RazorpayQrCode> {
  const expiry = Math.floor(Date.now() / 1000) + 20 * 60;
  const response = await fetch("https://api.razorpay.com/v1/payments/qr_codes", {
    method: "POST",
    headers: { authorization: authHeader(), "content-type": "application/json" },
    body: JSON.stringify({
      type: "upi_qr", usage: "single_use", fixed_amount: true,
      payment_amount: input.amountPaise, close_by: expiry,
      name: "SafeHouse Rent",
      description: "Rent payment",
      notes: { invoiceId: input.invoiceId, propertyId: input.propertyId, studentId: input.studentId }
    })
  });
  const qr = await response.json() as any;
  if (!response.ok) {
    const description = String(qr?.error?.description || "");
    if (response.status === 401 || response.status === 403 || /not enabled|not activated|not allowed|feature/i.test(description)) {
      throw new AppError(503, "UPI_QR_NOT_ENABLED", "Secure UPI QR is not activated for this SafeHouse merchant. Contact support.");
    }
    throw new AppError(502, "UPI_QR_UNAVAILABLE", "Unable to create a secure payment QR. Please try again.");
  }
  if (!qr?.id?.startsWith("qr_") || !qr?.image_url || qr?.status !== "active" || Number(qr.payment_amount) !== input.amountPaise) {
    throw new AppError(502, "UPI_QR_INVALID", "The payment provider returned an invalid QR response.");
  }
  return qr as RazorpayQrCode;
}
export async function fetchRentUpiQr(qrId: string): Promise<RazorpayQrCode | null> {
  if (!/^qr_[a-zA-Z0-9]+$/.test(qrId)) return null;
  const res = await fetch("https://api.razorpay.com/v1/payments/qr_codes/" + qrId, { headers: { authorization: authHeader() } });
  if (!res.ok) return null;
  return await res.json() as RazorpayQrCode;
}

/**
 * Fetch payments directly from Razorpay for a specific issued QR.
 * Server-to-server only. Used to recover from missed or delayed webhooks.
 */
export async function fetchCapturedQrPayments(qrId: string): Promise<Array<{
  id: string; amount: number; currency: string; status: string; captured: boolean;
  method: string; created_at?: number; order_id?: string | null;
}>> {
  if (!/^qr_[a-zA-Z0-9]+$/.test(qrId)) throw new AppError(400, "INVALID_QR_ID", "Invalid payment QR");
  const endpoint = "https://api.razorpay.com/v1/payments/qr_codes/" + encodeURIComponent(qrId) + "/payments?count=100";
  const response = await fetch(endpoint, { headers: { authorization: authHeader() }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new AppError(502, "QR_STATUS_UNAVAILABLE", "Payment confirmation is temporarily unavailable");
  const result = await response.json() as any;
  if (!Array.isArray(result?.items)) throw new AppError(502, "QR_STATUS_INVALID", "Invalid response from the payment provider");
  return result.items.filter((p: any) => p?.status === "captured" && p?.captured === true && p?.method === "upi");
}
