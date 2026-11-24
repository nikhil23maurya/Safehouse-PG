import { icon } from "../components/icons.js";
import { money, invoiceStatus } from "../domain/finance.js";
import { ownerDirectOverview, readOwnerDirectOverview } from "./owner-direct-overview.js";
import {
  esc,
  section,
  card,
  button,
  routeAttrs,
  periodControl,
  month,
  date,
  badge,
  empty,
  notice,
  paymentRow,
  invoiceCard,
  detail,
} from "../components/ui.js";

function quick(route, glyph, label, params = {}) {
  return `<button class="quick-action" ${routeAttrs(route, params)}><span>${icon(glyph)}</span><small>${esc(label)}</small></button>`;
}
function metrics(items) {
  return `<div class="metrics-strip">${items.map(([value, label]) => `<div><strong>${esc(value ?? "—")}</strong><span>${esc(label)}</span></div>`).join("")}</div>`;
}
function dueRow(invoice, timeZone, proofSubmitted) {
  const status = proofSubmitted ? "Proof submitted" : invoice.overdue ? "Overdue" : "Pending";
  return `<button class="list-row" ${routeAttrs("invoice", { id: invoice.id, residentId: invoice.student?.id })}><span class="row-icon">${icon("clock")}</span><span class="row-body"><strong>${esc(invoice.student?.name)}</strong><small>${esc(invoice.student?.room ? `Room ${invoice.student.room}` : "Unassigned")} · Due ${esc(date(invoice.dueDate, timeZone))}</small></span><span class="row-end"><strong>${money(invoice.remainingPaise)}</strong>${badge(status, proofSubmitted ? "amber" : "warning")}</span></button>`;
}

export async function ownerHomeScreen(ctx) {
  const [dashboardResult, roomsResult] = await Promise.allSettled([
    ctx.read(`/api/owner/dashboard?${ctx.periodQuery}`),
    ctx.read("/api/owner/rooms"),
  ]);
  if (dashboardResult.status === "rejected") throw dashboardResult.reason;
  const d = dashboardResult.value,
    m = d.metrics;
  const dues = d.pendingDues?.slice(0, 3) || [];
  const timeZone = ctx.snapshot.property?.timezone;
  let direct, directUnavailable = false;
  if (ctx.snapshot.tokens?.kind === "PLATFORM") {
    try {
      direct = await readOwnerDirectOverview(ctx, { due: dues.map(invoice => invoice.id) });
    } catch (error) {
      directUnavailable = error.status !== 404;
    }
  }
  const proofsByInvoice = new Set(direct?.rentProofInvoiceIds);
  let collectionRefresh, unmounted = false;
  const rooms =
    roomsResult.status === "fulfilled" ? roomsResult.value.rooms : null;
  const progress = Number.isFinite(m.collectionRate)
    ? Math.max(0, Math.min(100, m.collectionRate))
    : 0;
  return {
    title: "Home",
    nav: "ownerHome",
    contentClass: "owner-dashboard",
    content:
      `<section class="dashboard-hero" data-depth><h1>Hello, ${esc(ctx.snapshot.user.fullName?.split(" ")[0]||"Owner")}</h1><p>Property overview</p><img src="illustration-royal-residence.webp" alt="" draggable="false"></section><div class="property-context"><button data-route="properties">${icon("building")}<span>${esc(d.property.name)}</span>${icon("down")}</button>${button("Refresh", { action: "reload", kind: "secondary", glyph: "refresh" })}</div>` +
      periodControl(ctx.snapshot.period) +
      `<section class="financial-summary" aria-label="Monthly collection"><div class="summary-top"><span>Rent collected</span>${direct?.summary.proofCount
        ? button(`${direct.summary.proofCount} to review`, {route:"ownerDirectOverview",params:{view:"proofs"},kind:"collection-review-link"})
        : `<span>${icon("wallet")}</span>`}</div><div class="financial-amount">${money(m.totalCollectedPaise)}</div><p>of ${money(m.totalExpectedPaise)} expected</p><div class="collection-track" role="progressbar" aria-label="Rent collection" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="width:${progress}%"></span></div><div class="summary-bottom"><span><small>Outstanding</small><strong>${money(m.pendingTotalPaise)}</strong></span><span><small>Collected</small><strong>${Number.isFinite(m.collectionRate) ? `${m.collectionRate}%` : "—"}</strong></span></div></section>` +
      (roomsResult.status === "rejected"
        ? notice(
            "Room totals are temporarily unavailable. Refresh to try again.",
          )
        : "") +
      section(
        "Quick actions",
        `<div class="quick-actions">${quick("residentRequests", "users", "Resident requests")}${quick("roomForm", "plus", "Add room")}${quick("dues", "invoice", "View dues")}${quick(ctx.snapshot.platform ? "pgCode" : "dues", ctx.snapshot.platform ? "building" : "wallet", ctx.snapshot.platform ? "Share PG code" : "Record payment", ctx.snapshot.platform ? {} : { recording: true })}</div>`,
      ) +
      metrics([
        [rooms?.length, "Rooms"],
        [
          m.occupiedBeds === undefined || m.totalBeds === undefined
            ? null
            : `${m.occupiedBeds}/${m.totalBeds}`,
          "Beds occupied",
        ],
        [m.totalStudents, "Residents"],
        [m.pendingStudents, "Rent outstanding"],
      ]) +
      (direct ? ownerDirectOverview(direct, ctx.snapshot.period, timeZone)
        : directUnavailable ? notice("Payment proofs and electricity are temporarily unavailable. Refresh to try again.") : "") +
      section(
        "Needs attention",
        `<div class="list">${dues.length ? dues.map(i => dueRow(i, timeZone, proofsByInvoice.has(i.id))).join("") : `<p class="compact-empty">No pending dues this month.</p>`}</div>`,
        `<button class="text-button" ${routeAttrs("dues")}>View all ${icon("arrow")}</button>`,
      ) +
      section(
        "Recent payments",
        `<div class="list">${d.recentPayments?.length ? d.recentPayments.slice(0,3).map((x) => paymentRow(x, true, ctx.snapshot.property?.timezone)).join("") : `<p class="compact-empty">No payments this month.</p>`}</div>`,
        `<button class="text-button" ${routeAttrs("ownerPayments")}>View all ${icon("arrow")}</button>`,
      ) +
      "",
    mount() {
      if (!direct) return;
      const rendered = JSON.stringify(direct);
      collectionRefresh = setInterval(async () => {
        if (document.hidden || unmounted) return;
        try {
          const latest = await readOwnerDirectOverview(ctx, { due: dues.map(invoice => invoice.id) });
          if (!unmounted && JSON.stringify(latest) !== rendered) await ctx.reload();
        } catch {
          // Keep the last loaded view. A later refresh can recover the read.
        }
      }, 30000);
    },
    unmount() {
      unmounted = true;
      clearInterval(collectionRefresh);
    },
  };
}

export async function studentHomeScreen(ctx) {
  const d = await ctx.read("/api/student/dashboard");
  let invoice = d.currentInvoice;
  const s = d.student;
  const timeZone = ctx.snapshot.property?.timezone;
  const propertyName = ctx.snapshot.property?.name || "Your PG";
  const roomName = s.room?.number ? `Room ${s.room.number}` : "Room unassigned";
  let direct;
  if (invoice && ctx.snapshot.tokens?.kind === "PLATFORM") {
    try {
      const payment = await ctx.api(`/api/platform/direct-payments/invoices/${encodeURIComponent(invoice.id)}`, { timeout: 8000 });
      if (payment.invoice?.id === invoice.id) {
        direct = payment;
        invoice = { ...invoice, ...payment.invoice };
      }
    } catch {
      // The platform transfer view is optional on older backends.
    }
  }
  if (
    invoice &&
    ["PAID", "WAIVED"].includes(invoice.status) &&
    ctx.snapshot.pendingPayment?.invoiceId === invoice.id
  )
    await ctx.payment.setPending(null);
  const payable =
    invoice &&
    !["PAID", "WAIVED"].includes(invoice.status) &&
    invoice.remainingPaise > 0;
  const reviewing = direct?.transfers?.filter(transfer => ["SUBMITTED", "REJECTED"].includes(transfer.status)) || [];
  const rentProof = payable ? reviewing.find(transfer => transfer.rentPaise > 0) : null;
  const electricityProof = reviewing.find(transfer => transfer.electricityPaise > 0);
  const rentStatus = rentProof ? submittedStatus(rentProof) : invoiceStatus(invoice);
  const paymentLink = (label, kind) => button(label, {route:"payment",params:{invoiceId:invoice.id},kind,glyph:"arrow"});
  const proofLink = (transfer, kind) => button("View proof", {
    route: "transferProof", params: { id: transfer.id, invoiceId: invoice.id }, kind, glyph: "arrow",
  });
  const rentAction = invoice && (rentProof ? proofLink(rentProof, "secondary block")
    : payable ? paymentLink(invoice.status === "PROCESSING" || ctx.snapshot.pendingPayment?.invoiceId === invoice.id
      ? "Check payment" : "Pay rent", "primary block")
      : button("View invoice", { route: "invoice", params: { id: invoice.id }, kind: "secondary block", glyph: "arrow" }));
  const bill = direct?.bill;
  const included = direct?.invoice.electricityIncludedPaise;
  const electricityStatus = bill?.status === "PAID" ? {label:"Paid",tone:"success"}
    : electricityProof ? submittedStatus(electricityProof)
      : bill ? {label:"Unpaid",tone:"warning"} : included ? {label:"Included in rent",tone:"neutral"} : null;
  const billAction = direct && (electricityProof && bill?.status !== "PAID"
    ? electricityProof.id !== rentProof?.id ? proofLink(electricityProof, "text-button") : ""
    : included ? button("View invoice", { route: "invoice", params: { id: invoice.id }, kind: "text-button" })
      : paymentLink(bill ? "View bill" : "Add bill", "text-button"));
  return {
    title: "Home",
    nav: "studentHome",
    contentClass:"resident-dashboard resident-home-dashboard",
    content:
      `<section class="resident-welcome"><div><p>${icon("building")}${esc(propertyName)}</p>
        <h1>Hello, ${esc(s.name?.trim().split(/\s+/)[0] || "Resident")}.</h1>
        <span>${esc(roomName)}${s.bedLabel ? ` · ${esc(s.bedLabel)}` : ""}</span></div>
        <img src="illustration-royal-residence.webp" alt=""></section>` +
      (invoice
        ? `<section class="resident-rent-card" aria-label="Current rent"><div class="resident-rent-head">
            <div><h2>Rent</h2><p>${esc(month(invoice.year, invoice.month))}</p></div>${badge(rentStatus.label, rentStatus.tone)}
          </div>
          <strong class="resident-balance">${money(rentProof?.rentPaise ?? invoice.remainingPaise)}</strong>
          <p>${rentProof ? (rentProof.status === "SUBMITTED" ? "Awaiting bank confirmation" : "Check the requested correction")
            : payable ? `Due ${esc(date(invoice.dueDate, timeZone))}` : "Outstanding balance"}</p>
          ${rentAction}</section>`
        : card(
            empty(
              "Your invoice is on its way",
              "Your property owner hasn’t issued an invoice for this month.",
            ),
          )) +
      (direct ? `<section class="resident-electricity-card" aria-label="Electricity">
        <span class="row-icon">${icon("bolt")}</span><div><h2>Electricity</h2><p>${bill || included
          ? money(bill?.amountPaise ?? included) : "No separate bill added"}</p></div>
        <div>${electricityStatus ? badge(electricityStatus.label, electricityStatus.tone) : ""}${billAction}</div></section>` : "") +
      (ctx.snapshot.pendingPayment &&
      ctx.snapshot.pendingPayment.invoiceId !== invoice?.id
        ? notice(
            "An earlier payment may still need confirmation. Open your invoices to check its status.",
          )
        : "") +
      `<div class="resident-shortcuts">
        ${button("All invoices", {route:"invoices",glyph:"invoice",kind:"secondary"})}
        ${button("Payment history", {route:"history",glyph:"wallet",kind:"secondary"})}
      </div>` +
      section(
        "Your space",
        card(
          `<dl>${detail("Monthly rent", money(s.monthlyRentPaise))}${detail("Security deposit", money(s.securityDepositPaise))}${detail("Joined", date(s.joiningDate, "UTC"))}</dl>`,
        ),
      ) +
      section(
        "Recent payments",
        `<div class="list">${d.recentPayments?.length ? d.recentPayments.slice(0,2).map(x => paymentRow(x, false, timeZone)).join("") : `<p class="compact-empty">No confirmed payments yet.</p>`}</div>`,
      ) +
      button("Refresh balances", {
        action: "reload",
        kind: "secondary block",
        glyph: "refresh",
      }),
  };
}

function submittedStatus(transfer) {
  return transfer.status === "SUBMITTED"
    ? { label: "Payment submitted", tone: "amber" }
    : { label: "Correction requested", tone: "warning" };
}
