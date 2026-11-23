import {button} from "../components/ui.js";

export function manualUpiInstructions() {
  return `<h2>Pay in Paytm or another UPI app</h2>
    <p class="transfer-note">Open your UPI app, choose Send Money, and paste the owner's UPI ID. You can also scan the QR shared by your owner. Check the registered name and enter the exact total shown above.</p>
    <div class="transfer-actions">
      ${button("Copy UPI ID",{action:"copyPayee",kind:"secondary"})}
      ${button("Copy amount",{action:"copyAmount",kind:"secondary"})}
    </div>`;
}

export async function copyPaymentDetail(ctx, action, payment) {
  const isPayee = action === "copyPayee";
  const label = isPayee ? "UPI ID" : "Amount";
  const value = isPayee ? payment.payeeAddress : (payment.amountPaise / 100).toFixed(2);
  try {
    if (ctx.native.has("copyPaymentDetail")) {
      if (!ctx.native.call("copyPaymentDetail", value)) throw new Error("Clipboard unavailable");
    } else {
      await navigator.clipboard.writeText(value);
    }
  } catch {
    throw new Error(`${label} could not be copied. Enter it directly in your UPI app.`);
  }
  ctx.toast(`${label} copied.`);
}
