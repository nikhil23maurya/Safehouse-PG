-- Direct-owner payment references never become provider captures or automatic credits.
CREATE TABLE "PgOwnerUpi" (
  "propertyId" TEXT NOT NULL PRIMARY KEY REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "ownerAccountId" TEXT NOT NULL REFERENCES "PgAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "upiAddress" TEXT NOT NULL, "payeeName" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true, "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "PgDirectRentClaim" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "propertyId" TEXT NOT NULL REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "invoiceId" TEXT NOT NULL REFERENCES "RentInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "studentId" TEXT NOT NULL REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "accountId" TEXT NOT NULL REFERENCES "PgAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "requestKey" TEXT NOT NULL,"payeeAddress" TEXT NOT NULL,"payeeName" TEXT NOT NULL,"payeeRevision" INTEGER NOT NULL,
  "amountPaise" INTEGER NOT NULL CHECK ("amountPaise" > 0), "reference" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING_OWNER_CONFIRMATION', "bankReference" TEXT,
  "confirmedPaymentId" TEXT REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"confirmedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "PgDirectRentClaim_reference_key" ON "PgDirectRentClaim"("reference");
CREATE UNIQUE INDEX "PgDirectRentClaim_confirmedPaymentId_key" ON "PgDirectRentClaim"("confirmedPaymentId");
CREATE UNIQUE INDEX "PgDirectRentClaim_accountId_requestKey_key" ON "PgDirectRentClaim"("accountId","requestKey");
CREATE INDEX "PgDirectRentClaim_propertyId_status_idx" ON "PgDirectRentClaim"("propertyId","status");
CREATE INDEX "PgDirectRentClaim_invoiceId_createdAt_idx" ON "PgDirectRentClaim"("invoiceId","createdAt");
ALTER TABLE "PgOwnerUpi" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PgDirectRentClaim" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "PgOwnerUpi", "PgDirectRentClaim" FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE "PgOwnerUpi", "PgDirectRentClaim" FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
