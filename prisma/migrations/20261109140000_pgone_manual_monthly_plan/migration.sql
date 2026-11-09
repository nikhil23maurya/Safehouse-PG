-- Additive: retain prior subscription and rent financial records unchanged.
CREATE TABLE "PgPlanOrder" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "receiptReference" TEXT NOT NULL,
  "providerOrderId" TEXT,
  "providerKeyId" TEXT NOT NULL,
  "amountPaise" INTEGER NOT NULL DEFAULT 24900,
  "taxPaise" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "status" TEXT NOT NULL DEFAULT 'CREATING',
  "open" BOOLEAN NOT NULL DEFAULT true,
  "signatureVerifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PgPlanOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PgPlanOrder_amount_check" CHECK ("amountPaise" = 24900 AND "currency" = 'INR' AND "taxPaise" >= 0 AND "taxPaise" <= "amountPaise")
);
CREATE UNIQUE INDEX "PgPlanOrder_receiptReference_key" ON "PgPlanOrder"("receiptReference");
CREATE UNIQUE INDEX "PgPlanOrder_providerOrderId_key" ON "PgPlanOrder"("providerOrderId");
CREATE UNIQUE INDEX "PgPlanOrder_id_organisationId_key" ON "PgPlanOrder"("id", "organisationId");
CREATE UNIQUE INDEX "PgPlanOrder_organisationId_requestKey_key" ON "PgPlanOrder"("organisationId", "requestKey");
CREATE INDEX "PgPlanOrder_organisationId_open_idx" ON "PgPlanOrder"("organisationId", "open");
CREATE UNIQUE INDEX "PgPlanOrder_one_open_per_org" ON "PgPlanOrder"("organisationId") WHERE "open" = true;
ALTER TABLE "PgPlanOrder" ADD CONSTRAINT "PgPlanOrder_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "PgOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PgPlanReceipt" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "providerPaymentId" TEXT NOT NULL,
  "receiptNumber" TEXT NOT NULL,
  "amountPaise" INTEGER NOT NULL,
  "taxPaise" INTEGER NOT NULL,
  "refundedPaise" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "status" TEXT NOT NULL DEFAULT 'CAPTURED',
  "paidAt" TIMESTAMP(3) NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "anchorDay" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PgPlanReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PgPlanReceipt_amount_check" CHECK ("amountPaise" = 24900 AND "currency" = 'INR' AND "taxPaise" >= 0 AND "taxPaise" <= "amountPaise" AND "refundedPaise" >= 0 AND "refundedPaise" <= "amountPaise"),
  CONSTRAINT "PgPlanReceipt_period_check" CHECK ("periodEnd" > "periodStart" AND "anchorDay" BETWEEN 1 AND 31)
);
CREATE UNIQUE INDEX "PgPlanReceipt_orderId_key" ON "PgPlanReceipt"("orderId");
CREATE UNIQUE INDEX "PgPlanReceipt_orderId_organisationId_key" ON "PgPlanReceipt"("orderId", "organisationId");
CREATE UNIQUE INDEX "PgPlanReceipt_providerPaymentId_key" ON "PgPlanReceipt"("providerPaymentId");
CREATE UNIQUE INDEX "PgPlanReceipt_receiptNumber_key" ON "PgPlanReceipt"("receiptNumber");
CREATE INDEX "PgPlanReceipt_organisationId_periodEnd_idx" ON "PgPlanReceipt"("organisationId", "periodEnd");
ALTER TABLE "PgPlanReceipt" ADD CONSTRAINT "PgPlanReceipt_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "PgOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PgPlanReceipt" ADD CONSTRAINT "PgPlanReceipt_orderId_organisationId_fkey" FOREIGN KEY ("orderId", "organisationId") REFERENCES "PgPlanOrder"("id", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;
