# Backend-only database access

The owner approved this security change after a read-only inspection found RLS disabled and `anon`/`authenticated` grants on application tables. Public Data API probes returned 503/PGRST002, so unauthorised row access or a data leak was not established. The permissive database grants still needed correction before that API became available.

Migration `20261109150000_private_backend_access` enables RLS and revokes all table privileges from `PUBLIC`, `anon` and `authenticated` on the 24 Prisma application tables and internal `_prisma_migrations` table. It does not force RLS on the table owner, add public client policies, alter ownership or touch any rows, financial amounts, columns, passwords or application auth/tenant code. All inspected application tables are owned by `postgres`; the existing backend/migration owner retains access. It does not change unrelated Supabase schemas, extensions, tables, functions or project settings.

CI first reproduces the historical public grants in an isolated, local-only PostgreSQL database. The complete platform integration suite then runs under the unchanged backend role after migrations. Specific permission tests verify RLS, owner access, rejection for anonymous/authenticated/PUBLIC-only roles, and preservation of an unrelated probe table's grants. Truncate privileges are inspected, never exercised.

Deploy through the existing Prisma/Render startup migration process. Do not run manual financial data updates or add permissive `auth.uid()` policies: PGOne uses its own Firebase-backed identity and server-side tenant checks, not Supabase client authentication.

After deployment, check `/ready`, phone sign-in/session/workspace access and the database permission metadata. Inspect `relrowsecurity`, table owners, and `has_table_privilege` for all three public caller categories. A permission error in the backend is a release failure and must be investigated before enabling customer traffic. Regranting broad public access is not the recovery path.

Reference: [Supabase RLS and grants](https://supabase.com/docs/guides/database/postgres/row-level-security).
