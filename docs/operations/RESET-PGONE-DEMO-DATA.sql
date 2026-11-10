-- ONE-TIME reset explicitly requested by the app owner on 10 November 2026.
-- Target ONLY SafeHouse/PGOne Supabase project izoersbdmtnrzztgrkes.
-- No backup requested. Never add this file to startup, prebuild or migrations.
-- Preserve schema, constraints, RLS, grants and _prisma_migrations.
-- Deliberately NO CASCADE: an unexpected referencing table aborts the transaction.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
  IF to_regclass('public."PgAccount"') IS NULL OR to_regclass('public."PgPlanOrder"') IS NULL
    OR to_regclass('public."PgDirectRentClaim"') IS NULL OR to_regclass('public."RentInvoice"') IS NULL THEN
    RAISE EXCEPTION 'Not the expected PGOne schema; reset aborted';
  END IF;
END $$;
TRUNCATE TABLE
  public."User",
  public."Property",
  public."PgAccount",
  public."PgOrganisation",
  public."PgPropertySetup",
  public."PgMembership",
  public."PgInvitation",
  public."PgSubscription",
  public."PgBillingPayment",
  public."PgProviderEvent",
  public."PgPlanOrder",
  public."PgPlanReceipt",
  public."PgMerchantAccount",
  public."PgAudit",
  public."Room",
  public."Student",
  public."RentRevision",
  public."RentInvoice",
  public."PaymentAttempt",
  public."Payment",
  public."DeviceRegistration",
  public."NotificationCampaign",
  public."NotificationDelivery",
  public."AuditLog",
  public."PgSession",
  public."PgEmailAction",
  public."PgOwnerUpi",
  public."PgDirectRentClaim"
RESTART IDENTITY;
COMMIT;
-- Verify all application rows are gone; migration history remains.
SELECT (SELECT count(*) FROM public."PgAccount") AS accounts,
       (SELECT count(*) FROM public."User") AS actors,
       (SELECT count(*) FROM public."Property") AS properties,
       (SELECT count(*) FROM public."Payment") AS payments,
       (SELECT count(*) FROM public."PgPlanOrder") AS plan_orders,
       (SELECT count(*) FROM public."PgSession") AS sessions,
       (SELECT count(*) FROM public._prisma_migrations) AS migrations_preserved;
