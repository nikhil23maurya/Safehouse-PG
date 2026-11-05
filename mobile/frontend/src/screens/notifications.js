import { icon } from "../components/icons.js";
import {
  esc,
  heading,
  section,
  card,
  button,
  badge,
  date,
  month,
  notice,
  empty,
} from "../components/ui.js";
import {
  field,
  formValues,
  formSection,
  submitBar,
} from "../components/forms.js";

const audiences = [
  ["ALL", "All active residents"],
  ["PENDING", "Pending rent — selected month"],
  ["OVERDUE", "Overdue rent — selected month"],
  ["SELECTED", "Choose residents"],
];
const audienceLabel = (type) =>
  audiences.find(([value]) => value === type)?.[1] || type;

function deviceCard(ctx, config) {
  const native = ctx.native.has("requestNotificationPermission");
  const permission = native
    ? ctx.native.call("notificationPermissionStatus")
    : "unavailable";
  return card(
    `<div class="notification-permission"><span class="row-icon">${icon("bell")}</span><div><h2>${permission === "granted" ? "Notifications allowed" : "Keep up with your home"}</h2><p>${!config ? "Notification service status is temporarily unavailable." : !config.clientEnabled || !config.serverEnabled ? "Push notifications are currently unavailable for this property." : permission === "granted" ? "Device permission is enabled. Registration is checked when the app connects." : native ? "Allow notifications for rent updates and property announcements." : "Device push notifications are available in the Android app."}</p>${native && config?.clientEnabled && permission !== "granted" ? button("Allow notifications", { action: "enablePush", kind: "secondary", glyph: "bell" }) : ""}</div></div>`,
  );
}

export async function notificationsScreen(ctx) {
  const owner = ctx.snapshot.user.role === "OWNER";
  const [configResult, campaignResult] = await Promise.allSettled([
    ctx.read("/api/notifications/config"),
    owner
      ? ctx.read("/api/owner/notifications/campaigns")
      : Promise.resolve(null),
  ]);
  const config =
    configResult.status === "fulfilled" ? configResult.value : null;
  const data =
    campaignResult.status === "fulfilled" ? campaignResult.value : null;
  return {
    title: "Notifications",
    back: true,
    nav: "profile",
    content:
      heading(
        "STAY IN THE KNOW",
        owner ? "A thoughtful nudge." : "Updates from home.",
        owner
          ? "Reach the right residents at the right time."
          : "Rent updates and announcements, right on your phone.",
      ) +
      deviceCard(ctx, config) +
      (owner
        ? section(
            "Resident communication",
            button("Create notification", {
              route: "notificationForm",
              glyph: "plus",
              kind: "primary block",
              attrs: config?.serverEnabled ? "" : "disabled",
            }) +
              (!config?.serverEnabled
                ? notice(
                    "Sending is unavailable until the property’s push service is ready.",
                  )
                : ""),
          )
        : notice(
            "Property announcements and rent updates arrive as Android notifications. An in-app message archive is not currently available.",
          )) +
      (owner
        ? section(
            "Recent campaigns",
            !data
              ? notice(
                  "Campaign history is temporarily unavailable. Refresh to try again.",
                  "error",
                )
              : data.campaigns.length
                ? data.campaigns
                    .map((c) =>
                      card(
                        `<div class="campaign-head"><h3>${esc(c.title)}</h3>${badge(c.status, c.status === "ACTIVE" ? "blue" : "neutral")}</div><p class="campaign-message">${esc(c.body)}</p><p class="campaign-meta">${esc(audienceLabel(c.audienceType))}${c.financialYear && c.financialMonth ? ` · ${esc(month(c.financialYear, c.financialMonth))}` : ""}</p><p class="campaign-meta">${c.scheduleType === "IMMEDIATE" ? "Send now" : `${esc(c.startDate)} — ${esc(c.endDate)} · ${esc(c.scheduleTimes.join(" · "))} (${esc(c.timezone)})`}</p>${c.nextRunAt ? `<p class="campaign-meta">Next: ${esc(date(c.nextRunAt, c.timezone, true))}</p>` : ""}<p class="campaign-meta">${c.delivery.sent} accepted by push provider · ${c.delivery.failed} failed · ${c.delivery.skipped} skipped</p>${c.scheduleType === "SCHEDULED" && ["ACTIVE", "PAUSED"].includes(c.status) ? `<div class="campaign-actions">${button(c.status === "ACTIVE" ? "Pause" : "Resume", { action: "campaign", kind: "secondary", attrs: `data-id="${esc(c.id)}" data-operation="${c.status === "ACTIVE" ? "PAUSE" : "RESUME"}"` })}${button("Cancel", { action: "campaign", kind: "danger", attrs: `data-id="${esc(c.id)}" data-operation="CANCEL"` })}</div>` : ""}`,
                      ),
                    )
                    .join("")
                : empty(
                    "No campaigns yet",
                    "A well-timed message can make home run a little smoother.",
                    { glyph: "bell" },
                  ),
          )
        : "") +
      button("Refresh", {
        action: "reload",
        kind: "secondary block",
        glyph: "refresh",
      }),
    async action(name, el) {
      if (name === "enablePush") {
        await ctx.setupPush(true);
        return;
      }
      if (name === "campaign") {
        const action = el.dataset.operation;
        if (
          action === "CANCEL" &&
          !(await ctx.confirm({
            title: "Cancel this campaign?",
            message:
              "No further scheduled messages will be sent by this campaign.",
            confirmLabel: "Cancel campaign",
            danger: true,
          }))
        )
          return;
        await ctx.api(
          `/api/owner/notifications/campaigns/${encodeURIComponent(el.dataset.id)}`,
          { method: "PATCH", body: { action } },
        );
        ctx.invalidate();
        ctx.toast(
          action === "PAUSE"
            ? "Campaign paused."
            : action === "RESUME"
              ? "Campaign resumed."
              : "Campaign cancelled.",
        );
        return ctx.reload();
      }
    },
  };
}

export async function notificationFormScreen(ctx) {
  const [config, studentsData] = await Promise.all([
    ctx.read("/api/notifications/config"),
    ctx.read(`/api/owner/students?${ctx.periodQuery}&status=ACTIVE`),
  ]);
  const scheduled = ctx.params.mode === "schedule";
  const tz = ctx.snapshot.property?.timezone || "Asia/Kolkata";
  const localToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return {
    title: "Create notification",
    back: true,
    nav: false,
    guardForm: true,
    content:
      heading(
        ctx.snapshot.property?.name,
        "Send a little clarity.",
        `Rent audiences use ${month(ctx.snapshot.period.year, ctx.snapshot.period.month)}.`,
      ) +
      `<form data-form="notification" novalidate><div class="form-error" role="alert"></div>` +
      formSection(
        "01",
        "Who & what",
        "Choose your audience and write a clear message.",
        field("audienceType", "Audience", {
          value: "PENDING",
          options: audiences,
          attrs: "data-notification-audience",
        }) +
          `<div class="student-picker" data-audience-picker hidden>${studentsData.students.length ? studentsData.students.map((s) => `<label class="check-row"><input type="checkbox" name="selectedStudent" value="${esc(s.id)}"><span>${esc(s.name)}<small class="subtitle"> · ${esc(s.room?.number || "Unassigned")}</small></span></label>`).join("") : '<p class="subtitle">No active residents in this property.</p>'}</div>` +
          field("title", "Title", {
            required: true,
            value: "Rent reminder",
            attrs: 'minlength="2" maxlength="80" data-notification-preview',
          }) +
          field("body", "Message", {
            required: true,
            type: "textarea",
            value:
              "Hi {{name}}, your {{month}} rent of {{amount}} is pending. Please check your invoice in PGOne.",
            attrs: 'minlength="2" maxlength="240" data-notification-preview',
            help: "Supported variables: {{name}}, {{property}}, {{room}}, {{month}}, {{amount}}, {{due_date}}, {{days_overdue}}.",
          }) +
          `<div class="notification-preview"><small>${icon("bell")} Message preview · variables filled by server</small><strong data-preview-title>Rent reminder</strong><p data-preview-body>Hi {{name}}, your {{month}} rent of {{amount}} is pending. Please check your invoice in PGOne.</p></div>`,
      ) +
      formSection(
        "02",
        "When to send",
        `Schedules follow ${tz}.`,
        field("mode", "Timing", {
          value: scheduled ? "schedule" : "now",
          options: [
            ["now", "Send now"],
            ["schedule", "Schedule daily"],
          ],
          attrs: "data-notification-mode",
        }) +
          `<div data-schedule-fields ${scheduled ? "" : "hidden"}><div class="two-columns">${field("startDate", "Start date", { type: "date", value: localToday, attrs: `min="${localToday}" data-schedule-control ${scheduled ? "required" : "disabled"}` })}${field("endDate", "End date", { type: "date", value: localToday, attrs: `min="${localToday}" data-schedule-control ${scheduled ? "required" : "disabled"}` })}</div>${field(
            "frequency",
            "Times per day",
            {
              value: "1",
              options: [
                ["1", "Once"],
                ["2", "Twice"],
                ["3", "Three times"],
              ],
              attrs: `data-notification-frequency data-schedule-control ${scheduled ? "" : "disabled"}`,
            },
          )}${[1, 2, 3].map((num, index) => `<div data-time-field="${num}" ${num === 1 ? "" : "hidden"}>${field(`time${num}`, `Time ${num}`, { type: "time", value: ["10:00", "18:00", "20:00"][index], attrs: `min="08:00" max="22:00" data-schedule-time="${num}" ${scheduled && num === 1 ? "required" : "disabled"}` })}</div>`).join("")}<p class="field-help">Up to 3 sends per day, between 08:00 and 22:00. Campaigns may run for up to 30 days. The server rechecks rent audiences at each send.</p></div>`,
      ) +
      (!config.serverEnabled
        ? notice(
            "The push service is unavailable. Your message cannot be sent yet.",
            "error",
          )
        : "") +
      submitBar("Review notification") +
      "</form>",
    input(name, el, form) {
      if (el.hasAttribute("data-notification-preview")) {
        form.querySelector("[data-preview-title]").textContent =
          form.elements.namedItem("title").value;
        form.querySelector("[data-preview-body]").textContent =
          form.elements.namedItem("body").value;
      }
    },
    change(name, el, form) {
      const values = formValues(form);
      if (el.hasAttribute("data-notification-audience"))
        form.querySelector("[data-audience-picker]").hidden =
          values.audienceType !== "SELECTED";
      if (
        el.hasAttribute("data-notification-mode") ||
        el.hasAttribute("data-notification-frequency")
      ) {
        const isSchedule = values.mode === "schedule";
        form.querySelector("[data-schedule-fields]").hidden = !isSchedule;
        for (const control of form.querySelectorAll(
          "[data-schedule-control]",
        )) {
          control.disabled = !isSchedule;
          control.required = isSchedule;
        }
        const count = Number(form.elements.namedItem("frequency").value);
        for (const control of form.querySelectorAll("[data-schedule-time]")) {
          const enabled =
            isSchedule && Number(control.dataset.scheduleTime) <= count;
          control.disabled = !enabled;
          control.required = enabled;
          control.closest("[data-time-field]").hidden =
            Number(control.dataset.scheduleTime) > count;
        }
      }
    },
    async submit(name, form) {
      if (name !== "notification") return;
      if (!config.serverEnabled)
        throw new Error(
          "Push notifications are currently unavailable for this property.",
        );
      const v = formValues(form);
      const selectedStudentIds = [
        ...form.querySelectorAll('[name="selectedStudent"]:checked'),
      ].map((el) => el.value);
      if (v.audienceType === "SELECTED" && !selectedStudentIds.length)
        throw new Error("Choose at least one resident.");
      const body = {
        title: v.title.trim(),
        body: v.body.trim(),
        audienceType: v.audienceType,
        selectedStudentIds,
        financialYear: ctx.snapshot.period.year,
        financialMonth: ctx.snapshot.period.month,
      };
      if (v.mode === "schedule") {
        if (
          v.endDate < v.startDate ||
          (Date.parse(v.endDate) - Date.parse(v.startDate)) / 86400000 > 29
        )
          throw new Error("Choose a date range of up to 30 days.");
        Object.assign(body, {
          startDate: v.startDate,
          endDate: v.endDate,
          scheduleTimes: Array.from(
            { length: Number(v.frequency) },
            (_, i) => v[`time${i + 1}`],
          ),
        });
        if (new Set(body.scheduleTimes).size !== body.scheduleTimes.length)
          throw new Error("Choose different send times.");
      }
      if (
        !(await ctx.confirm({
          title:
            v.mode === "schedule"
              ? "Schedule this campaign?"
              : "Send this notification?",
          message: `${body.title} · ${audienceLabel(body.audienceType)}${v.mode === "schedule" ? ` · ${v.startDate} to ${v.endDate}` : ""}`,
          confirmLabel: v.mode === "schedule" ? "Schedule" : "Send now",
        }))
      )
        return;
      const result = await ctx.api(
        v.mode === "schedule"
          ? "/api/owner/notifications/campaigns"
          : "/api/owner/notifications/send-now",
        { method: "POST", body },
      );
      ctx.markSaved();
      ctx.invalidate();
      ctx.toast(
        v.mode === "schedule"
          ? "Campaign scheduled."
          : `${result.sent} accepted by the push provider${result.failed ? `; ${result.failed} failed` : ""}.`,
      );
      return ctx.navigate("notifications", {}, { replace: true });
    },
  };
}
