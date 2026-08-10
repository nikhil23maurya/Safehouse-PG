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
