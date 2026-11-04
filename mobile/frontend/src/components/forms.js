import { esc, button } from "./ui.js";
import { icon } from "./icons.js";

export function field(
  name,
  label,
  {
    type = "text",
    value = "",
    required = false,
    help = "",
    options,
    attrs = "",
    placeholder = "",
    wide = false,
  } = {},
) {
  const id = `field-${name}`;
  const common = `id="${id}" name="${name}" ${required ? "required" : ""} aria-labelledby="${id}-label" aria-describedby="${id}-help ${id}-error" ${attrs}`;
  let control;
  if (options)
    control = `<select ${common}>${options.map(([v, l, disabled]) => `<option value="${esc(v)}" ${String(v) === String(value) ? "selected" : ""} ${disabled ? "disabled" : ""}>${esc(l)}</option>`).join("")}</select>`;
  else if (type === "textarea")
    control = `<textarea ${common} placeholder="${esc(placeholder)}" rows="3">${esc(value)}</textarea>`;
  else
    control = `<input type="${type}" ${common} value="${esc(value)}" placeholder="${esc(placeholder)}">`;
  if (type === "password")
    control = `<div class="password-control">${control}<button type="button" class="icon-button" data-action="toggle-password" data-target="${id}" aria-label="Show password" aria-pressed="false">${icon("eye")}</button></div>`;
  return `<div class="field${wide ? " full-width" : ""}"><label for="${id}"><span id="${id}-label">${esc(label)}</span>${required ? '<span class="required" aria-hidden="true"> *</span>' : ""}</label>${control}<small id="${id}-help" class="field-help">${esc(help)}</small><small id="${id}-error" class="field-error" aria-live="polite"></small></div>`;
}
export function formSection(number, title, description, content, id) {
  return `<section class="form-section" id="${id || `section-${number}`}"><div class="form-section-heading"><span>${number}</span><div><h2>${esc(title)}</h2><p>${esc(description)}</p></div></div><div class="form-section-fields">${content}</div></section>`;
}
export const submitBar = (label, caption = "") =>
  `<div class="submit-bar">${caption ? `<small>${esc(caption)}</small>` : ""}${button(label, { type: "submit", glyph: "check" })}</div>`;
export function formValues(form) {
  return Object.fromEntries(new FormData(form));
}
export function clearErrors(form) {
  form
    .querySelectorAll("[aria-invalid]")
    .forEach((el) => el.removeAttribute("aria-invalid"));
  form.querySelectorAll(".field-error, .form-error").forEach((el) => {
    el.textContent = "";
  });
}
export function showFormError(form, error) {
  const fields = error.details?.fieldErrors;
  let first;
  if (fields)
    for (const [name, messages] of Object.entries(fields)) {
      const control = form.elements.namedItem(name);
      if (!control || !messages?.[0]) continue;
      control.setAttribute("aria-invalid", "true");
      const label = document.getElementById(`field-${name}-error`);
      if (label) label.textContent = messages[0];
      first ||= control;
    }
  const summary = form.querySelector(".form-error");
  if (summary) {
    summary.textContent = error.message;
    summary.hidden = false;
  }
  first?.focus();
}
export function validateForm(form) {
  clearErrors(form);
  let first;
  for (const control of form.elements) {
    if (!control.willValidate || control.checkValidity()) continue;
    control.setAttribute("aria-invalid", "true");
    const message = control.validity.valueMissing
      ? "This field is required."
      : control.validationMessage;
    const error = document.getElementById(`field-${control.name}-error`);
    if (error) error.textContent = message;
    first ||= control;
  }
  if (first) {
    first.focus();
    first.scrollIntoView({ block: "center", behavior: "auto" });
    return false;
  }
  return true;
}
