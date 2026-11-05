import { brand, icon } from "../components/icons.js";
import { money } from "../domain/finance.js";
import {
  esc,
  month,
  date,
  button,
  iconButton,
  detail,
} from "../components/ui.js";

const phaseLabels = {
  preparing: "Preparing payment",
  awaiting: "Waiting for payment",
  verifying: "Verifying payment",
  delayed: "Confirmation delayed",
  failed: "Payment failed",
  expired: "QR expired",
  unavailable: "Status temporarily unavailable",
  settled: "Invoice settled",
};

function success(value, ctx) {
  const p = value.payment;
  return `<div class="payment-page"><header class="app-header">${brand()}<span class="header-spacer"></span></header><main class="success-content"><div class="success-mark"><svg viewBox="0 0 72 72" aria-hidden="true"><circle cx="36" cy="36" r="29"/><path d="m21 36 10 10 21-22"/></svg></div><h1>Payment Successful</h1><p>Your rent payment has been confirmed.</p><div class="success-amount">${money(p.amountPaise)}</div><span class="badge success">Captured & recorded</span><div class="card"><dl>${detail("Paid on", date(p.paidAt, ctx.snapshot.property?.timezone, true))}${detail("Transaction", p.providerPaymentId || p.id)}${detail("Invoice", month(p.invoice.year, p.invoice.month))}${detail("Invoice reference", p.invoice.id)}${detail("Receipt", p.receiptNumber)}</dl></div><div class="action-stack">${button("Download receipt", { action: "receipt", glyph: "download", attrs: `data-id="${esc(p.id)}" data-number="${esc(p.receiptNumber)}"` })}${button("Return home", { route: "studentHome", kind: "secondary", glyph: "home" })}</div></main></div>`;
}

function render(value, ctx) {
  if (value.phase === "success") return success(value, ctx);
  const qr = value.qr;
  const awaiting = ["awaiting", "delayed"].includes(value.phase);
  const showQr = qr && awaiting && !value.imageError;
  const errorPhase = ["failed", "unavailable", "expired"].includes(value.phase);
  const stateText = value.checking
    ? "Checking bank confirmation…"
    : phaseLabels[value.phase];
  const info =
    value.phase === "delayed"
      ? "Already paid? Bank confirmation can take a little longer. Do not pay again."
      : value.message;
  const imageUrl = qr && ctx.native.has("paymentQrImageUrl")
    ? ctx.native.call("paymentQrImageUrl", qr.imageUrl, qr.amountPaise)
    : qr?.imageUrl;
  return `<div class="payment-page"><header class="app-header">${iconButton("Leave payment", "back", "back")}<span class="header-title">Pay rent</span>${brand({ compact: true })}</header>
    <main class="payment-content"><p class="payment-eyebrow">${value.phase === "settled" ? "Invoice balance" : "Amount payable"}</p><h1>${money(qr?.amountPaise ?? value.invoice?.remainingPaise)}</h1><p class="payment-context">${value.invoice ? esc(month(value.invoice.year, value.invoice.month)) : ""} · ${esc(ctx.snapshot.property?.name)}</p>
    <div class="qr-stage${showQr ? "" : " qr-unavailable"}" aria-busy="${value.phase === "preparing" || (showQr && !value.imageReady)}">${showQr ? `${!value.imageReady ? '<div class="sk" aria-label="Loading payment QR"></div>' : ""}<img data-payment-qr="${esc(qr.id)}" src="${esc(imageUrl)}" alt="Provider-issued rent payment QR" ${value.imageReady ? "" : "hidden"}>` : value.phase === "preparing" ? '<div class="sk" aria-label="Preparing payment QR"></div>' : `<div><span class="empty-icon">${icon(value.imageError ? "alert" : value.phase === "settled" ? "check" : errorPhase ? "clock" : "shield")}</span><h2>${value.imageError ? "QR couldn’t load" : esc(phaseLabels[value.phase])}</h2></div>`}</div>
    <p class="payment-instruction">${showQr ? "Scan with any UPI app" : value.imageError ? "Check your connection, then reload this QR." : value.phase === "preparing" ? "Preparing your payment QR…" : value.phase === "settled" ? "Your invoice is already paid." : "Your payment remains under review."}</p>
    ${showQr ? `<p class="payment-subtext">Valid until ${esc(new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: ctx.snapshot.property?.timezone || "Asia/Kolkata" }).format(new Date(qr.expiresAt * 1000)))}</p>` : ""}
    <div class="payment-status${errorPhase ? " error" : ""}" role="status" aria-live="polite">${!errorPhase && value.phase !== "settled" ? '<span class="spinner" aria-hidden="true"></span>' : icon(errorPhase ? "alert" : "check")}<span data-payment-status-text>${esc(stateText)}</span></div>
    ${info ? `<p class="payment-subtext">${esc(info)}</p>` : ""}
    ${value.upiError ? `<div class="upi-help" role="alert">${esc(value.upiError)}</div>` : ""}
    <div class="action-stack">${showQr && value.imageReady && ctx.native.has("openQrInUpiApp") ? button(value.openingUpi ? "Opening UPI app…" : "Pay with a UPI app", { action: "upi", glyph: value.openingUpi ? "clock" : "external", attrs: value.openingUpi ? "disabled aria-busy=\"true\"" : "" }) : ""}${value.imageError ? button("Reload QR image", { action: "retryImage", kind: "secondary", glyph: "refresh" }) : ""}${["expired", "failed"].includes(value.phase) || (value.phase === "unavailable" && !qr) ? button(qr ? "Check & request QR" : "Retrieve payment QR", { action: "retryPayment", kind: "secondary" }) : ""}${value.phase === "settled" ? button("View payment history", { route: "history", kind: "primary" }) : ""}</div>
    <div class="payment-secondary">${showQr && value.imageReady ? `<button class="text-button" data-action="saveQr">${icon("download")} Save QR</button>` : ""}${qr && value.phase !== "settled" ? button("Check payment status", { action: "checkPayment", kind: "text-button", glyph: "refresh", attrs: `aria-disabled="${Boolean(value.checking)}"` }) : ""}</div>
    <p class="payment-safety">Payment updates after bank confirmation.<br>If money was debited, don’t pay again.</p></main></div>`;
}

export async function paymentScreen(ctx) {
  // Do not select an amount or invoice from route values or stale dashboard cache.
  const data = await ctx.api("/api/student/invoices");
  const invoice = data.invoices.find((i) => i.id === ctx.params.invoiceId);
  if (!invoice)
    throw new Error("Refresh your invoices before starting a payment.");
  if (
    ["PAID", "WAIVED"].includes(invoice.status) ||
    invoice.remainingPaise <= 0
  ) {
    if (ctx.snapshot.pendingPayment?.invoiceId === invoice.id)
      await ctx.payment.setPending(null);
    return {
      title: "Rent settled",
      back: true,
      nav: "invoices",
      content: `<div class="empty-state"><span class="empty-icon">${icon("check")}</span><h1>All taken care of.</h1><p>This invoice has no outstanding balance.</p>${button("View payment history", { route: "history" })}</div>`,
    };
  }
  let unsubscribe, handoffTimer, lastView;
  let active = true, openingUpi = false, upiError = "";
  const paint = (value) => {
    // Polling changes the status text, not the entire screen, QR or focused button.
    const view = JSON.stringify([value.phase, value.qr, value.invoice, value.payment, value.imageReady, value.imageError, value.message, openingUpi, upiError]);
    if (view === lastView) {
      const status = document.querySelector("[data-payment-status-text]");
      if (status) status.textContent = value.checking ? "Checking bank confirmation…" : phaseLabels[value.phase];
      const check = document.querySelector('[data-action="checkPayment"]');
      if (check) check.setAttribute("aria-disabled", String(Boolean(value.checking)));
      return;
    }
    lastView = view;
    const oldImage = document.querySelector("[data-payment-qr]");
    document.getElementById("app").innerHTML = render({ ...value, openingUpi, upiError }, ctx);
    const nextImage = document.querySelector("[data-payment-qr]");
    if (oldImage && nextImage && oldImage.getAttribute("src") === nextImage.getAttribute("src")) {
      oldImage.hidden = nextImage.hidden;
      nextImage.replaceWith(oldImage);
    }
  };
  const upiResult = (error = "") => {
    clearTimeout(handoffTimer);
    openingUpi = false;
    upiError = error;
    if (active) paint(ctx.payment.value);
  };
  return {
    title: "Pay rent",
    bare: true,
    paymentFlow: true,
    content: render({ phase: "preparing", invoice }, ctx),
    upiResult,
    mount() {
      void ctx.payment.open(invoice);
      unsubscribe = ctx.payment.subscribe(paint);
    },
    unmount() {
      active = false;
      clearTimeout(handoffTimer);
      unsubscribe?.();
      ctx.payment.stop();
    },
    async action(name) {
      const value = ctx.payment.value;
      if (name === "checkPayment") return value.checking ? undefined : ctx.payment.check();
      if (name === "retryPayment") return ctx.payment.retry();
      if (name === "retryImage") return ctx.payment.retryImage();
      if (
        name === "upi" &&
        !openingUpi &&
        value.qr &&
        value.imageReady &&
        ["awaiting", "delayed"].includes(value.phase)
      ) {
        openingUpi = true;
        upiError = "";
        paint(value);
        await ctx.payment.check();
        if (!active) return;
        const current = ctx.payment.value;
        if (["awaiting", "delayed"].includes(current.phase) && current.qr?.id === value.qr.id && current.qr.expiresAt * 1000 > Date.now()) {
          handoffTimer = setTimeout(() => upiResult("The UPI app could not be opened. Save this QR and scan it from your UPI app gallery."), 15000);
          ctx.native.call(
            "openQrInUpiApp",
            current.qr.imageUrl,
            current.qr.amountPaise,
            current.qr.expiresAt,
          );
        } else upiResult();
      }
      if (name === "saveQr" && value.qr && value.imageReady) {
        if (ctx.native.has("savePaymentQr"))
          ctx.native.call("savePaymentQr", value.qr.imageUrl, value.qr.amountPaise);
        else ctx.openExternal(value.qr.imageUrl);
      }
    },
  };
}
