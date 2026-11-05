import test from "node:test";
import assert from "node:assert/strict";
import { date, paymentRow, invoiceCard } from "../src/components/ui.js";

test("financial history dates use the selected property timezone", () => {
  const instant = "2026-11-04T20:00:00Z";
  assert.match(date(instant, "America/New_York"), /^4 Nov/);
  assert.match(date(instant, "Asia/Kolkata"), /^5 Nov/);
  const row = paymentRow(
    {
      id: "fixture",
      paidAt: instant,
      source: "MANUAL",
      method: "CASH",
      receiptNumber: "TEST",
      amountPaise: 100,
    },
    false,
    "America/New_York",
  );
  assert.match(row, /4 Nov 2026/);
  assert.doesNotMatch(row, /5 Nov 2026/);
  assert.match(
    invoiceCard(
      {
        id: "invoice",
        year: 2026,
        month: 11,
        dueDate: instant,
        totalPaise: 100,
        status: "DUE",
      },
      false,
      undefined,
      "America/New_York",
    ),
    /4 Nov 2026/,
  );
});
