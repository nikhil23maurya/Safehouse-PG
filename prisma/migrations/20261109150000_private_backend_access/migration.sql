-- Approved backend-only database permissions.
-- App tables are owned by postgres; the backend/migration owner retains access.
-- No data, columns, financial amounts, ownership rows or application auth code change.
-- RLS is not forced on the owner. No public Data API policies are introduced.
DO $private_backend$
DECLARE
  table_name text;
  client_role text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['User', 'Property', 'PgAccount', 'PgOrganisation', 'PgPropertySetup', 'PgMembership', 'PgInvitation', 'PgSubscription', 'PgBillingPayment', 'PgProviderEvent', 'PgPlanOrder', 'PgPlanReceipt', 'PgMerchantAccount', 'PgAudit', 'Room', 'Student', 'RentRevision', 'RentInvoice', 'PaymentAttempt', 'Payment', 'DeviceRegistration', 'NotificationCampaign', 'NotificationDelivery', 'AuditLog', '_prisma_migrations']
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NULL THEN
      RAISE EXCEPTION 'Expected SafeHouse table missing: %', table_name;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', table_name);
    FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=client_role) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', table_name, client_role);
      END IF;
    END LOOP;
  END LOOP;
END;
$private_backend$;
