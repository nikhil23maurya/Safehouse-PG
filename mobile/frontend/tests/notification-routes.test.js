import test from "node:test";
import assert from "node:assert/strict";
import { notificationRoute } from "../src/core/notification-routes.js";

test("notification navigation preserves payment history and rejects arbitrary destinations", () => {
  assert.equal(notificationRoute("history", "STUDENT"), "history");
  assert.equal(notificationRoute("pay", "STUDENT"), "invoices");
  assert.equal(notificationRoute("history", "OWNER"), "notifications");
  for (const route of [
    "ownerHome",
    "https://example.test",
    "javascript:alert(1)",
    "../owner/dues",
  ])
    assert.equal(notificationRoute(route, "STUDENT"), "studentHome");
});
