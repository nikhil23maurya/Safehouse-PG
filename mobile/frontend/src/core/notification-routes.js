// Notification intents may select only these role-appropriate destinations.
// Financial detail IDs and arbitrary URLs from an intent are never trusted.
export function notificationRoute(route, role) {
  if (role === "OWNER") return "notifications";
  if (route === "history") return "history";
  if (route === "invoices" || route === "pay") return "invoices";
  return "studentHome";
}
