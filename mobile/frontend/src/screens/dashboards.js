import { icon } from "../components/icons.js";
import { money, invoiceStatus } from "../domain/finance.js";
import {
  esc,
  heading,
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
function dueRow(invoice) {
  return `<button class="list-row" ${routeAttrs("invoice", { id: invoice.id, residentId: invoice.student?.id })}><span class="row-icon">${icon("clock")}</span><span class="row-body"><strong>${esc(invoice.student?.name)}</strong><small>${esc(invoice.student?.room ? `Room ${invoice.student.room}` : "Unassigned")} · Due ${esc(date(invoice.dueDate))}</small></span><span class="row-end"><strong>${money(invoice.remainingPaise)}</strong>${badge(invoice.overdue ? "Overdue" : "Pending", "warning")}</span></button>`;
}

export async function ownerHomeScreen(ctx) {
  const [dashboardResult, roomsResult] = await Promise.allSettled([
    ctx.read(`/api/owner/dashboard?${ctx.periodQuery}`),
    ctx.read("/api/owner/rooms"),
  ]);
  if (dashboardResult.status === "rejected") throw dashboardResult.reason;
  const d = dashboardResult.value,
    m = d.metrics;
  const rooms =
    roomsResult.status === "fulfilled" ? roomsResult.value.rooms : null;
  const progress = Number.isFinite(m.collectionRate)
    ? Math.max(0, Math.min(100, m.collectionRate))
    : 0;
  const firstName = ctx.snapshot.user.fullName.split(" ")[0];
  return {
    title: "Home",
    nav: "ownerHome",
    contentClass: "owner-dashboard",
    content:
      `<div class="property-context"><button data-route="properties">${icon("building")}<span>${esc(d.property.name)}</span>${icon("down")}</button>${button("Refresh", { action: "reload", kind: "secondary", glyph: "refresh" })}</div>` +
      heading("", `Hello, ${firstName}.`) +
      periodControl(ctx.snapshot.period) +
      `<section class="financial-summary" aria-label="Monthly collection"><div class="summary-top"><span>Rent collected</span><span>${icon("wallet")}</span></div><div class="financial-amount">${money(m.totalCollectedPaise)}</div><p>of ${money(m.totalExpectedPaise)} expected</p><div class="collection-track" role="progressbar" aria-label="Rent collection" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="width:${progress}%"></span></div><div class="summary-bottom"><span><small>Pending</small><strong>${money(m.pendingTotalPaise)}</strong></span><span><small>Collected</small><strong>${Number.isFinite(m.collectionRate) ? `${m.collectionRate}%` : "—"}</strong></span></div></section>` +
      metrics([
        [rooms?.length, "Rooms"],
        [
          m.occupiedBeds === undefined || m.totalBeds === undefined
            ? null
            : `${m.occupiedBeds}/${m.totalBeds}`,
          "Beds occupied",
        ],
        [m.totalStudents, "Residents"],
        [m.pendingStudents, "Rent pending"],
      ]) +
      (roomsResult.status === "rejected"
        ? notice(
            "Room totals are temporarily unavailable. Refresh to try again.",
          )
        : "") +
      section(
        "Get things done",
        `<div class="quick-actions">${quick("residentForm", "users", "Add resident")}${quick("roomForm", "plus", "Add room")}${quick("dues", "invoice", "View dues")}${quick("dues", "wallet", "Record payment", { recording: true })}</div>`,
      ) +
      section(
        "Needs attention",
        `<div class="list">${d.pendingDues?.length ? d.pendingDues.map(dueRow).join("") : empty("All caught up", "There are no pending dues for this billing month.", { glyph: "check" })}</div>`,
        `<button class="text-button" ${routeAttrs("dues")}>View all ${icon("arrow")}</button>`,
      ) +
      section(
        "Recent payments",
        `<div class="list">${d.recentPayments?.length ? d.recentPayments.map((x) => paymentRow(x, true)).join("") : empty("No payments yet", "Recorded payments for this billing month appear here.", { glyph: "wallet" })}</div>`,
        `<button class="text-button" ${routeAttrs("ownerPayments")}>View all ${icon("arrow")}</button>`,
      ) +
      `<p class="context-footnote">${esc(month(d.period.year, d.period.month))} · ${esc(d.property.name)}</p>`,
  };
}

export async function studentHomeScreen(ctx) {
  const d = await ctx.read("/api/student/dashboard");
  const invoice = d.currentInvoice,
    s = d.student,
    status = invoiceStatus(invoice);
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
  return {
    title: "Home",
    nav: "studentHome",
    content:
      heading(
        ctx.snapshot.property?.name || "YOUR HOME",
        `Hello, ${s.name.split(" ")[0]}.`,
        "A little clarity. A lot more peace of mind.",
      ) +
      (invoice
        ? `<section class="financial-summary resident-summary"><div class="summary-top"><span>${esc(month(invoice.year, invoice.month))}</span>${badge(status.label, "summary-badge")}</div><p class="amount-label">${payable ? "Rent outstanding" : invoice.status === "WAIVED" ? "Rent waived" : "Rent settled"}</p><div class="financial-amount">${money(invoice.remainingPaise)}</div><p>${payable ? `Due ${esc(date(invoice.dueDate))}` : "Your current month is taken care of."}</p>${payable ? button(invoice.status === "PROCESSING" || ctx.snapshot.pendingPayment?.invoiceId === invoice.id ? "Check payment" : "Pay rent", { route: "payment", params: { invoiceId: invoice.id }, glyph: "arrow", kind: "summary-pay" }) : `<button class="summary-link" ${routeAttrs("invoice", { id: invoice.id })}>View your invoice ${icon("arrow")}</button>`}</section>`
        : card(
            empty(
              "Your invoice is on its way",
              "Your property owner hasn’t issued an invoice for this month.",
            ),
          )) +
      (ctx.snapshot.pendingPayment &&
      ctx.snapshot.pendingPayment.invoiceId !== invoice?.id
        ? notice(
            "An earlier payment may still need confirmation. Open your invoices to check its status.",
          )
        : "") +
      section(
        "Your rent",
        invoice
          ? invoiceCard(invoice)
          : empty(
              "No invoice yet",
              "Your rent details will appear once an invoice is issued.",
            ),
        `<button class="text-button" ${routeAttrs("invoices")}>All invoices ${icon("arrow")}</button>`,
      ) +
      section(
        "Your space",
        card(
          `<div class="residency-head"><span class="row-icon">${icon("bed")}</span><div><h3>${esc(s.room?.number ? `Room ${s.room.number}` : "Room unassigned")}</h3><p>${esc(s.bedLabel || ctx.snapshot.property?.name || "Your residency")}</p></div></div><dl>${detail("Monthly rent", money(s.monthlyRentPaise))}${detail("Security deposit", money(s.securityDepositPaise))}${detail("Joined", date(s.joiningDate))}</dl>`,
        ),
      ) +
      section(
        "Recent payments",
        `<div class="list">${d.recentPayments?.length ? d.recentPayments.map((x) => paymentRow(x)).join("") : empty("A fresh start", "Your confirmed rent payments and receipts will appear here.", { glyph: "wallet" })}</div>`,
        `<button class="text-button" ${routeAttrs("history")}>View all ${icon("arrow")}</button>`,
      ) +
      button("Refresh balances", {
        action: "reload",
        kind: "secondary block",
        glyph: "refresh",
      }),
  };
}
