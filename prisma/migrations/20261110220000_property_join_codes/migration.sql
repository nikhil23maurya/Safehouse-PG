-- Additive only. Existing accounts, memberships and financial records are preserved.
BEGIN;
CREATE TABLE "PgJoinCode" (
  "propertyId" TEXT PRIMARY KEY,
  "organisationId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL UNIQUE,
  "codeCipher" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdByAccountId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PgJoinCode_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PgJoinCode_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "PgOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PgJoinCode_createdByAccountId_fkey" FOREIGN KEY ("createdByAccountId") REFERENCES "PgAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "PgJoinCodeAttempt" (
  "accountId" TEXT PRIMARY KEY,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "resetAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PgJoinCodeAttempt_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PgAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
ALTER TABLE "PgJoinCode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PgJoinCodeAttempt" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "PgJoinCode", "PgJoinCodeAttempt" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON TABLE "PgJoinCode", "PgJoinCodeAttempt" FROM anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON TABLE "PgJoinCode", "PgJoinCodeAttempt" FROM authenticated;
  END IF;
END $$;
-- New PG-code members are ACTIVE but unassigned. Owner/staff invariants and
-- the unique active-resident actor index remain intact. No existing row changes.
-- The unchanged legacy financial bridge requires an active actor and Student.
ALTER TABLE "PgMembership" DROP CONSTRAINT "PgMembership_actor_check";
ALTER TABLE "PgMembership" ADD CONSTRAINT "PgMembership_actor_check" CHECK (
  ("role" = 'STAFF' AND "actorUserId" IS NULL)
  OR ("role" = 'OWNER' AND "actorUserId" IS NOT NULL)
  OR ("role" = 'RESIDENT' AND ("actorUserId" IS NOT NULL OR cardinality("permissions") = 0))
);
COMMIT;
