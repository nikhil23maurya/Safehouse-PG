-- Expand allowed current pricing while retaining every original INR1/INR249
-- order, receipt, tax, refund and paid calendar period. No row is rewritten.
BEGIN;
ALTER TABLE "PgPlanOrder" ADD CONSTRAINT "PgPlanOrder_price_159_and_history"
 CHECK ("amountPaise" IN (15900,100,24900) AND currency='INR' AND "taxPaise">=0 AND "taxPaise"<="amountPaise");
ALTER TABLE "PgPlanOrder" DROP CONSTRAINT "PgPlanOrder_amount_check";
ALTER TABLE "PgPlanOrder" RENAME CONSTRAINT "PgPlanOrder_price_159_and_history" TO "PgPlanOrder_amount_check";
ALTER TABLE "PgPlanOrder" ALTER COLUMN "amountPaise" SET DEFAULT 15900;
ALTER TABLE "PgPlanReceipt" ADD CONSTRAINT "PgPlanReceipt_price_159_and_history"
 CHECK ("amountPaise" IN (15900,100,24900) AND currency='INR' AND "taxPaise">=0 AND "taxPaise"<="amountPaise" AND "refundedPaise">=0 AND "refundedPaise"<="amountPaise");
ALTER TABLE "PgPlanReceipt" DROP CONSTRAINT "PgPlanReceipt_amount_check";
ALTER TABLE "PgPlanReceipt" RENAME CONSTRAINT "PgPlanReceipt_price_159_and_history" TO "PgPlanReceipt_amount_check";
COMMIT;
