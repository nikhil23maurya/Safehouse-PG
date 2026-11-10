-- Additive migration: never reassign historical email claims or financial actors.
ALTER TABLE "PgAccount" ADD COLUMN "credentialEmail" TEXT, ADD COLUMN "contactPhone" TEXT,
  ADD COLUMN "passwordHash" TEXT,
  ADD COLUMN "passwordChangeRequired" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "PgAccount_credentialEmail_key" ON "PgAccount"("credentialEmail");
ALTER TABLE "PgInvitation" ALTER COLUMN "phoneE164" DROP NOT NULL;
ALTER TABLE "PgInvitation" ADD COLUMN "email" TEXT;

CREATE TABLE "PgSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accountId" TEXT NOT NULL REFERENCES "PgAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "refreshHash" TEXT NOT NULL,
  "upgradeHash" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "PgSession_refreshHash_key" ON "PgSession"("refreshHash");
CREATE UNIQUE INDEX "PgSession_upgradeHash_key" ON "PgSession"("upgradeHash");
CREATE INDEX "PgSession_accountId_revokedAt_idx" ON "PgSession"("accountId", "revokedAt");

CREATE TABLE "PgEmailAction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accountId" TEXT NOT NULL REFERENCES "PgAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "email" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "passwordHash" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "PgEmailAction_tokenHash_key" ON "PgEmailAction"("tokenHash");
CREATE INDEX "PgEmailAction_accountId_purpose_createdAt_idx" ON "PgEmailAction"("accountId", "purpose", "createdAt");

ALTER TABLE "PgSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PgEmailAction" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "PgSession", "PgEmailAction" FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE "PgSession", "PgEmailAction" FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
