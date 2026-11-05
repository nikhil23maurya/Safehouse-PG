import { icon } from "../components/icons.js";
import { money } from "../domain/finance.js";
import {
  esc,
  heading,
  section,
  card,
  button,
  detail,
  avatar,
  date,
  routeAttrs,
  empty,
  badge,
} from "../components/ui.js";
import { field, formValues, submitBar } from "../components/forms.js";

function menu(label, glyph, route, params = {}) {
  return `<button class="menu-item" ${routeAttrs(route, params)}>${icon(glyph)}<span>${esc(label)}</span>${icon("chevron")}</button>`;
}

export function profileScreen(ctx) {
  const { user, property, student } = ctx.snapshot;
  const owner = user.role === "OWNER";
  return {
    title: "Your account",
    nav: "profile",
    content:
      heading("YOUR PGONE", "A place for the details.") +
      `<div class="resident-profile">${avatar(user.fullName, true)}<div><h1>${esc(user.fullName)}</h1><p>${esc(user.email)}</p>${badge(owner ? "Property owner" : "Resident", "blue")}</div></div>` +
      (property
        ? card(
            `<div class="residency-head"><span class="row-icon">${icon("building")}</span><div><h2>${esc(property.name)}</h2><p>${esc(owner ? property.timezone : student?.room?.number ? `Room ${student.room.number}${student.bedLabel ? ` · ${student.bedLabel}` : ""}` : "Room unassigned")}</p></div></div>`,
          )
        : "") +
      (!owner && student
        ? section(
            "Residency",
            card(
              `<dl>${detail("Mobile", student.mobile)}${detail("Joined", date(student.joiningDate, "UTC"))}${detail("Monthly rent", money(student.monthlyRentPaise))}${detail("Security deposit", money(student.securityDepositPaise))}${detail("Rent due day", student.rentDueDay ? `Day ${student.rentDueDay}` : "—")}</dl>`,
            ),
          )
        : "") +
      section(
        "Manage",
        `<div class="list menu-list">${owner ? menu("Your properties", "building", "properties") + menu("Property settings", "rooms", "propertyForm", { edit: true }) + menu("Payment history", "wallet", "ownerPayments") : menu("Your invoices", "invoice", "invoices") + menu("Payment history", "wallet", "history")}${menu("Notifications", "bell", "notifications")}${menu("Change password", "key", "password")}</div>`,
      ) +
      `<div class="action-stack">${button("Sign out", { action: "logout", kind: "secondary", glyph: "logout" })}</div><p class="context-footnote">PGOne 5.0 · Your PG, under control.</p>`,
  };
}

export async function propertiesScreen(ctx) {
  const { properties } = await ctx.read("/api/owner/properties");
  return {
    title: "Your properties",
    back: true,
    nav: "profile",
    content:
      heading(
        "YOUR PORTFOLIO",
        "Every home, together.",
        "Choose the property you want to manage.",
      ) +
      (properties.length
        ? properties
            .map(
              (p) =>
                `<button class="property-card${p.id === ctx.snapshot.property?.id ? " active" : ""}" data-action="selectProperty" data-id="${esc(p.id)}"><span class="row-icon">${icon("building")}</span><span class="row-body"><strong>${esc(p.name)}</strong><small>${esc(p.timezone)}</small></span>${p.id === ctx.snapshot.property?.id ? badge("Current", "blue") : icon("chevron")}</button>`,
            )
            .join("")
        : empty(
            "Your first property",
            "Create a property before adding rooms or residents.",
            { glyph: "building" },
          )) +
      `<div class="action-stack">${button("Add a property", { route: "propertyForm", glyph: "plus" })}</div>`,
    action(name, el) {
      if (name === "selectProperty") {
        const p = properties.find((p) => p.id === el.dataset.id);
        if (p) return ctx.selectProperty(p, properties);
      }
    },
  };
}

export function propertyFormScreen(ctx) {
  const editing = !!ctx.params.edit,
    property = editing ? ctx.snapshot.property : null;
  if (editing && !property) throw new Error("Select a property first.");
  return {
    title: editing ? "Property settings" : "Add property",
    back: true,
    nav: false,
    guardForm: true,
    content:
      heading(
        "YOUR PROPERTY",
        editing ? "A few home details." : "A new home to manage.",
      ) +
      `<form data-form="property" novalidate><div class="card"><div class="form-error" role="alert"></div>${field("name", "Property name", { required: true, value: property?.name || "", attrs: 'minlength="2" maxlength="120" autocomplete="organization"' })}${field("timezone", "Timezone", { required: true, value: property?.timezone || "Asia/Kolkata", help: "Used for billing periods and notification schedules.", attrs: 'minlength="3" maxlength="80" autocapitalize="none" spellcheck="false"' })}</div>${submitBar(editing ? "Save property" : "Create property")}</form>`,
    async submit(name, form) {
      if (name !== "property") return;
      const v = formValues(form);
      try {
        new Intl.DateTimeFormat("en-IN", {
          timeZone: v.timezone.trim(),
        }).format();
      } catch {
        throw new Error("Enter a valid timezone, such as Asia/Kolkata.");
      }
      const result = await ctx.api(
        editing ? "/api/owner/property" : "/api/owner/properties",
        {
          method: editing ? "PATCH" : "POST",
          body: { name: v.name.trim(), timezone: v.timezone.trim() },
        },
      );
      const fresh = await ctx.api("/api/owner/properties");
      const confirmed = fresh.properties?.find(
        (p) => p.id === result.property?.id,
      );
      if (!confirmed)
        throw new Error(
          "The property was saved but could not be verified. Refresh your properties before trying again.",
        );
      ctx.markSaved();
      ctx.invalidate();
      ctx.toast(editing ? "Property updated." : "Property created.");
      return ctx.selectProperty(confirmed, fresh.properties);
    },
  };
}
