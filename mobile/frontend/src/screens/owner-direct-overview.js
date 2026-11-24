import { badge, button, card, date, esc, heading, month, section } from "../components/ui.js";
import { evidenceImages } from "../components/evidence.js";
import { icon } from "../components/icons.js";
import { field } from "../components/forms.js";
import { money, parseRupees } from "../domain/finance.js";

const overviewPath = "/api/platform/direct-payments/owner/overview";

export function readOwnerDirectOverview(ctx, { view = "overview", cursor, due = [] } = {}) {
  const query = new URLSearchParams(ctx.periodQuery);
  query.set("view", view);
  if (cursor) query.set("cursor", cursor);
  if (due.length) query.set("due", due.join(","));
  return ctx.api(`${overviewPath}?${query}`, { timeout: 8000 });
}

function identity(row) {
  return `<span class="collection-identity"><strong>${esc(row.resident)}</strong>${row.room ? `<small>Room ${esc(row.room)}</small>` : ""}</span>`;
}

function paymentCharges(proof) {
  return [
    proof.rentPaise ? `Rent ${money(proof.rentPaise)}` : null,
    proof.electricityPaise ? `Electricity ${money(proof.electricityPaise)}` : null,
  ].filter(Boolean).join(" · ");
}

function proofRow(proof, timeZone) {
  return card(
    `<div class="collection-row-head">${identity(proof)}<strong>${money(proof.amountPaise)}</strong></div>
    <p class="collection-row-meta">${esc(paymentCharges(proof))} · ${esc(date(proof.submittedAt, timeZone))}</p>` +
    button("Review proof", {
      route: "ownerTransferReview", params: { id: proof.id, invoiceId: proof.invoiceId },
      kind: "secondary block", glyph: "arrow",
    }), "direct-collection-row",
  );
}

function electricitySummary(summary) {
  const values = [
    ["Billed", summary.electricityBilledPaise],
    ["Collected", summary.electricityCollectedPaise],
    ["Proof submitted", summary.electricitySubmittedPaise],
  ];
  return `<dl class="collection-metrics">${values.map(([label, amount]) =>
    `<div><dt>${esc(label)}</dt><dd>${money(amount)}</dd></div>`
  ).join("")}</dl>`;
}

export function ownerDirectOverview(overview, period, timeZone) {
  const { summary, proofs } = overview;
  const path = (view, label) => button(label, {
    route: "ownerDirectOverview", params: { view }, kind: "text-button", glyph: "arrow",
  });
  return section(
    `Payment proofs${summary.proofCount ? ` (${summary.proofCount})` : ""}`,
    `<p class="collection-summary-copy">${summary.rentSubmittedPaise
      ? `${money(summary.rentSubmittedPaise)} rent awaiting bank confirmation`
      : summary.proofCount ? "Awaiting bank confirmation" : "No proofs awaiting confirmation this month."}</p>` +
      (summary.proofCount > 0 ? button("Reconcile payments", {
        route: "ownerDirectOverview", params: { view: "proofs", mode: "reconcile" }, kind: "primary block",
      }) : "") +
      proofs.map(proof => proofRow(proof, timeZone)).join(""),
    summary.proofCount > 0 ? path("proofs", "View all proofs") : "",
  ) + section(
    "Separate electricity",
    card(
      `<div class="collection-card-title">${icon("bolt")}<span>${esc(month(period.year, period.month))} · ${summary.electricityBillCount} ${summary.electricityBillCount === 1 ? "bill" : "bills"}</span></div>` +
      electricitySummary(summary),
      "direct-collection-totals",
    ),
    path("electricity", "View bills"),
  );
}

function reconciliationForm(proofs) {
  return `<form data-form="reconcileTransfers" novalidate>
    <p class="collection-summary-copy">Select up to 10 proofs. Match each credit in your bank and enter the combined total.</p>
    <div class="form-error" role="alert"></div>
    ${proofs.map(proof => card(
      `<label class="collection-selection"><input name="selectedTransfer" type="checkbox" value="${esc(proof.id)}">${identity(proof)}<strong>${money(proof.amountPaise)}</strong></label>
      <p class="collection-row-meta">${esc(paymentCharges(proof))}</p>
      <details class="disclosure collection-meter" data-defer-evidence><summary>Payment screenshot</summary>
        <img data-evidence-id="${esc(proof.evidenceId)}" alt="Payment screenshot" hidden>
      </details>
      ${proof.meterEvidenceId ? `<details class="disclosure collection-meter" data-defer-evidence><summary>Meter photo</summary>
        <img data-evidence-id="${esc(proof.meterEvidenceId)}" alt="Meter photo" hidden></details>` : ""}
      <fieldset data-bank-reference="${esc(proof.id)}" hidden disabled>
        ${field(`bank-${proof.id}`, "Bank transaction reference", {
          required: true, value: proof.bankReference || "", attrs: 'minlength="6" maxlength="40" autocomplete="off"',
        })}
      </fieldset>`, "direct-collection-row",
    )).join("")}
    ${card(`<div class="collection-row-head"><strong>Selected total</strong><output data-reconcile-total aria-live="polite">${money(0)}</output></div>
      ${field("bankTotal", "Matched bank total (₹)", { required: true, attrs: 'inputmode="decimal" autocomplete="off"' })}
      <label class="bank-check"><input name="bankChecked" type="checkbox" required>I matched each selected credit, payee and amount in my bank and checked the electricity bills.</label>
      ${button("Confirm selected payments", { type: "submit", kind: "primary block" })}`, "direct-collection-row")}
  </form>`;
}

function electricityBillRow(bill) {
  const statuses = {
    PAID: ["Collected", "green"], SUBMITTED: ["Proof submitted", "amber"],
    REJECTED: ["Correction requested", "warning"], DUE: ["Unpaid", ""],
  };
  const [label, tone] = statuses[bill.status] || statuses.DUE;
  return card(
    `<div class="collection-row-head">${identity(bill)}<div><strong>${money(bill.amountPaise)}</strong>${badge(label, tone)}</div></div>
    <details class="disclosure collection-meter" data-defer-evidence><summary>Meter photo</summary>
      <img data-evidence-id="${esc(bill.meterEvidenceId)}" alt="Meter photo" hidden>
    </details>` +
    (bill.transferId ? button(bill.status === "SUBMITTED" ? "Review proof" : "View payment", {
      route: "ownerTransferReview", params: { id: bill.transferId, invoiceId: bill.invoiceId },
      kind: "secondary block", glyph: "arrow",
    }) : ""), "direct-collection-row",
  );
}

export async function ownerDirectOverviewScreen(ctx) {
  const view = ctx.params.view === "electricity" ? "electricity" : "proofs";
  const period = ctx.snapshot.period;
  const data = await readOwnerDirectOverview(ctx, { view, cursor: ctx.params.cursor });
  const electricity = view === "electricity";
  const reconciling = !electricity && ctx.params.mode === "reconcile";
  const title = electricity ? "Electricity bills" : reconciling ? "Reconcile payments" : "Payment proofs";
  const images = evidenceImages(ctx);
  const timeZone = ctx.snapshot.property?.timezone;
  const rows = electricity ? data.bills.map(electricityBillRow) : data.proofs.map(proof => proofRow(proof, timeZone));
  let reconciliation;
  function selectedProofs(form) {
    const selected = new Set(new FormData(form).getAll("selectedTransfer"));
    return data.proofs.filter(proof => selected.has(proof.id));
  }
  function updateSelection() {
    const selected = selectedProofs(reconciliation);
    const ids = new Set(selected.map(proof => proof.id));
    for (const fields of reconciliation.querySelectorAll("[data-bank-reference]")) {
      fields.disabled = fields.hidden = !ids.has(fields.dataset.bankReference);
    }
    reconciliation.querySelector("[data-reconcile-total]").value =
      money(selected.reduce((total, proof) => total + proof.amountPaise, 0));
  }
  return {
    title, back: true, nav: false, contentClass: "direct-collection-page",
    guardForm: reconciling, financialMutation: reconciling,
    content: heading("", title, month(period.year, period.month)) +
      (electricity
        ? card(electricitySummary(data.summary), "direct-collection-totals")
        : `<p class="collection-summary-copy">${data.summary.proofCount} awaiting bank confirmation</p>` +
          (!reconciling && data.proofs.length ? button("Reconcile payments", {
            route: "ownerDirectOverview", params: { view, mode: "reconcile", ...(ctx.params.cursor ? {cursor: ctx.params.cursor} : {}) },
            kind: "primary block",
          }) : "")) +
      (reconciling && data.proofs.length ? reconciliationForm(data.proofs)
        : rows.join("") || `<p class="compact-empty">${electricity ? "No separate electricity bills this month." : "No proofs on this page."}</p>`) +
      (data.nextCursor ? button("Next page", {
        route: "ownerDirectOverview", params: { view, cursor: data.nextCursor, ...(reconciling ? { mode: "reconcile" } : {}) },
        kind: "secondary block",
      }) : ""),
    mount() {
      void images.mount();
      reconciliation = document.querySelector('[data-form="reconcileTransfers"]');
      reconciliation?.addEventListener("change", updateSelection);
      if (reconciliation) updateSelection();
    },
    unmount() {
      reconciliation?.removeEventListener("change", updateSelection);
      images.unmount();
    },
    async submit(name, form) {
      if (name !== "reconcileTransfers") return;
      const selected = selectedProofs(form);
      if (!selected.length || selected.length > 10) throw new Error("Select between 1 and 10 payments.");
      const amountPaise = Math.round(parseRupees(form.elements.bankTotal.value, { min: 0.01, max: 214748364.7 }) * 100);
      if (amountPaise !== selected.reduce((sum, proof) => sum + proof.amountPaise, 0)) {
        throw new Error("The bank total must match the selected payments.");
      }
      const result = await ctx.api("/api/platform/direct-payments/owner/reconcile", {
        method: "POST",
        body: {
          year: period.year, month: period.month, amountPaise, bankChecked: form.elements.bankChecked.checked,
          payments: selected.map(proof => ({
            transferId: proof.id, proofId: proof.proofId, bankReference: form.elements.namedItem(`bank-${proof.id}`).value.trim(),
          })),
        },
      });
      ctx.markSaved();
      ctx.invalidate();
      ctx.toast(`${result.confirmedCount} ${result.confirmedCount === 1 ? "payment" : "payments"} reconciled.`);
      return ctx.navigate("ownerDirectOverview", { view: "proofs" }, { replace: true, force: true });
    },
  };
}
