import { icon, brand } from "./icons.js";
import { money, invoiceStatus } from "../domain/finance.js";

export const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const initials = (name) =>
  String(name || "SH")
    .trim()
    .split(/\s+/)
    .map((x) => x[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
export function date(value, timeZone = "Asia/Kolkata", withTime = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(new Date(value));
}
export const month = (year, m) =>
  new Intl.DateTimeFormat("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, m - 1, 1)));
export const routeAttrs = (name, params = {}) =>
  `data-route="${esc(name)}" data-params="${esc(JSON.stringify(params))}"`;
export function button(
  label,
  {
    action,
    route,
    params,
    kind = "primary",
    glyph,
    attrs = "",
    type = "button",
  } = {},
) {
  return `<button type="${type}" class="button ${kind}" ${action ? `data-action="${esc(action)}"` : ""} ${route ? routeAttrs(route, params) : ""} ${attrs}>${glyph ? icon(glyph) : ""}<span>${esc(label)}</span></button>`;
}
export function iconButton(label, glyph, action, attrs = "") {
  return `<button type="button" class="icon-button" aria-label="${esc(label)}" data-action="${esc(action)}" ${attrs}>${icon(glyph)}</button>`;
}
export const badge = (label, tone = "neutral") =>
  `<span class="badge ${esc(tone)}">${esc(label)}</span>`;
export function invoiceBadge(invoice) {
  const s = invoiceStatus(invoice);
  return badge(s.label, s.tone);
}
export function heading(kicker, title, description = "", accessory = "") {
  return `<div class="page-heading"><div>${kicker ? `<p class="eyebrow">${esc(kicker)}</p>` : ""}<h1>${esc(title)}</h1>${description ? `<p class="subtitle">${esc(description)}</p>` : ""}</div>${accessory}</div>`;
}
export function section(title, content, accessory = "") {
  return `<section class="section"><div class="section-heading"><h2>${esc(title)}</h2>${accessory}</div>${content}</section>`;
}
export const card = (body, className = "") =>
  `<div class="card ${className}">${body}</div>`;
export function empty(
  title,
  description,
  { glyph = "invoice", action = "" } = {},
) {
  return `<div class="empty-state"><span class="empty-icon">${icon(glyph)}</span><h2>${esc(title)}</h2><p>${esc(description)}</p>${action}</div>`;
}
export function errorState(message) {
  return empty("Couldn’t load this page", message, {
    glyph: "alert",
    action: button("Try again", { action: "reload", glyph: "refresh" }),
  });
}
export function notice(message, tone = "info") {
  return `<div class="notice ${tone}" role="${tone === "error" ? "alert" : "status"}">${icon(tone === "error" ? "alert" : "shield")}<span>${esc(message)}</span></div>`;
}
export function periodControl(period) {
  return `<div class="period-control">${iconButton("Previous month", "back", "period", 'data-delta="-1"')}<span>${esc(month(period.year, period.month))}</span>${iconButton("Next month", "arrow", "period", 'data-delta="1"')}</div>`;
}
export function detail(label, value) {
  return `<div class="detail"><dt>${esc(label)}</dt><dd>${esc(value ?? "—")}</dd></div>`;
}
export function avatar(name, large = false) {
  return `<span class="avatar${large ? " large" : ""}">${esc(initials(name))}</span>`;
}
export function residentRow(student) {
  const room = student.room?.number
    ? `Room ${student.room.number}${student.bedLabel ? ` · ${student.bedLabel}` : ""}`
    : "Room unassigned";
  return `<button class="list-row" ${routeAttrs("resident", { id: student.id })}>${avatar(student.name)}<span class="row-body"><strong>${esc(student.name)}</strong><small>${esc(room)}</small></span><span class="row-end"><strong aria-label="Monthly rent">${money(student.periodInvoice?.rentPaise ?? student.currentInvoice?.rentPaise ?? student.monthlyRentPaise)}</strong>${student.status !== "ACTIVE" ? badge(student.status === "MOVED_OUT" ? "Moved out" : "Inactive") : invoiceBadge(student.periodInvoice || student.currentInvoice)}</span>${icon("chevron", "row-chevron")}</button>`;
}
export function paymentRow(payment, owner = false) {
  return `<div class="list-row payment-row"><span class="row-icon">${icon(payment.source === "MANUAL" ? "wallet" : "check")}</span><span class="row-body"><strong>${esc(owner ? payment.student?.name || "Rent payment" : payment.invoice ? month(payment.invoice.year, payment.invoice.month) : "Rent payment")}</strong><small>${esc(date(payment.paidAt))} · ${esc((payment.method || payment.source || "").replace(/_/g, " "))}</small><small class="reference">${esc(payment.receiptNumber)}</small></span><span class="row-end"><strong>${money(payment.amountPaise)}</strong>${payment.receiptNumber ? `<button class="text-button receipt-button" data-action="receipt" data-id="${esc(payment.id)}" data-number="${esc(payment.receiptNumber)}" aria-label="Download receipt ${esc(payment.receiptNumber)}">${icon("download")} Receipt</button>` : badge("Receipt pending")}</span></div>`;
}
export function invoiceCard(invoice, owner = false, residentId) {
  return `<button class="invoice-card" ${routeAttrs("invoice", { id: invoice.id, ...(residentId ? { residentId } : {}) })}><span class="row-icon">${icon("invoice")}</span><span class="row-body"><strong>${esc(month(invoice.year, invoice.month))}</strong><small>Due ${esc(date(invoice.dueDate))}</small></span><span class="row-end"><strong>${money(invoice.totalPaise)}</strong>${invoiceBadge(invoice)}</span>${icon("chevron", "row-chevron")}</button>`;
}
export function breakdown(invoice) {
  return `<dl class="breakdown">${[
    ["Base rent", "rentPaise"],
    ["Electricity", "electricityPaise"],
    ["Late fee", "lateFeePaise"],
    ["Other charges", "otherChargesPaise"],
  ]
    .map(([label, key]) => detail(label, money(invoice[key])))
    .join(
      "",
    )}${detail("Discount", invoice.discountPaise ? `−${money(invoice.discountPaise)}` : money(invoice.discountPaise))}<div class="breakdown-total">${detail("Total payable", money(invoice.totalPaise))}</div>${detail("Paid", money(invoice.paidPaise))}${detail("Remaining balance", money(invoice.remainingPaise))}</dl>`;
}
export function search(
  value = "",
  placeholder = "Search residents",
  name = "q",
) {
  return `<form class="search-form" data-form="search" role="search">${icon("search")}<input type="search" name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}" enterkeyhint="search" autocomplete="off"><button class="icon-button" aria-label="Search" type="submit">${icon("arrow")}</button></form>`;
}
export function filters(items, active, action = "filter") {
  return `<div class="filter-row" aria-label="Filter">${items.map(([value, label]) => `<button class="filter-chip${active === value ? " selected" : ""}" data-action="${action}" data-value="${esc(value)}" aria-pressed="${active === value}">${esc(label)}</button>`).join("")}</div>`;
}
export function skeleton(name = "dashboard") {
  const rows = [
    "residents",
    "rooms",
    "history",
    "notifications",
    "dues",
  ].includes(name);
  return `<div class="skeleton" role="status" aria-label="Loading ${esc(name)}"><span class="sr-only">Loading…</span><div class="sk sk-title"></div><div class="sk sk-caption"></div>${rows ? Array.from({ length: 6 }, () => '<div class="sk-row"><div class="sk sk-avatar"></div><div class="sk-text"><div class="sk sk-line"></div><div class="sk sk-line short"></div></div></div>').join("") : `<div class="sk sk-summary"></div><div class="sk-metrics">${'<div class="sk"></div>'.repeat(3)}</div>${'<div class="sk sk-panel"></div>'.repeat(name === "payment" ? 1 : 2)}`}</div>`;
}

const ownerTabs = [
  ["ownerHome", "home", "Home"],
  ["residents", "users", "Residents"],
  ["rooms", "rooms", "Rooms"],
  ["dues", "wallet", "Dues"],
  ["profile", "user", "You"],
];
const residentTabs = [
  ["studentHome", "home", "Home"],
  ["invoices", "invoice", "Invoices"],
  ["history", "wallet", "Payments"],
  ["profile", "user", "You"],
];
export function shell(screen, snapshot) {
  const role = snapshot.user?.role;
  if (screen.bare) return screen.content;
  const tabs = role === "OWNER" ? ownerTabs : residentTabs;
  return `<div class="app-shell${screen.nav === false ? " without-nav" : ""}"><header class="app-header">${screen.back ? iconButton("Go back", "back", "back") : brand()}${screen.back ? `<span class="header-title">${esc(screen.title || "SafeHouse")}</span>` : '<span class="header-spacer"></span>'}${screen.headerAction || `<button class="icon-button" ${routeAttrs("notifications")} aria-label="Notifications">${icon("bell")}</button>${!screen.back ? `<button class="profile-button" ${routeAttrs("profile")} aria-label="Your profile">${esc(initials(snapshot.user?.fullName))}</button>` : ""}`}</header><main id="main" class="content ${screen.contentClass || ""}" tabindex="-1">${screen.content}</main>${screen.nav === false ? "" : `<nav class="bottom-nav" aria-label="Main navigation">${tabs.map(([route, glyph, label]) => `<button ${routeAttrs(route)} class="nav-item${screen.nav === route ? " active" : ""}" ${screen.nav === route ? 'aria-current="page"' : ""}><span>${icon(glyph)}</span><small>${label}</small></button>`).join("")}</nav>`}</div>`;
}
