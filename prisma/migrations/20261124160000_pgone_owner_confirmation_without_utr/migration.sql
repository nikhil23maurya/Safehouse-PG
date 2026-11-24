-- A screenshot and explicit owner bank check may confirm a direct payment.
-- Preserve every historical reference. Existing reviewedAt/reviewer, receipt,
-- allocation, unique bankKey and proof-state constraints remain in force.
ALTER TABLE "PgTransferProof" DROP CONSTRAINT "PgTransferProof_approved_bank_reference";
