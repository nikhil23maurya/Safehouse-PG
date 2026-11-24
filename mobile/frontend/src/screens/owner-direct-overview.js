import { badge, button, card, date, esc, heading, month, section,routeAttrs } from "../components/ui.js";
import { evidenceImages } from "../components/evidence.js";
import { icon } from "../components/icons.js";
import { money } from "../domain/finance.js";

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
    `<div class="${label==="Proof submitted"?"collection-submitted":label==="Collected"?"collection-confirmed":""}"><dt>${esc(label)}</dt><dd>${amount?money(amount):"—"}</dd></div>`
  ).join("")}</dl>`;
}

export function ownerRentSummary(metrics,summary){
 if(!summary){const rate=Number.isFinite(metrics.collectionRate)?Math.max(0,Math.min(100,metrics.collectionRate)):0;return `<section class="financial-summary" aria-label="Monthly collection"><div class="summary-top"><span>Rent collected</span>${icon("wallet")}</div><div class="financial-amount">${money(metrics.totalCollectedPaise)}</div><p>of ${money(metrics.totalExpectedPaise)} expected</p><div class="collection-track" role="progressbar" aria-label="Rent collection" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${rate}"><span style="width:${rate}%"></span></div><div class="summary-bottom"><span><small>Outstanding</small><strong>${money(metrics.pendingTotalPaise)}</strong></span><span><small>Collected</small><strong>${rate}%</strong></span></div></section>`;}
 const submitted=summary?.rentSubmittedPaise||0,confirmed=metrics.totalCollectedPaise;
 const state=submitted?"submitted":confirmed?"confirmed":"empty";
 const progress=Math.max(0,Math.min(100,metrics.collectionRate||0));
 const awaiting=metrics.totalExpectedPaise?Math.min(100-progress,submitted/metrics.totalExpectedPaise*100):0;
 return `<section class="financial-summary rent-status-summary" aria-label="Monthly collection" data-collection-state="${state}"><div class="summary-top"><span>${submitted?"Rent submitted":confirmed?"Rent received":"Rent collection"}</span>${icon("wallet")}</div><div class="financial-amount">${submitted?money(submitted):confirmed?money(confirmed):'<span class="collection-empty-amount">Awaiting payments</span>'}</div><p>of ${money(metrics.totalExpectedPaise)} billed</p><div class="collection-track" role="progressbar" aria-label="Confirmed rent collection" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span class="confirmed-progress" style="width:${progress}%"></span><span class="submitted-progress" style="width:${awaiting}%"></span></div><div class="collection-state-values"><div class="collection-submitted"><span>Submitted · to review</span><strong>${submitted?money(submitted):"—"}</strong></div><div class="collection-confirmed"><span>Confirmed received</span><strong>${confirmed?money(confirmed):"—"}</strong></div></div><div class="collection-outstanding"><span>Outstanding until confirmed</span><strong>${money(metrics.pendingTotalPaise)}</strong></div></section>`;
}
export function ownerDirectOverview(overview,period){
 const s=overview.summary;
 return `<section class="electricity-collection" aria-label="Electricity collection"><div class="collection-electricity-head"><div>${icon("bolt")}<h2>Electricity</h2></div>${button("View bills",{route:"ownerDirectOverview",params:{view:"electricity"},kind:"text-button",glyph:"arrow"})}</div><p class="collection-summary-copy">${esc(month(period.year,period.month))} · ${s.electricityBillCount} ${s.electricityBillCount===1?"bill":"bills"}</p><div class="direct-collection-totals">${electricitySummary(s)}</div></section><button class="collection-proof-inbox" ${routeAttrs("ownerDirectOverview",{view:"proofs",...(s.proofCount?{mode:"reconcile"}:{})})} aria-label="${s.proofCount?"Reconcile payments":"View payment proofs"}"><span class="row-icon">${icon("receipt")}</span><span><strong>Payment proofs</strong><small>${s.proofCount?`${s.proofCount} awaiting bank confirmation`:"No proofs waiting"}</small></span>${s.proofCount?badge(String(s.proofCount),"amber"):""}${icon("arrow")}</button>`;
}

function reconciliationForm(proofs) {
  return `<form data-form="reconcileTransfers" novalidate>
    <p class="collection-summary-copy">Select up to 10 payments after checking each screenshot and bank credit.</p>
    <div class="form-error" role="alert"></div>
    ${proofs.map(proof => card(
      `<label class="collection-selection"><input name="selectedTransfer" type="checkbox" value="${esc(proof.id)}">${identity(proof)}<strong>${money(proof.amountPaise)}</strong></label>
      <p class="collection-row-meta">${esc(paymentCharges(proof))}</p>
      <details class="disclosure collection-meter" data-defer-evidence><summary>Payment screenshot</summary>
        <img data-evidence-id="${esc(proof.evidenceId)}" alt="Payment screenshot" hidden>
      </details>
      ${proof.meterEvidenceId ? `<details class="disclosure collection-meter" data-defer-evidence><summary>Meter photo</summary>
        <img data-evidence-id="${esc(proof.meterEvidenceId)}" alt="Meter photo" hidden></details>` : ""}
      `, "direct-collection-row",
    )).join("")}
    ${card(`<div class="collection-row-head"><strong>Selected total</strong><output data-reconcile-total aria-live="polite">${money(0)}</output></div>
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
      const amountPaise=selected.reduce((sum,proof)=>sum+proof.amountPaise,0);
      if(!form.elements.bankChecked.checked)throw new Error("Check each bank credit before confirming.");
      if(!await ctx.confirm({title:"Confirm received payments?",message:`Record ${money(amountPaise)} received across ${selected.length} ${selected.length===1?"payment":"payments"}. Confirm only after checking the credits in your bank.`,confirmLabel:"Confirm received"}))return;
      const result = await ctx.api("/api/platform/direct-payments/owner/reconcile", {
        method: "POST",
        body: {
          year: period.year, month: period.month, amountPaise, bankChecked: form.elements.bankChecked.checked,
          payments: selected.map(proof => ({
            transferId: proof.id, proofId: proof.proofId,
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
