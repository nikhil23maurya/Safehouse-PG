-- Only onboarding bookkeeping; no financial or identity records are rewritten.
ALTER TABLE "PgMerchantAccount" ADD COLUMN "profileFingerprint" TEXT;
ALTER TABLE "PgMerchantAccount" ADD COLUMN "creationState" TEXT NOT NULL DEFAULT 'NOT_STARTED';
ALTER TABLE "PgMerchantAccount" ADD COLUMN "bankSubmissionFingerprint" TEXT;
ALTER TABLE "PgMerchantAccount" ADD COLUMN "providerEnvironment" TEXT;
