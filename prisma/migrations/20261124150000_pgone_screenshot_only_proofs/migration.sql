BEGIN;
ALTER TABLE "PgTransferProof" ALTER COLUMN "bankReference" DROP NOT NULL;
ALTER TABLE "PgTransferProof" ADD CONSTRAINT "PgTransferProof_approved_bank_reference"
  CHECK (status <> 'APPROVED' OR "bankReference" IS NOT NULL);
COMMIT;
