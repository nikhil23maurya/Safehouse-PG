-- New direct-owner evidence and independently payable electricity records.
-- No historical invoice, payment, account, credential or enum is rewritten.
CREATE TABLE "PgRentEvidence" (
 id TEXT PRIMARY KEY,"accountId" TEXT NOT NULL REFERENCES "PgAccount"(id) ON DELETE RESTRICT,
 "propertyId" TEXT NOT NULL REFERENCES "Property"(id) ON DELETE RESTRICT,purpose TEXT NOT NULL,
 data BYTEA NOT NULL,sha256 TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PgRentEvidence_accountId_propertyId_purpose_sha256_key" UNIQUE("accountId","propertyId",purpose,sha256),
 CHECK(purpose IN ('METER','PAYMENT')),CHECK(octet_length(data) BETWEEN 20 AND 524288),
 CHECK(width BETWEEN 1 AND 2048 AND height BETWEEN 1 AND 2048)
);
CREATE INDEX "PgRentEvidence_accountId_createdAt_idx" ON "PgRentEvidence"("accountId","createdAt");
CREATE TABLE "PgElectricityBill" (
 id TEXT PRIMARY KEY,"invoiceId" TEXT NOT NULL UNIQUE REFERENCES "RentInvoice"(id) ON DELETE RESTRICT,
 "propertyId" TEXT NOT NULL REFERENCES "Property"(id) ON DELETE RESTRICT,
 "studentId" TEXT NOT NULL REFERENCES "Student"(id) ON DELETE RESTRICT,
 "accountId" TEXT NOT NULL REFERENCES "PgAccount"(id) ON DELETE RESTRICT,
 "amountPaise" INTEGER NOT NULL,"meterEvidenceId" TEXT NOT NULL REFERENCES "PgRentEvidence"(id) ON DELETE RESTRICT,
 revision INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'DUE',"paidAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
 CHECK("amountPaise" BETWEEN 1 AND 10000000),CHECK(status IN ('DUE','PAID')),
 CHECK((status='PAID')=("paidAt" IS NOT NULL))
);
CREATE INDEX "PgElectricityBill_propertyId_status_idx" ON "PgElectricityBill"("propertyId",status);
CREATE TABLE "PgDirectTransfer" (
 id TEXT PRIMARY KEY,"accountId" TEXT NOT NULL REFERENCES "PgAccount"(id) ON DELETE RESTRICT,
 "propertyId" TEXT NOT NULL REFERENCES "Property"(id) ON DELETE RESTRICT,
 "studentId" TEXT NOT NULL REFERENCES "Student"(id) ON DELETE RESTRICT,
 "invoiceId" TEXT NOT NULL REFERENCES "RentInvoice"(id) ON DELETE RESTRICT,
 "billId" TEXT REFERENCES "PgElectricityBill"(id) ON DELETE RESTRICT,
 "rentClaimId" TEXT REFERENCES "PgDirectRentClaim"(id) ON DELETE RESTRICT,
 "requestKey" TEXT NOT NULL,"rentPaise" INTEGER NOT NULL,"electricityPaise" INTEGER NOT NULL,"amountPaise" INTEGER NOT NULL,
 "payeeAddress" TEXT NOT NULL,"payeeName" TEXT NOT NULL,"payeeRevision" INTEGER NOT NULL,reference TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'READY',"bankKey" TEXT UNIQUE,
 "rentPaymentId" TEXT UNIQUE REFERENCES "Payment"(id) ON DELETE RESTRICT,"receiptNumber" TEXT UNIQUE,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"confirmedAt" TIMESTAMP(3),
 CONSTRAINT "PgDirectTransfer_accountId_requestKey_key" UNIQUE("accountId","requestKey"),
 CHECK("rentPaise">=0 AND "electricityPaise">=0 AND "amountPaise">0 AND "amountPaise"::bigint="rentPaise"::bigint+"electricityPaise"::bigint),
 CHECK(("rentPaise">0)=("rentClaimId" IS NOT NULL)),CHECK(("electricityPaise">0)=("billId" IS NOT NULL)),
 CHECK(status IN ('READY','SUBMITTED','REJECTED','CONFIRMED','CANCELLED')),
 CHECK(status!='CONFIRMED' OR ("confirmedAt" IS NOT NULL AND "receiptNumber" IS NOT NULL AND "bankKey" IS NOT NULL AND ("rentPaise"=0 OR "rentPaymentId" IS NOT NULL)))
);
CREATE INDEX "PgDirectTransfer_propertyId_id_idx" ON "PgDirectTransfer"("propertyId",id);
CREATE INDEX "PgDirectTransfer_invoiceId_status_idx" ON "PgDirectTransfer"("invoiceId",status);
CREATE INDEX "PgDirectTransfer_billId_idx" ON "PgDirectTransfer"("billId");
CREATE UNIQUE INDEX "PgDirectTransfer_one_open_rent" ON "PgDirectTransfer"("invoiceId") WHERE "rentPaise">0 AND status IN ('READY','SUBMITTED','REJECTED');
CREATE UNIQUE INDEX "PgDirectTransfer_one_open_electricity" ON "PgDirectTransfer"("billId") WHERE "electricityPaise">0 AND status IN ('READY','SUBMITTED','REJECTED');
CREATE TABLE "PgTransferProof" (
 id TEXT PRIMARY KEY,"transferId" TEXT NOT NULL REFERENCES "PgDirectTransfer"(id) ON DELETE RESTRICT,
 "requestKey" TEXT NOT NULL,"evidenceId" TEXT NOT NULL REFERENCES "PgRentEvidence"(id) ON DELETE RESTRICT,
 "bankReference" TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',reason TEXT,
 "reviewerAccountId" TEXT REFERENCES "PgAccount"(id) ON DELETE RESTRICT,"reviewedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PgTransferProof_transferId_requestKey_key" UNIQUE("transferId","requestKey"),
 CHECK(status IN ('PENDING','APPROVED','REJECTED')),
 CHECK(status='PENDING' OR ("reviewedAt" IS NOT NULL AND "reviewerAccountId" IS NOT NULL))
);
CREATE INDEX "PgTransferProof_transferId_createdAt_idx" ON "PgTransferProof"("transferId","createdAt");
CREATE UNIQUE INDEX "PgTransferProof_one_pending" ON "PgTransferProof"("transferId") WHERE status='PENDING';
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['PgRentEvidence','PgElectricityBill','PgDirectTransfer','PgTransferProof'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
  IF EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON %I FROM anon',t); END IF;
  IF EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON %I FROM authenticated',t); END IF;
 END LOOP;
END $$;
