import { icon } from "../components/icons.js";
import { money, parseRupees, rupeesInput } from "../domain/finance.js";
import {
  esc,
  heading,
  section,
  card,
  button,
  badge,
  residentRow,
  invoiceCard,
  paymentRow,
  search,
  filters,
  periodControl,
  detail,
  avatar,
  date,
  month,
  empty,
  notice,
} from "../components/ui.js";
import {
  field,
  formSection,
  formValues,
  submitBar,
} from "../components/forms.js";

export async function residentsScreen(ctx) {
  const { q = "", status = "ALL" } = ctx.params;
  const data = await ctx.read(
    `/api/owner/students?${ctx.periodQuery}&status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`,
  );
  return {
    title: "Residents",
    nav: "residents",
    content:
      heading(
        ctx.snapshot.property?.name,
        "Residents",
        `${data.students.length} resident${data.students.length === 1 ? "" : "s"} shown`,
        button("Requests", { route: "residentRequests", glyph: "users" }),
      ) +
      periodControl(ctx.snapshot.period) +
      search(q) +
      filters(
        [
          ["ALL", "Everyone"],
          ["ACTIVE", "Active"],
          ["PAID", "Paid"],
          ["PENDING", "Pending"],
          ["OVERDUE", "Overdue"],
        ],
        status,
      ) +
      `<div class="list">${data.students.length ? data.students.map(residentRow).join("") : empty(q ? "No matching residents" : "Make room for your first resident", q ? "Try a name, room or mobile number." : "Keep their room, rent and account details together.", { glyph: "users", action: button("Review requests", { route: "residentRequests", glyph: "users" }) })}</div>`,
    submit(name, form) {
      if (name === "search")
        return ctx.navigate(
          "residents",
          { q: formValues(form).q.trim(), status },
          { replace: true },
        );
    },
    action(name, el) {
      if (name === "filter")
        return ctx.navigate(
          "residents",
          { q, status: el.dataset.value },
          { replace: true },
        );
    },
  };
}

export async function residentScreen(ctx) {
  const data = await ctx.read(
    `/api/owner/students/${encodeURIComponent(ctx.params.id)}?${ctx.periodQuery}`,
  );
  const s = data.student;
  const current =
    data.periodInvoice ||
    s.invoices?.find(
      (i) =>
        i.year === ctx.snapshot.period.year &&
        i.month === ctx.snapshot.period.month,
    );
  const payments = (s.invoices || [])
    .flatMap((i) =>
      (i.payments || []).map((p) => ({
        ...p,
        invoice: { id: i.id, year: i.year, month: i.month },
      })),
    )
    .sort((a, b) => Date.parse(b.paidAt) - Date.parse(a.paidAt));
  return {
    title: "Resident details",
    back: true,
    nav: "residents",
    content:
      `<div class="resident-profile">${avatar(s.name, true)}<div><h1>${esc(s.name)}</h1><p>${esc(s.room?.number ? `Room ${s.room.number}${s.bedLabel ? ` · ${s.bedLabel}` : ""}` : "Room unassigned")}</p>${badge(s.status === "ACTIVE" ? "Active resident" : s.status === "MOVED_OUT" ? "Moved out" : "Inactive", s.status === "ACTIVE" ? "blue" : "neutral")}</div></div>` +
      button("Edit resident", {
        route: "residentEdit",
        params: { id: s.id },
        kind: "secondary block",
        glyph: "edit",
      }) +
      section(
        month(ctx.snapshot.period.year, ctx.snapshot.period.month),
        current
          ? invoiceCard(current, true, s.id, ctx.snapshot.property?.timezone)
          : card(
              empty(
                "No invoice in this period",
                "Choose a different month to review this resident’s rent.",
              ),
            ),
      ) +
      section(
        "Personal details",
        card(
          `<dl>${detail("Full name", s.name)}${detail("Email", s.email)}${detail("Mobile", s.mobile)}</dl>`,
        ),
      ) +
      section(
        "Residency & rent",
        card(
          `<dl>${detail("Room", s.room?.number || "Unassigned")}${detail("Bed", s.bedLabel || "Not assigned")}${detail("Joining date", date(s.joiningDate, "UTC"))}${detail("Configured monthly rent", money(s.monthlyRentPaise))}${detail("Security deposit", money(s.securityDepositPaise))}${detail("Rent due day", s.rentDueDay ? `Day ${s.rentDueDay}` : "—")}</dl>`,
        ),
      ) +
      (s.rentRevisions?.length
        ? section(
            "Rent revisions",
            card(
              `<dl>${s.rentRevisions.map((r) => detail(`From ${month(r.effectiveYear, r.effectiveMonth)}`, money(r.amountPaise))).join("")}</dl>`,
            ),
          )
        : "") +
      (s.notes
        ? section("Notes", card(`<p class="subtitle">${esc(s.notes)}</p>`))
        : "") +
      section(
        "Invoices",
        (s.invoices || [])
          .map((i) =>
            invoiceCard(i, true, s.id, ctx.snapshot.property?.timezone),
          )
          .join("") ||
          empty(
            "No invoices yet",
            "Issued invoices retain their historical amounts.",
          ),
      ) +
      section(
        "Payment history",
        `<div class="list">${payments.length ? payments.map((p) => paymentRow(p, false, ctx.snapshot.property?.timezone)).join("") : empty("No payments yet", "Confirmed payments and their receipts will appear here.", { glyph: "wallet" })}</div>`,
      ) +
      section("Account access",card(`<p class="subtitle">Residents request access with your PG code. Review their request before linking room and rent.</p>${button("Resident requests",{route:"residentRequests",kind:"secondary block",glyph:"users"})}`)),
  };
}

export async function residentFormScreen(ctx) {
  const id = ctx.params.id;
  if(!id)return ctx.navigate("residentRequests",{},{replace:true,force:true});
  const [roomData, residentData] = await Promise.all([
    ctx.read("/api/owner/rooms"),
    id
      ? ctx.read(
          `/api/owner/students/${encodeURIComponent(id)}?${ctx.periodQuery}`,
        )
      : Promise.resolve(null),
  ]);
  const s = residentData?.student;
  const roomOptions = [
    ["", "Assign later"],
    ...roomData.rooms.map((r) => [
      r.id,
      `Room ${r.number} · ${r.vacant} of ${r.capacity} beds available`,
      r.full && r.id !== s?.room?.id,
    ]),
  ];
  const sectionD=field("status", "Resident status", {
    value:s.status,options:[["ACTIVE","Active"],["INACTIVE","Inactive — account disabled"],["MOVED_OUT","Moved out — account disabled"]],
    help:"Inactive and moved-out residents lose account access. Existing invoices remain unchanged."
  });
  return {
    title: "Room and rent",
    back: true,
    nav: false,
    guardForm: true,
    content:
      heading(
        ctx.snapshot.property?.name,
        "Room and rent",
        id ? s.name : "",
      ) +
      `<nav class="form-steps" aria-label="Form sections">${[
        ["01", "Personal"],
        ["02", "Room"],
        ["03", "Rent"],
        ["04", "Account"],
      ]
        .map(
          ([num, label]) =>
            `<button data-action="scroll-section" data-target="section-${num}">${num} · ${label}</button>`,
        )
        .join(
          "",
        )}</nav><form data-form="resident" novalidate><div class="form-error" role="alert"></div>` +
      formSection(
        "01",
        "Personal information",
        "Who’s moving in?",
        field("fullName", "Full name", {
          required: true,
          value: s?.name || "",
          attrs:
            'autocomplete="name" minlength="2" maxlength="100" enterkeyhint="next"',
        }) +
          field("email", "Email address (optional)", {
            type: "email",
            value: s?.email || "",
            attrs:
              'autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false" enterkeyhint="next"',
          }) +
          field("mobile", "Mobile number", {
            required: true,
            type: "tel",
            value: s?.mobile || "",
            attrs:
              'autocomplete="tel" inputmode="tel" minlength="10" maxlength="20" enterkeyhint="next"',
          }),
      ) +
      formSection(
        "02",
        "Their space",
        "Find the right room and bed.",
        `<div class="room-search-inline">${field("roomSearch", "Find a room", { type: "search", placeholder: "Search by room number", attrs: 'data-room-search autocomplete="off"' })}</div>` +
          field("roomId", "Room", {
            value: s?.room?.id || ctx.params.roomId || "",
            options: roomOptions,
            help: "Room availability is checked again when you save.",
          }) +
          field("bedLabel", "Bed label", {
            value: s?.bedLabel || "",
            placeholder: "e.g. B1",
            attrs: 'maxlength="30"',
          }) +
          `<dl>${detail("Joined", date(s.joiningDate, "UTC"))}</dl>`,
      ) +
      formSection(
        "03",
        "Rent & deposit",
        `Billing context: ${month(ctx.snapshot.period.year, ctx.snapshot.period.month)}.`,
        field("monthlyRent", "Monthly rent (₹)", {
          required: true,
          value: s ? rupeesInput(s.monthlyRentPaise) : "",
          attrs: 'inputmode="decimal" autocomplete="off"',
          help: id
            ? "The effective month is confirmed when you save. Existing paid invoices are preserved."
            : "The monthly rent used to prepare this resident’s invoices.",
        }) +
          `<div class="two-columns">${field("securityDeposit", "Deposit (₹)", { required: true, value: s ? rupeesInput(s.securityDepositPaise) : "0", attrs: 'inputmode="decimal"' })}${field("rentDueDay", "Rent due day", { type: "number", required: true, value: s?.rentDueDay || 5, attrs: 'min="1" max="28" step="1" inputmode="numeric"' })}</div>`,
      ) +
      formSection(
        "04",
        "Account & status",
        "Control access with care.",
        sectionD +
          field("notes", "Notes", {
            type: "textarea",
            value: s?.notes || "",
            attrs: 'maxlength="1000"',
            help: "Optional. Keep notes relevant to the residency.",
          }),
      ) +
      submitBar(
        id ? "Save changes" : "Save changes",
        "Required fields are marked *",
      ) +
      "</form>",
    input(name, el, form) {
      if (el.hasAttribute("data-room-search")) {
        const query = el.value.trim().toLowerCase();
        for (const option of form.elements.namedItem("roomId").options)
          option.hidden =
            !!option.value && !option.textContent.toLowerCase().includes(query);
      }
    },
    async submit(name, form) {
      if (name !== "resident") return;
      const v = formValues(form);
      const body = {
        fullName: v.fullName.trim(),
        ...(v.email.trim()?{email:v.email.trim()}:{}),
        mobile: v.mobile.trim(),
        roomId: v.roomId || null,
        bedLabel: v.bedLabel.trim() || null,
        monthlyRent: parseRupees(v.monthlyRent, { min: 0.01, max: 1_000_000 }),
        securityDeposit: parseRupees(v.securityDeposit),
        rentDueDay: Number(v.rentDueDay),
        notes: v.notes.trim() || null,
        status:v.status,
      };
      if (id && body.status !== s.status && body.status !== "ACTIVE") {
        if (
          !(await ctx.confirm({
            title:
              body.status === "MOVED_OUT"
                ? "Mark as moved out?"
                : "Make resident inactive?",
            message: `${s.name} will lose account access. Existing invoices and payments are retained.`,
            confirmLabel: "Confirm change",
            danger: true,
          }))
        )
          return;
      }
      const data = await ctx.api(
        `/api/owner/students/${encodeURIComponent(id)}?${ctx.periodQuery}`,
        { method: "PATCH", body },
      );
      ctx.invalidate();
      ctx.markSaved();
      if (data.rentChange)
        await ctx.confirm({
          title: "Rent updated",
          message: `The new rent applies from ${month(data.rentChange.effectiveYear, data.rentChange.effectiveMonth)}. ${data.rentChange.appliedToSelectedInvoice ? "The selected invoice has been updated." : "The selected invoice keeps its existing rent."}`,
          confirmLabel: "Continue",
          onlyConfirm: true,
        });
      ctx.toast(
        "Resident updated.",
      );
      return ctx.navigate(
        "resident",
        { id: data.student.id },
        { replace: true },
      );
    },
  };
}
