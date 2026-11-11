-- Additive request/approval workflow. Existing memberships and financial rows
-- retain their identifiers, access, amounts, revisions and payment history.
CREATE TABLE "PgResidentRequest" (
 "id" TEXT PRIMARY KEY,"accountId" TEXT NOT NULL REFERENCES "PgAccount"(id) ON DELETE RESTRICT,
 "organisationId" TEXT NOT NULL REFERENCES "PgOrganisation"(id) ON DELETE RESTRICT,
 "propertyId" TEXT NOT NULL REFERENCES "Property"(id) ON DELETE RESTRICT,
 "fullName" TEXT NOT NULL,"mobile" TEXT,"status" TEXT NOT NULL DEFAULT 'PENDING',
 "membershipId" TEXT UNIQUE REFERENCES "PgMembership"(id) ON DELETE RESTRICT,
 "studentId" TEXT UNIQUE REFERENCES "Student"(id) ON DELETE RESTRICT,
 "setupHash" TEXT,"decidedAt" TIMESTAMP(3),"activatedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "PgResidentRequest_accountId_propertyId_key" UNIQUE ("accountId","propertyId"),
 CONSTRAINT "PgResidentRequest_status_check" CHECK (status IN ('PENDING','ACCEPTED','ACTIVE','REJECTED')),
 CONSTRAINT "PgResidentRequest_active_check" CHECK (status!='ACTIVE' OR ("membershipId" IS NOT NULL AND "studentId" IS NOT NULL AND "setupHash" IS NOT NULL AND "activatedAt" IS NOT NULL))
);
CREATE INDEX "PgResidentRequest_propertyId_status_createdAt_idx" ON "PgResidentRequest"("propertyId",status,"createdAt");
CREATE INDEX "PgResidentRequest_organisationId_status_idx" ON "PgResidentRequest"("organisationId",status);
ALTER TABLE "PgResidentRequest" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "PgResidentRequest" FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "PgResidentRequest" FROM anon; END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "PgResidentRequest" FROM authenticated; END IF;
END $$;
-- Keep prior unassigned residents visible for owner rent setup. This adds
-- request rows only; it does not revoke their existing membership.
INSERT INTO "PgResidentRequest" (id,"accountId","organisationId","propertyId","fullName",mobile,status,"membershipId","decidedAt","createdAt","updatedAt")
 SELECT 'legacy-request-'||m.id,m."accountId",m."organisationId",m."propertyId",a."fullName",a."contactPhone",'ACCEPTED',m.id,m."createdAt",m."createdAt",CURRENT_TIMESTAMP
 FROM "PgMembership" m JOIN "PgAccount" a ON a.id=m."accountId"
 WHERE m.role='RESIDENT' AND m.status='ACTIVE' AND m."actorUserId" IS NULL;
