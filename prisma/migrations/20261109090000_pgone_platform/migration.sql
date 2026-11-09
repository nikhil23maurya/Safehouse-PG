-- AlterTable
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL,
ALTER COLUMN "passwordHash" DROP NOT NULL;

-- CreateTable
CREATE TABLE "PgAccount" (
    "id" TEXT NOT NULL,
    "firebaseUid" TEXT,
    "phoneE164" TEXT,
    "legacyUserId" TEXT,
    "fullName" TEXT NOT NULL DEFAULT '',
    "email" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "setupIntent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PgAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PgOrganisation" (
    "id" TEXT NOT NULL,
    "ownerAccountId" TEXT NOT NULL,
    "legacyOwnerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legacyAccess" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PgOrganisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PgPropertySetup" (
    "propertyId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT '',
    "approximateRooms" INTEGER,
    "creationKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PgPropertySetup_pkey" PRIMARY KEY ("propertyId")
);

-- CreateTable
CREATE TABLE "PgMembership" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "actorUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PgMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PgInvitation" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "studentId" TEXT,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tokenHash" TEXT NOT NULL,
    "createdByAccountId" TEXT NOT NULL,
    "acceptedByAccountId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PgInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PgSubscription" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'RAZORPAY',
    "providerSubscriptionId" TEXT,
    "creationReference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "amountPaise" INTEGER NOT NULL DEFAULT 24900,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PgSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PgBillingPayment" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "providerInvoiceId" TEXT NOT NULL,
    "providerPaymentId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "taxPaise" INTEGER NOT NULL,
    "refundedPaise" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PgBillingPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PgProviderEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PgProviderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PgMerchantAccount" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'CASHFREE_EMBEDDED',
    "providerAccountRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "bankReference" TEXT,
    "bankLast4" TEXT,
    "bankVerificationStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "requirements" JSONB,
    "verifiedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PgMerchantAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PgAudit" (
    "id" TEXT NOT NULL,
    "actorAccountId" TEXT,
    "organisationId" TEXT,
    "action" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PgAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PgAccount_firebaseUid_key" ON "PgAccount"("firebaseUid");

-- CreateIndex
CREATE UNIQUE INDEX "PgAccount_phoneE164_key" ON "PgAccount"("phoneE164");

-- CreateIndex
CREATE UNIQUE INDEX "PgAccount_legacyUserId_key" ON "PgAccount"("legacyUserId");

-- CreateIndex
CREATE UNIQUE INDEX "PgOrganisation_legacyOwnerId_key" ON "PgOrganisation"("legacyOwnerId");

-- CreateIndex
CREATE INDEX "PgOrganisation_ownerAccountId_idx" ON "PgOrganisation"("ownerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "PgPropertySetup_creationKey_key" ON "PgPropertySetup"("creationKey");

-- CreateIndex
CREATE INDEX "PgPropertySetup_organisationId_idx" ON "PgPropertySetup"("organisationId");

-- CreateIndex
CREATE INDEX "PgMembership_organisationId_status_idx" ON "PgMembership"("organisationId", "status");

-- CreateIndex
CREATE INDEX "PgMembership_actorUserId_idx" ON "PgMembership"("actorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "PgMembership_accountId_propertyId_role_key" ON "PgMembership"("accountId", "propertyId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "PgInvitation_tokenHash_key" ON "PgInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "PgInvitation_organisationId_status_idx" ON "PgInvitation"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PgSubscription_organisationId_key" ON "PgSubscription"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "PgSubscription_providerSubscriptionId_key" ON "PgSubscription"("providerSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "PgSubscription_creationReference_key" ON "PgSubscription"("creationReference");

-- CreateIndex
CREATE UNIQUE INDEX "PgBillingPayment_providerInvoiceId_key" ON "PgBillingPayment"("providerInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PgBillingPayment_providerPaymentId_key" ON "PgBillingPayment"("providerPaymentId");

-- CreateIndex
CREATE INDEX "PgBillingPayment_subscriptionId_periodEnd_idx" ON "PgBillingPayment"("subscriptionId", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "PgProviderEvent_provider_eventKey_key" ON "PgProviderEvent"("provider", "eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "PgMerchantAccount_organisationId_key" ON "PgMerchantAccount"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "PgMerchantAccount_providerAccountRef_key" ON "PgMerchantAccount"("providerAccountRef");

-- CreateIndex

-- CreateIndex
CREATE INDEX "PgAudit_organisationId_createdAt_idx" ON "PgAudit"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "PgAudit_actorAccountId_createdAt_idx" ON "PgAudit"("actorAccountId", "createdAt");

-- AddForeignKey
ALTER TABLE "PgAccount" ADD CONSTRAINT "PgAccount_legacyUserId_fkey" FOREIGN KEY ("legacyUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PgOrganisation" ADD CONSTRAINT "PgOrganisation_ownerAccountId_fkey" FOREIGN KEY ("ownerAccountId") REFERENCES "PgAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PgOrganisation" ADD CONSTRAINT "PgOrganisation_legacyOwnerId_fkey" FOREIGN KEY ("legacyOwnerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PgPropertySetup" ADD CONSTRAINT "PgPropertySetup_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PgPropertySetup" ADD CONSTRAINT "PgPropertySetup_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "PgOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PgMembership" ADD CONSTRAINT "PgMembership_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PgAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PgMembership" ADD CONSTRAINT "PgMembership_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "PgOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PgMembership" ADD CONSTRAINT "PgMembership_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PgMembership" ADD CONSTRAINT "PgMembership_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PgInvitation" ADD CONSTRAINT "PgInvitation_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "PgOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PgInvitation" ADD CONSTRAINT "PgInvitation_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PgSubscription" ADD CONSTRAINT "PgSubscription_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "PgOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PgBillingPayment" ADD CONSTRAINT "PgBillingPayment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "PgSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PgMerchantAccount" ADD CONSTRAINT "PgMerchantAccount_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "PgOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey

-- New-table invariants only; existing financial data is untouched.
ALTER TABLE "PgAccount" ADD CONSTRAINT "PgAccount_phone_check" CHECK ("phoneE164" IS NULL OR "phoneE164" ~ '^\+91[6-9][0-9]{9}$');
ALTER TABLE "PgMembership" ADD CONSTRAINT "PgMembership_role_check" CHECK ("role" IN ('OWNER','RESIDENT','STAFF'));
ALTER TABLE "PgMembership" ADD CONSTRAINT "PgMembership_actor_check" CHECK (("role" = 'STAFF' AND "actorUserId" IS NULL) OR ("role" IN ('OWNER','RESIDENT') AND "actorUserId" IS NOT NULL));
CREATE UNIQUE INDEX "PgMembership_one_active_resident_actor" ON "PgMembership" ("actorUserId") WHERE "role" = 'RESIDENT' AND "status" = 'ACTIVE';
ALTER TABLE "PgInvitation" ADD CONSTRAINT "PgInvitation_role_check" CHECK ("role" IN ('RESIDENT','STAFF'));
ALTER TABLE "PgSubscription" ADD CONSTRAINT "PgSubscription_price_check" CHECK ("amountPaise" = 24900 AND "currency" = 'INR');
ALTER TABLE "PgBillingPayment" ADD CONSTRAINT "PgBillingPayment_money_check" CHECK ("amountPaise" = 24900 AND "currency" = 'INR' AND "taxPaise" >= 0 AND "taxPaise" <= "amountPaise" AND "refundedPaise" >= 0 AND "refundedPaise" <= "amountPaise" AND "periodEnd" > "periodStart");
ALTER TABLE "PgPropertySetup" ADD CONSTRAINT "PgPropertySetup_room_check" CHECK ("approximateRooms" IS NULL OR "approximateRooms" > 0);
