import {button,esc} from "../components/ui.js";
import {icon} from "../components/icons.js";

export function manualUpiInstructions(payment, canOpenPaytm) {
  const paytmShortcut = canOpenPaytm
    ? `<div class="transfer-actions">${button("Copy UPI ID & open Paytm",{action:"openPaytm",kind:"primary block",glyph:"external"})}</div>`
    : "";
  const instruction = canOpenPaytm
    ? "In Paytm, choose To UPI ID or Bank A/c and paste the copied ID."
    : "Open Paytm or another UPI app, choose Send Money, and paste the owner's UPI ID.";
  if (payment) return `<div class="rent-upi-heading">
      <span class="transfer-icon">${icon("wallet")}</span>
      <div><h2>Pay via UPI</h2><p>${instruction}</p></div>
    </div>
    <div class="rent-upi-recipient">
      <div><strong>${esc(payment.payeeName)}</strong><small>UPI ID</small><span>${esc(payment.payeeAddress)}</span></div>
      ${button("Copy UPI ID",{action:"copyPayee",kind:"secondary"})}
    </div>
    <div class="rent-upi-note"><p>Verify the recipient and exact amount in your UPI app.</p>
      ${button("Copy amount",{action:"copyAmount",kind:"text-button"})}
    </div>${paytmShortcut}`;

  return `<h2>Pay in Paytm or another UPI app</h2>
    <p class="transfer-note">${instruction} Verify the recipient and enter the exact amount shown above. You can also scan the QR shared by your owner.</p>
    ${paytmShortcut}
    <div class="transfer-actions">
      ${button("Copy UPI ID",{action:"copyPayee",kind:"secondary"})}
      ${button("Copy amount",{action:"copyAmount",kind:"secondary"})}
    </div>`;
}

export async function copyPaymentDetail(ctx, action, payment) {
  const openPaytm = action === "openPaytm";
  const isPayee = openPaytm || action === "copyPayee";
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
  if (openPaytm && !ctx.native.call("openPaytm")) {
    ctx.toast("UPI ID copied. Paytm could not open. Paste the ID in your UPI app.");
    return;
  }
  ctx.toast(`${label} copied.`);
}
