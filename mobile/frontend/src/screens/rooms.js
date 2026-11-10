import { icon } from "../components/icons.js";
import {
  esc,
  heading,
  section,
  card,
  button,
  badge,
  residentRow,
  search,
  filters,
  routeAttrs,
  detail,
  empty,
  notice,
} from "../components/ui.js";
import { field, formValues, submitBar } from "../components/forms.js";

export async function roomsScreen(ctx) {
  const { rooms } = await ctx.read("/api/owner/rooms");
  const { q = "", status = "ALL" } = ctx.params;
  const visible = rooms.filter(
    (r) =>
      r.number.toLowerCase().includes(q.toLowerCase()) &&
      (status === "ALL" || (status === "AVAILABLE" ? r.vacant > 0 : r.full)),
  );
  return {
    title: "Rooms",
    nav: "rooms",
    content:
      heading(
        ctx.snapshot.property?.name,
        "Rooms",
        `${rooms.length} rooms · ${rooms.reduce((total, r) => total + r.vacant, 0)} beds available`,
        button("Add", { route: "roomForm", glyph: "plus" }),
      ) +
      search(q, "Find a room") +
      filters(
        [
          ["ALL", "All rooms"],
          ["AVAILABLE", "Available"],
          ["FULL", "Full"],
        ],
        status,
      ) +
      `<div class="room-grid">${visible.length ? visible.map((r) => `<button class="room-card" ${routeAttrs("room", { id: r.id })}><span class="room-card-head"><span class="room-number"><span class="row-icon">${icon("rooms")}</span><span><strong>Room ${esc(r.number)}</strong><small>${r.capacity} bed${r.capacity === 1 ? "" : "s"}</small></span></span>${badge(r.full ? "Full" : "Available", r.full ? "neutral" : "blue")}</span><span class="bed-indicators" aria-hidden="true">${Array.from({ length: r.capacity }, (_, i) => `<span${i < r.occupied ? ' class="occupied"' : ""}></span>`).join("")}</span><span class="room-card-foot"><span>${r.occupied} occupied · ${r.vacant} available</span>${icon("chevron")}</span></button>`).join("") : empty("A little room to grow", q || status !== "ALL" ? "No rooms match these filters." : "Add a room to start assigning residents.", { glyph: "rooms", action: button("Add room", { route: "roomForm", glyph: "plus" }) })}</div>`,
    submit(name, form) {
      if (name === "search")
        return ctx.navigate(
          "rooms",
          { q: formValues(form).q.trim(), status },
          { replace: true },
        );
    },
    action(name, el) {
      if (name === "filter")
        return ctx.navigate(
          "rooms",
          { q, status: el.dataset.value },
          { replace: true },
        );
    },
  };
}

export async function roomScreen(ctx) {
  const [roomData, residentData] = await Promise.all([
    ctx.read("/api/owner/rooms"),
    ctx.read(`/api/owner/students?${ctx.periodQuery}&status=ACTIVE`),
  ]);
  const room = roomData.rooms.find((r) => r.id === ctx.params.id);
  if (!room)
    throw new Error("This room is unavailable. Refresh the rooms directory.");
  const residents = residentData.students.filter((s) => s.room?.id === room.id);
  return {
    title: "Room details",
    back: true,
    nav: "rooms",
    content:
      heading(
        "YOUR PROPERTY",
        `Room ${room.number}`,
        `${room.occupied} of ${room.capacity} beds occupied`,
        badge(
          room.full ? "Full" : `${room.vacant} available`,
          room.full ? "neutral" : "blue",
        ),
      ) +
      card(
        `<dl>${detail("Room number", room.number)}${detail("Capacity", `${room.capacity} beds`)}${detail("Occupied", room.occupied)}${detail("Available", room.vacant)}</dl>`,
      ) +
      `<div class="action-stack">${button("Edit room", { route: "roomForm", params: { id: room.id }, kind: "secondary", glyph: "edit" })}${!room.full ? button("Assign a resident", { route: "residentForm", params: { roomId: room.id }, kind: "primary", glyph: "plus" }) : ""}</div>` +
      section(
        "Residents in this room",
        `<div class="list">${residents.length ? residents.map(residentRow).join("") : empty("Ready for move-in", "There are no active residents assigned to this room.", { glyph: "bed" })}</div>`,
      ),
  };
}

export async function roomFormScreen(ctx) {
  const { rooms } = await ctx.read("/api/owner/rooms");
  const room = ctx.params.id ? rooms.find((r) => r.id === ctx.params.id) : null;
  if (ctx.params.id && !room)
    throw new Error("This room is no longer available.");
  return {
    title: room ? "Edit room" : "Add room",
    back: true,
    nav: false,
    guardForm: true,
    content:
      heading(
        ctx.snapshot.property?.name,
        room ? "Edit room" : "Add room",
        room
          ? `Update room ${room.number}.`
          : "",
      ) +
      `<form data-form="room" novalidate><div class="card"><div class="form-error" role="alert"></div>${field("number", "Room number", { value: room?.number || "", required: true, attrs: 'maxlength="30" autocomplete="off"', placeholder: "e.g. 203" })}${field("capacity", "Number of beds", { type: "number", value: room?.capacity || "", required: true, attrs: `min="${Math.max(1, room?.occupied || 0)}" max="50" step="1" inputmode="numeric"`, help: room ? `${room.occupied} beds are currently occupied. Capacity cannot be lower than occupancy.` : "Between 1 and 50 beds. Real occupancy is checked by the server." })}</div>${submitBar(room ? "Save room" : "Add room")}</form>`,
    async submit(name, form) {
      if (name !== "room") return;
      const v = formValues(form);
      const body = { number: v.number.trim(), capacity: Number(v.capacity) };
      const result = await ctx.api(
        `/api/owner/rooms${room ? `/${encodeURIComponent(room.id)}` : ""}`,
        { method: room ? "PATCH" : "POST", body },
      );
      ctx.markSaved();
      ctx.invalidate();
      ctx.toast(room ? "Room updated." : "Room added.");
      return ctx.navigate("room", { id: result.room.id }, { replace: true });
    },
  };
}
