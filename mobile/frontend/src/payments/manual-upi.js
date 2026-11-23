import {button,esc} from "../components/ui.js";
import {icon} from "../components/icons.js";

export function manualUpiInstructions(payment, canOpenUpiApp) {
  const copyId = button("Copy UPI ID",{action:"copyPayee",kind:"secondary"});
  const chooseApp = canOpenUpiApp
    ? button("Copy UPI ID & open app",{action:"openUpiApp",kind:"primary block",glyph:"external"})
    : "";
  const instruction = "Paste the UPI ID, verify the recipient and enter the amount shown.";
  if (payment) return `<div class="rent-upi-heading">
      <span class="transfer-icon">${icon("wallet")}</span>
      <h2>Pay via UPI</h2>
    </div>
    <div class="rent-upi-recipient">
      <div><strong>${esc(payment.payeeName)}</strong><small>UPI ID</small><span>${esc(payment.payeeAddress)}</span></div>
      ${canOpenUpiApp ? "" : copyId}
    </div>
    <div class="rent-upi-note"><p>${instruction}</p>
      ${button("Copy amount",{action:"copyAmount",kind:"text-button"})}
    </div>${chooseApp ? `<div class="transfer-actions">${chooseApp}</div>` : ""}`;

  return `<h2>Pay via UPI</h2>
    <p class="transfer-note">${instruction}</p>
    <div class="transfer-actions">
      ${chooseApp || copyId}
      ${button("Copy amount",{action:"copyAmount",kind:"secondary"})}
    </div>`;
}

export async function copyPaymentDetail(ctx, action, payment) {
  const openApp = action === "openUpiApp";
  const isPayee = openApp || action === "copyPayee";
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
  if (openApp && !ctx.native.call("openUpiApp")) {
    ctx.toast("UPI ID copied. No UPI app is available.");
    return;
  }
  ctx.toast(`${label} copied.`);
}
