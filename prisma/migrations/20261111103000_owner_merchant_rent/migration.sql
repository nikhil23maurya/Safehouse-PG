BEGIN;
-- CreateTable
CREATE TABLE "PgOwnerAuthorization" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "current" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'KYC_PENDING',
    "accessCipher" TEXT,
    "refreshCipher" TEXT,
    "publicToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "refreshLeaseUntil" TIMESTAMP(3),
    "authorizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "accountActivated" BOOLEAN NOT NULL DEFAULT false,
    "productActivated" BOOLEAN NOT NULL DEFAULT false,
    "productId" TEXT,
    "paymentEnabled" BOOLEAN NOT NULL DEFAULT false,
    "bankStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "bankLast4" TEXT,
    "bankFingerprint" TEXT,
    "settlementReady" BOOLEAN NOT NULL DEFAULT false,
    "accountEventAt" TIMESTAMP(3),
    "productEventAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PgOwnerAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PgOwnerOAuthState" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STARTED',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PgOwnerOAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PgOwnerRentOrder" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "authorizationId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "providerOrderId" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "invoiceSnapshot" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATING',
    "open" BOOLEAN NOT NULL DEFAULT true,
    "lastErrorCode" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PgOwnerRentOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PgOwnerPaymentObservation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "providerPaymentId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PgOwnerPaymentObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PgOwnerRentApplication" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "providerPaymentId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "refundedPaise" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL DEFAULT 'CAPTURED',
    "paidAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PgOwnerRentApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PgOwnerRentRefund" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "providerRefundId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PgOwnerRentRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PgOwnerSettlement" (
    "id" TEXT NOT NULL,
    "authorizationId" TEXT NOT NULL,
    "providerSettlementId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "utr" TEXT,
    "settledAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PgOwnerSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PgOwnerSettlementItem" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "grossPaise" INTEGER NOT NULL,
    "netPaise" INTEGER NOT NULL,
    "feePaise" INTEGER NOT NULL,
    "taxPaise" INTEGER NOT NULL,

    CONSTRAINT "PgOwnerSettlementItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PgOwnerWebhookInbox" (
    "id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "PgOwnerWebhookInbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PgOwnerAuthorization_merchantId_current_idx" ON "PgOwnerAuthorization"("merchantId", "current");

-- CreateIndex
CREATE UNIQUE INDEX "PgOwnerAuthorization_mode_providerAccountId_key" ON "PgOwnerAuthorization"("mode", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "PgOwnerOAuthState_stateHash_key" ON "PgOwnerOAuthState"("stateHash");

-- CreateIndex
CREATE UNIQUE INDEX "PgOwnerRentOrder_reference_key" ON "PgOwnerRentOrder"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "PgOwnerRentOrder_providerOrderId_key" ON "PgOwnerRentOrder"("providerOrderId");

-- CreateIndex
CREATE INDEX "PgOwnerRentOrder_organisationId_createdAt_idx" ON "PgOwnerRentOrder"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "PgOwnerRentOrder_invoiceId_open_idx" ON "PgOwnerRentOrder"("invoiceId", "open");

-- CreateIndex
CREATE UNIQUE INDEX "PgOwnerRentOrder_accountId_requestKey_key" ON "PgOwnerRentOrder"("accountId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "PgOwnerPaymentObservation_providerPaymentId_key" ON "PgOwnerPaymentObservation"("providerPaymentId");

-- CreateIndex
CREATE INDEX "PgOwnerPaymentObservation_orderId_status_idx" ON "PgOwnerPaymentObservation"("orderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PgOwnerRentApplication_orderId_key" ON "PgOwnerRentApplication"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PgOwnerRentApplication_paymentId_key" ON "PgOwnerRentApplication"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PgOwnerRentApplication_providerPaymentId_key" ON "PgOwnerRentApplication"("providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PgOwnerRentRefund_providerRefundId_key" ON "PgOwnerRentRefund"("providerRefundId");

-- CreateIndex
CREATE UNIQUE INDEX "PgOwnerSettlement_authorizationId_providerSettlementId_key" ON "PgOwnerSettlement"("authorizationId", "providerSettlementId");

-- CreateIndex
CREATE UNIQUE INDEX "PgOwnerSettlementItem_settlementId_applicationId_key" ON "PgOwnerSettlementItem"("settlementId", "applicationId");

-- CreateIndex
CREATE INDEX "PgOwnerWebhookInbox_status_nextAttemptAt_idx" ON "PgOwnerWebhookInbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "PgOwnerWebhookInbox_mode_eventKey_key" ON "PgOwnerWebhookInbox"("mode", "eventKey");

-- AddForeignKey
ALTER TABLE "PgOwnerAuthorization" ADD CONSTRAINT "PgOwnerAuthorization_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "PgMerchantAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PgOwnerOAuthState" ADD CONSTRAINT "PgOwnerOAuthState_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "PgMerchantAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PgOwnerRentOrder" ADD CONSTRAINT "PgOwnerRentOrder_authorizationId_fkey" FOREIGN KEY ("authorizationId") REFERENCES "PgOwnerAuthorization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PgOwnerPaymentObservation" ADD CONSTRAINT "PgOwnerPaymentObservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PgOwnerRentOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PgOwnerRentApplication" ADD CONSTRAINT "PgOwnerRentApplication_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PgOwnerRentOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PgOwnerRentRefund" ADD CONSTRAINT "PgOwnerRentRefund_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "PgOwnerRentApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PgOwnerSettlement" ADD CONSTRAINT "PgOwnerSettlement_authorizationId_fkey" FOREIGN KEY ("authorizationId") REFERENCES "PgOwnerAuthorization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PgOwnerSettlementItem" ADD CONSTRAINT "PgOwnerSettlementItem_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "PgOwnerSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PgOwnerSettlementItem" ADD CONSTRAINT "PgOwnerSettlementItem_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "PgOwnerRentApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- New records only; no historical financial data is rewritten.
CREATE UNIQUE INDEX "PgOwnerAuthorization_current" ON "PgOwnerAuthorization" ("merchantId",mode) WHERE current;
CREATE UNIQUE INDEX "PgOwnerRentOrder_one_open_invoice" ON "PgOwnerRentOrder" ("invoiceId") WHERE open;
ALTER TABLE "PgOwnerAuthorization" ADD CONSTRAINT "PgOwnerAuthorization_mode" CHECK (mode IN ('test','live'));
ALTER TABLE "PgOwnerRentOrder" ADD CONSTRAINT "PgOwnerRentOrder_amount" CHECK ("amountPaise">=100 AND currency='INR');
ALTER TABLE "PgOwnerRentApplication" ADD CONSTRAINT "PgOwnerRentApplication_amount" CHECK ("amountPaise">0 AND "refundedPaise">=0 AND "refundedPaise"<="amountPaise" AND currency='INR');
ALTER TABLE "PgOwnerRentRefund" ADD CONSTRAINT "PgOwnerRentRefund_amount" CHECK ("amountPaise">0);
ALTER TABLE "PgOwnerRentOrder" ADD CONSTRAINT "PgOwnerRentOrder_invoice_fk" FOREIGN KEY ("invoiceId") REFERENCES "RentInvoice"(id) ON DELETE RESTRICT;
ALTER TABLE "PgOwnerRentOrder" ADD CONSTRAINT "PgOwnerRentOrder_property_fk" FOREIGN KEY ("propertyId") REFERENCES "Property"(id) ON DELETE RESTRICT;
ALTER TABLE "PgOwnerRentOrder" ADD CONSTRAINT "PgOwnerRentOrder_student_fk" FOREIGN KEY ("studentId") REFERENCES "Student"(id) ON DELETE RESTRICT;
ALTER TABLE "PgOwnerRentOrder" ADD CONSTRAINT "PgOwnerRentOrder_org_fk" FOREIGN KEY ("organisationId") REFERENCES "PgOrganisation"(id) ON DELETE RESTRICT;
ALTER TABLE "PgOwnerRentOrder" ADD CONSTRAINT "PgOwnerRentOrder_account_fk" FOREIGN KEY ("accountId") REFERENCES "PgAccount"(id) ON DELETE RESTRICT;
ALTER TABLE "PgOwnerRentApplication" ADD CONSTRAINT "PgOwnerRentApplication_payment_fk" FOREIGN KEY ("paymentId") REFERENCES "Payment"(id) ON DELETE RESTRICT;
ALTER TABLE "PgOwnerOAuthState" ADD CONSTRAINT "PgOwnerOAuthState_account_fk" FOREIGN KEY ("accountId") REFERENCES "PgAccount"(id) ON DELETE CASCADE;
ALTER TABLE "PgOwnerOAuthState" ADD CONSTRAINT "PgOwnerOAuthState_session_fk" FOREIGN KEY ("sessionId") REFERENCES "PgSession"(id) ON DELETE CASCADE;

-- Serialize payment-channel reservations on the existing invoice. Legacy
-- channels behave as before unless this new channel has reserved that invoice.
CREATE FUNCTION pgone_owner_rent_channel_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE invoice_key text; blocked boolean;
BEGIN
  invoice_key := NEW."invoiceId";
  PERFORM id FROM "RentInvoice" WHERE id=invoice_key FOR UPDATE;
  IF TG_TABLE_NAME='PgOwnerRentOrder' THEN
    IF TG_OP='UPDATE' AND (OLD."organisationId",OLD."propertyId",OLD."invoiceId",OLD."studentId",OLD."accountId",OLD."authorizationId",OLD."amountPaise",OLD.reference,OLD."invoiceSnapshot") IS DISTINCT FROM (NEW."organisationId",NEW."propertyId",NEW."invoiceId",NEW."studentId",NEW."accountId",NEW."authorizationId",NEW."amountPaise",NEW.reference,NEW."invoiceSnapshot") THEN
      RAISE EXCEPTION 'Owner rent financial identity is immutable' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM "PgOwnerAuthorization" a JOIN "PgMerchantAccount" m ON m.id=a."merchantId" JOIN "PgOrganisation" o ON o.id=m."organisationId" JOIN "Property" p ON p.id=NEW."propertyId" JOIN "RentInvoice" i ON i.id=NEW."invoiceId" WHERE a.id=NEW."authorizationId" AND o.id=NEW."organisationId" AND p."ownerId"=o."legacyOwnerId" AND i."propertyId"=p.id AND i."studentId"=NEW."studentId") THEN
      RAISE EXCEPTION 'Owner rent merchant/invoice scope mismatch' USING ERRCODE='23514';
    END IF;
    IF NEW.open AND (EXISTS(SELECT 1 FROM "PaymentAttempt" WHERE "invoiceId"=invoice_key AND status IN ('CREATED','VERIFIED')) OR EXISTS(SELECT 1 FROM "PgDirectRentClaim" WHERE "invoiceId"=invoice_key AND status='PENDING_OWNER_CONFIRMATION')) THEN
      RAISE EXCEPTION 'Reconcile the previous rent payment before starting another channel' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='Payment' THEN
    IF EXISTS(SELECT 1 FROM "PgOwnerRentOrder" WHERE "invoiceId"=invoice_key AND open AND (NEW.source<>'RAZORPAY' OR NEW."providerOrderId" IS NULL OR "providerOrderId" IS NULL OR NEW."providerOrderId" IS DISTINCT FROM "providerOrderId")) THEN
      RAISE EXCEPTION 'Owner merchant rent payment is unresolved; reconcile it before recording another payment' USING ERRCODE='23514';
    END IF;
  ELSIF (TG_TABLE_NAME='PaymentAttempt' AND NEW.status::text IN ('CREATED','VERIFIED')) OR (TG_TABLE_NAME='PgDirectRentClaim' AND NEW.status::text='PENDING_OWNER_CONFIRMATION') THEN
    IF EXISTS(SELECT 1 FROM "PgOwnerRentOrder" WHERE "invoiceId"=invoice_key AND open) THEN
      RAISE EXCEPTION 'Owner merchant rent payment is unresolved; do not start another channel' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION pgone_owner_rent_channel_guard() FROM PUBLIC;
CREATE TRIGGER pgone_owner_rent_channel BEFORE INSERT OR UPDATE ON "PgOwnerRentOrder" FOR EACH ROW EXECUTE FUNCTION pgone_owner_rent_channel_guard();
CREATE TRIGGER pgone_owner_rent_channel BEFORE INSERT OR UPDATE ON "PaymentAttempt" FOR EACH ROW EXECUTE FUNCTION pgone_owner_rent_channel_guard();
CREATE TRIGGER pgone_owner_rent_channel BEFORE INSERT OR UPDATE ON "PgDirectRentClaim" FOR EACH ROW EXECUTE FUNCTION pgone_owner_rent_channel_guard();
CREATE TRIGGER pgone_owner_rent_channel BEFORE INSERT ON "Payment" FOR EACH ROW EXECUTE FUNCTION pgone_owner_rent_channel_guard();

DO $$ DECLARE table_name text; role_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['PgOwnerAuthorization','PgOwnerOAuthState','PgOwnerRentOrder','PgOwnerRentApplication','PgOwnerRentRefund','PgOwnerSettlement','PgOwnerSettlementItem','PgOwnerWebhookInbox','PgOwnerPaymentObservation'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM PUBLIC',table_name);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM %I',table_name,role_name); END IF;
    END LOOP;
  END LOOP;
END $$;

COMMIT;
