-- SafeHouse financial context hardening
-- Keeps historical invoice snapshots immutable while giving rent changes an explicit effective month.
CREATE TABLE "RentRevision" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "effectiveYear" INTEGER NOT NULL,
    "effectiveMonth" INTEGER NOT NULL,
    "reason" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RentRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RentRevision_studentId_effectiveYear_effectiveMonth_key"
ON "RentRevision"("studentId", "effectiveYear", "effectiveMonth");

CREATE INDEX "RentRevision_propertyId_effectiveYear_effectiveMonth_idx"
ON "RentRevision"("propertyId", "effectiveYear", "effectiveMonth");

CREATE INDEX "RentRevision_studentId_effectiveYear_effectiveMonth_idx"
ON "RentRevision"("studentId", "effectiveYear", "effectiveMonth");

ALTER TABLE "RentRevision"
ADD CONSTRAINT "RentRevision_propertyId_fkey"
FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RentRevision"
ADD CONSTRAINT "RentRevision_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed one baseline revision for every existing resident so old accounts get deterministic rent history.
INSERT INTO "RentRevision" (
    "id", "propertyId", "studentId", "amountPaise", "effectiveYear", "effectiveMonth", "reason", "createdAt"
)
SELECT
    'legacy_' || md5(random()::text || clock_timestamp()::text || s."id"),
    s."propertyId",
    s."id",
    s."monthlyRentPaise",
    EXTRACT(YEAR FROM s."joiningDate")::INTEGER,
    EXTRACT(MONTH FROM s."joiningDate")::INTEGER,
    'MIGRATED_BASELINE',
    CURRENT_TIMESTAMP
FROM "Student" s
ON CONFLICT ("studentId", "effectiveYear", "effectiveMonth") DO NOTHING;
