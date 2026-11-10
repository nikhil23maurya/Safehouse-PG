import { icon } from "../components/icons.js";
import {
  money,
  parseRupees,
  rupeesInput,
  invoiceStatus,
} from "../domain/finance.js";
import {
  esc,
  heading,
  section,
  card,
  button,
  badge,
  search,
  filters,
  periodControl,
  date,
  month,
  routeAttrs,
  invoiceBadge,
  invoiceCard,
  paymentRow,
  breakdown,
  empty,
  notice,
} from "../components/ui.js";
import { field, formValues, submitBar } from "../components/forms.js";

export async function loadInvoice(ctx) {
  if (ctx.snapshot.user.role === "STUDENT") {
    const result = await ctx.read("/api/student/invoices");
    const invoice = result.invoices.find((i) => i.id === ctx.params.id);
    if (!invoice)
      throw new Error(
        "This invoice is no longer available. Refresh your invoices.",
      );
    return { invoice, resident: ctx.snapshot.student };
  }
  if (!ctx.params.residentId)
    throw new Error("Choose this invoice from the resident or dues directory.");
  const result = await ctx.read(
    `/api/owner/students/${encodeURIComponent(ctx.params.residentId)}?${ctx.periodQuery}`,
  );
  let invoice = result.student.invoices?.find((i) => i.id === ctx.params.id);
  if (!invoice && result.periodInvoice?.id === ctx.params.id)
    invoice = result.periodInvoice;
  if (!invoice) {
    const dues = await ctx.read(`/api/owner/dues?${ctx.periodQuery}`);
    invoice = dues.dues.find(
      (i) => i.id === ctx.params.id && i.student?.id === ctx.params.residentId,
    );
  }
  if (!invoice)
    throw new Error(
      "This invoice is outside the available resident history. Choose the matching billing month and refresh.",
    );
  return { invoice, resident: result.student };
}

export async function duesScreen(ctx) {
  const data = await ctx.read(`/api/owner/dues?${ctx.periodQuery}`);
  const { q = "", status = "ALL", recording = false } = ctx.params;
  const dues = data.dues.filter(
    (i) =>
      (status !== "OVERDUE" || i.overdue) &&
      `${i.student?.name || ""} ${i.student?.room || ""} ${i.student?.mobile || ""}`
        .toLowerCase()
        .includes(q.toLowerCase()),
  );
  return {
    title: "Dues",
    nav: "dues",
    content:
      heading(
        ctx.snapshot.property?.name,
        recording ? "Record payment" : "Rent dues",
        recording
          ? "Choose the invoice you received payment for."
          : "",
      ) +
      periodControl(ctx.snapshot.period) +
      card(
        `<p class="eyebrow">Total outstanding</p><div class="financial-amount">${money(data.totalDuePaise)}</div><p class="subtitle">${data.overdueCount} overdue · ${esc(month(data.period.year, data.period.month))}</p>`, "dues-summary",
      ) +
      `<div class="section">${search(q, "Search name, room or mobile")}${filters(
        [
          ["ALL", "All pending"],
          ["OVERDUE", "Overdue"],
        ],
        status,
      )}</div>` +
      (dues.length
        ? dues
            .map((i) =>
              card(
                `<div class="campaign-head"><div><h3>${esc(i.student.name)}</h3><p class="subtitle">${esc(i.student.room ? `Room ${i.student.room}` : "Unassigned")} · Due ${esc(date(i.dueDate, ctx.snapshot.property?.timezone))}</p></div>${invoiceBadge(i)}</div><div class="financial-amount">${money(i.remainingPaise)}</div><div class="action-stack">${button(recording ? "Record payment" : "View invoice", { route: recording ? "manualPayment" : "invoice", params: { id: i.id, residentId: i.student.id }, kind: recording ? "primary" : "secondary", glyph: recording ? "wallet" : "invoice" })}${i.whatsappUrl ? `<button class="text-button" data-action="remind" data-id="${esc(i.id)}">${icon("send")} Send WhatsApp reminder ${icon("external")}</button>` : ""}</div>`, "dues-card",
              ),
            )
            .join("")
        : empty(
            "All clear here",
            q || status !== "ALL"
              ? "No dues match these filters."
              : "No pending rent for this property and billing month.",
            { glyph: "check" },
          )),
    submit(name, form) {
      if (name === "search")
        return ctx.navigate(
          "dues",
          { q: formValues(form).q.trim(), status, recording },
          { replace: true },
        );
    },
    action(name, el) {
      if (name === "filter")
        return ctx.navigate(
          "dues",
          { q, status: el.dataset.value, recording },
          { replace: true },
        );
      if (name === "remind") {
        const i = data.dues.find((x) => x.id === el.dataset.id);
        if (i?.whatsappUrl) return ctx.openExternal(i.whatsappUrl);
      }
    },
  };
}

export async function invoiceScreen(ctx) {
  const { invoice: i, resident } = await loadInvoice(ctx);
  const owner = ctx.snapshot.user.role === "OWNER";
  const params = { id: i.id, ...(owner ? { residentId: resident.id } : {}) };
  const payable =
    i.remainingPaise > 0 && !["PAID", "WAIVED"].includes(i.status);
  const status = invoiceStatus(i);
  return {
    title: "Rent invoice",
    back: true,
    nav: owner ? "dues" : "invoices",
    content:
      `<div class="invoice-header"><span class="row-icon">${icon("invoice")}</span><p class="eyebrow">RENT INVOICE</p><h1>${esc(month(i.year, i.month))}</h1><p class="subtitle">${esc(owner ? resident.name : ctx.snapshot.property?.name)}</p><div class="financial-amount">${money(i.remainingPaise)}</div>${badge(status.label, status.tone)}<p class="subtitle">Due ${esc(date(i.dueDate, ctx.snapshot.property?.timezone))}</p><p class="invoice-reference">Invoice ${esc(i.id)}</p></div>` +
      section("The breakdown", card(breakdown(i))) +
      (payable
        ? `<div class="action-stack">${owner ? button("Record payment", { route: "manualPayment", params, glyph: "wallet" }) : button(i.status === "PROCESSING" ? "Check payment" : "Pay rent", { route: "payment", params: { invoiceId: i.id }, glyph: "qr" })}${owner && i.status === "DUE" ? button("Edit charges", { route: "invoiceCharges", params, kind: "secondary", glyph: "edit" }) : ""}</div>`
        : "") +
      (i.payments?.length
        ? section(
            "Payments for this invoice",
            `<div class="list">${i.payments.map((p) => paymentRow({ ...p, invoice: { id: i.id, year: i.year, month: i.month } }, false, ctx.snapshot.property?.timezone)).join("")}</div>`,
          )
        : "") +
      notice(
        "This invoice keeps its historical rent snapshot. Payments and remaining balances are confirmed by the server.",
      ),
  };
}

export async function invoicesScreen(ctx) {
  const data = await ctx.read("/api/student/invoices");
  const { status = "ALL" } = ctx.params;
  const visible = data.invoices.filter(
    (i) =>
      status === "ALL" ||
      (status === "PAID"
        ? i.status === "PAID"
        : !["PAID", "WAIVED"].includes(i.status)),
  );
  return {
    title: "Invoices",
    nav: "invoices",
    content:
      heading(
        "",
        "Your invoices",
        "",
      ) +
      filters(
        [
          ["ALL", "All invoices"],
          ["PENDING", "Outstanding"],
          ["PAID", "Paid"],
        ],
        status,
      ) +
      (visible.length
        ? visible
            .map((i) =>
              invoiceCard(i, false, undefined, ctx.snapshot.property?.timezone),
            )
            .join("")
        : empty(
            "Nothing here yet",
            status === "ALL"
              ? "Your issued rent invoices will appear here."
              : "No invoices match this filter.",
            { glyph: "invoice" },
          )),
    action(name, el) {
      if (name === "filter")
        return ctx.navigate(
          "invoices",
          { status: el.dataset.value },
          { replace: true },
        );
    },
  };
}

export async function paymentsScreen(ctx) {
  const owner = ctx.snapshot.user.role === "OWNER";
  let payments;
  if (owner)
    payments = (await ctx.read(`/api/owner/payments?${ctx.periodQuery}`))
      .payments;
  else {
    const { invoices } = await ctx.read("/api/student/invoices");
    const seen = new Set();
    payments = invoices
      .flatMap((i) =>
        (i.payments || []).map((p) => ({
          ...p,
          invoice: { id: i.id, year: i.year, month: i.month },
        })),
      )
      .filter((p) => {
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      })
      .sort((a, b) => Date.parse(b.paidAt) - Date.parse(a.paidAt));
  }
  return {
    title: "Payment history",
    back: owner,
    nav: owner ? "profile" : "history",
    content:
      heading(
        owner ? ctx.snapshot.property?.name : "RENT, TAKEN CARE OF",
        "Payment history",
        "",
      ) +
      (owner ? periodControl(ctx.snapshot.period) : "") +
      `<div class="list">${payments.length ? payments.map((p) => paymentRow(p, owner, ctx.snapshot.property?.timezone)).join("") : empty("No payments yet", owner ? "No recorded payments for this billing month." : "Your recorded payments and receipts will appear here.", { glyph: "wallet" })}</div>` +
      button("Refresh payments", {
        action: "reload",
        kind: "secondary block",
        glyph: "refresh",
      }),
  };
}

export async function manualPaymentScreen(ctx) {
  const { invoice, resident } = await loadInvoice(ctx);
  if (invoice.remainingPaise <= 0 || invoice.status !== "DUE")
    throw new Error(
      "This invoice cannot accept a manual payment. Refresh its current status first.",
    );
  return {
    title: "Record payment",
    back: true,
    nav: false,
    guardForm: true,
    financialMutation: true,
    content:
      heading(
        "PAYMENT RECEIVED",
        "Record payment",
        `${resident.name} · ${month(invoice.year, invoice.month)}`,
      ) +
      card(
        `<p class="eyebrow">Outstanding balance</p><div class="financial-amount">${money(invoice.remainingPaise)}</div>`,
      ) +
      notice(
        "Record only money you have already received. This action credits the invoice and creates a receipt.",
      ) +
      `<form data-form="manualPayment" novalidate><div class="card"><div class="form-error" role="alert"></div>${field("amount", "Amount received (₹)", { required: true, value: rupeesInput(invoice.remainingPaise), attrs: 'inputmode="decimal" autocomplete="off"' })}${field(
        "method",
        "Payment method",
        {
          value: "CASH",
          options: [
            ["CASH", "Cash"],
            ["BANK_TRANSFER", "Bank transfer"],
            ["OTHER", "Other"],
          ],
        },
      )}</div>${submitBar("Review payment")}</form>`,
    async submit(name, form) {
      if (name !== "manualPayment") return;
      const v = formValues(form);
      const amount = parseRupees(v.amount, {
        min: 0.01,
        max: invoice.remainingPaise / 100,
      });
      const confirmed = await ctx.confirm({
        title: "Record this payment?",
        message: `${money(Math.round(amount * 100))} received from ${resident.name} by ${v.method.toLowerCase().replace(/_/g, " ")}. This will credit their ${month(invoice.year, invoice.month)} invoice.`,
        confirmLabel: "Record payment",
      });
      if (!confirmed) return;
      await ctx.api(
        `/api/owner/invoices/${encodeURIComponent(invoice.id)}/manual-payment`,
        { method: "POST", body: { amount, method: v.method } },
      );
      ctx.markSaved();
      ctx.invalidate();
      ctx.toast(
        "Payment recorded. The receipt is available in payment history.",
      );
      return ctx.navigate("ownerPayments", {}, { replace: true });
    },
  };
}

export async function invoiceChargesScreen(ctx) {
  const { invoice, resident } = await loadInvoice(ctx);
  if (invoice.status !== "DUE")
    throw new Error("This invoice is locked. Only due invoices can be edited.");
  return {
    title: "Invoice charges",
    back: true,
    nav: false,
    guardForm: true,
    content:
      heading(
        "INVOICE ADJUSTMENTS",
        "Invoice adjustments",
        `${resident.name} · ${month(invoice.year, invoice.month)}`,
      ) +
      notice(
        "Base rent and historical snapshots stay protected. The server validates and recalculates this invoice.",
      ) +
      `<form data-form="charges" novalidate><div class="card"><div class="form-error" role="alert"></div>${[
        ["electricity", "Electricity (₹)", "electricityPaise"],
        ["lateFee", "Late fee (₹)", "lateFeePaise"],
        ["otherCharges", "Other charges (₹)", "otherChargesPaise"],
        ["discount", "Discount (₹)", "discountPaise"],
      ]
        .map(([name, label, key]) =>
          field(name, label, {
            required: true,
            value: rupeesInput(invoice[key]),
            attrs: 'inputmode="decimal"',
          }),
        )
        .join(
          "",
        )}${field("notes", "Adjustment note", { type: "textarea", attrs: 'maxlength="1000"' })}</div>${submitBar("Save charges")}</form>`,
    async submit(name, form) {
      if (name !== "charges") return;
      const v = formValues(form),
        body = {
          electricity: parseRupees(v.electricity),
          lateFee: parseRupees(v.lateFee),
          otherCharges: parseRupees(v.otherCharges),
          discount: parseRupees(v.discount),
          notes: v.notes.trim() || null,
        };
      await ctx.api(`/api/owner/invoices/${encodeURIComponent(invoice.id)}`, {
        method: "PATCH",
        body,
      });
      ctx.markSaved();
      ctx.invalidate();
      ctx.toast("Invoice charges updated.");
      return ctx.navigate(
        "invoice",
        { id: invoice.id, residentId: resident.id },
        { replace: true },
      );
    },
  };
}
