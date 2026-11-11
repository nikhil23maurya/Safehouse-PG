-- New manual purchases cost INR 1; immutable historical INR 249 orders and
-- receipts remain valid. Retired recurring contracts and rent are unchanged.
-- Install the wider checks atomically, without updating or deleting any rows.
BEGIN;
ALTER TABLE "PgPlanOrder" ADD CONSTRAINT "PgPlanOrder_amount_current_and_historical_check"
  CHECK ("amountPaise" IN (100,24900) AND "currency" = 'INR' AND "taxPaise" >= 0 AND "taxPaise" <= "amountPaise");
ALTER TABLE "PgPlanOrder" DROP CONSTRAINT "PgPlanOrder_amount_check";
ALTER TABLE "PgPlanOrder" RENAME CONSTRAINT "PgPlanOrder_amount_current_and_historical_check" TO "PgPlanOrder_amount_check";

ALTER TABLE "PgPlanReceipt" ADD CONSTRAINT "PgPlanReceipt_amount_current_and_historical_check"
  CHECK ("amountPaise" IN (100,24900) AND "currency" = 'INR' AND "taxPaise" >= 0 AND "taxPaise" <= "amountPaise" AND "refundedPaise" >= 0 AND "refundedPaise" <= "amountPaise");
ALTER TABLE "PgPlanReceipt" DROP CONSTRAINT "PgPlanReceipt_amount_check";
ALTER TABLE "PgPlanReceipt" RENAME CONSTRAINT "PgPlanReceipt_amount_current_and_historical_check" TO "PgPlanReceipt_amount_check";
COMMIT;
