# SafeHouse Backend — Production MVP

Backend for the SafeHouse PG owner/student mobile app.

## What is implemented

- Owner + Student authentication with access/refresh tokens
- Password hashing with Node's built-in `scrypt`
- No public student signup — owner creates student accounts
- Owner property/PG settings
- Student CRUD + temporary password reset
- Room management + capacity validation
- Monthly rent invoices with historical snapshots
- Dashboard collection metrics
- Pending/overdue dues
- WhatsApp reminder deep links — no WhatsApp API
- Extra invoice charges: electricity, late fee, other charges, discount
- Manual cash/bank payments
- Razorpay Orders API
- Mandatory checkout signature verification
- Raw-body Razorpay webhook verification
- `payment.captured` webhook is the final source of truth for PAID status
- Idempotent Razorpay payment recording
- Payment history
- PDF rent receipts
- Audit logs for sensitive owner actions
- Render `/health` + `/ready` endpoints
- Rate limiting, Helmet, CORS and validation

## Architecture

```text
SafeHouse Android app
        |
        | HTTPS JSON API
        v
Render: SafeHouse Node/Express API
        |
        +----> Supabase Managed PostgreSQL
        |
        +----> Razorpay Orders API
                    |
                    +---- webhook ----> Render API
```

## Local quick start

1. Copy `.env.example` to `.env` and fill the values.
2. Install dependencies:

```bash
npm install
```

3. Generate Prisma Client:

```bash
npm run prisma:generate
```

4. Apply the included database migration:

```bash
npm run prisma:migrate:deploy
```

5. Start locally:

```bash
npm run dev
```

Check:

```text
http://localhost:4000/health
http://localhost:4000/ready
```

## Supabase setup

### 1. Create the project

Create a normal Supabase project and keep its database password safe.

### 2. Create a dedicated Prisma database user

Open **Supabase -> SQL Editor**, open `SUPABASE_PRISMA_USER.sql`, replace `CHANGE_ME_STRONG_PASSWORD`, and run it.

For the password, using a long random alphanumeric password avoids URL-encoding problems in the connection string.

### 3. Get the connection string

In Supabase click **Connect** and find **Supavisor Session pooler**. Use the string ending in **port 5432** for this Render/server deployment.

It will look similar to:

```text
postgres://postgres.PROJECT_REF:PASSWORD@REGION.pooler.supabase.com:5432/postgres
```

Change only the DB username from `postgres.PROJECT_REF` to `prisma.PROJECT_REF`, and use the password you created for the `prisma` user:

```text
postgres://prisma.PROJECT_REF:PRISMA_PASSWORD@REGION.pooler.supabase.com:5432/postgres
```

Paste the full value into Render as `DATABASE_URL`.

Do not expose this URL inside the mobile app.

## Render deployment

Push this backend folder to GitHub. A separate backend repo is simplest for now.

Create **Render -> New -> Web Service**, connect the GitHub repo, then use:

```text
Runtime: Node
Build Command: npm install && npm run build
Start Command: npm run start:render
Health Check Path: /health
```

The start command runs `prisma migrate deploy` before starting the API, so pending committed migrations are applied during deployment.

Do not manually set `PORT`; Render supplies it.

### Render environment variables

Required:

```env
NODE_ENV=production
DATABASE_URL=<Supabase Session Pooler 5432 URL>
JWT_ACCESS_SECRET=<strong random secret, at least 32 chars>
JWT_REFRESH_SECRET=<different strong random secret, at least 32 chars>
RAZORPAY_KEY_ID=<test key first>
RAZORPAY_KEY_SECRET=<test key secret>
RAZORPAY_WEBHOOK_SECRET=<strong webhook secret>
APP_NAME=SafeHouse
CORS_ORIGINS=*
```

For the **first deployment only**, also add:

```env
BOOTSTRAP_OWNER_EMAIL=your-real-owner-email@example.com
BOOTSTRAP_OWNER_PASSWORD=<strong initial password>
BOOTSTRAP_OWNER_NAME=Raj Sharma
BOOTSTRAP_PROPERTY_NAME=SafeHouse PG
```

The server creates the first owner and property only if they do not already exist.

After the first deploy succeeds and you can log in, remove **all four** `BOOTSTRAP_OWNER_*` variables from Render. Never leave the initial owner password sitting in environment variables unnecessarily.

### Generate secure secrets

In PowerShell:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Run it separately for `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`.

## Razorpay setup

Start in **Test Mode**.

1. Create/generate Test API keys in Razorpay.
2. Put the Test Key ID and Secret in Render.
3. Enable automatic payment capture in Razorpay Payment Capture settings.
4. Deploy the backend.
5. In Razorpay Webhooks create this URL:

```text
https://YOUR-RENDER-SERVICE.onrender.com/api/webhooks/razorpay
```

6. Set the webhook secret to exactly the same value as `RAZORPAY_WEBHOOK_SECRET` in Render.
7. Subscribe to:

```text
payment.captured
payment.failed
```

8. Test a full payment before switching to Live keys.

### Why the app does not mark PAID immediately

The checkout success callback is first signature-verified by the backend. At that point the invoice becomes `PROCESSING` only.

The invoice becomes `PAID` only after the backend receives a valid signed `payment.captured` webhook. This prevents a forged frontend success screen from marking rent as paid.

## First production verification

After Render says the service is live:

```text
GET https://YOUR-RENDER-SERVICE.onrender.com/health
GET https://YOUR-RENDER-SERVICE.onrender.com/ready
```

Both should return `ok: true`.

Then test owner login:

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "your owner email",
  "password": "your bootstrap owner password"
}
```

Next create at least one room, then create one student, log in as that student, and test the complete Razorpay Test Mode flow.

## Monthly rent behavior

Invoices are historical snapshots. If a student's rent changes today, old invoices are not rewritten.

For reliability the backend automatically ensures the current month's invoice exists when owner/student dashboards are opened. There is also:

```text
POST /api/owner/rents/generate
```

for explicit generation.

This means a separate cron job is not required for the first production version.

## Money handling

All money is persisted as integer **paise**, never floating-point rupees. For example ₹8,500 is stored as `850000`. API responses include convenience rupee values where helpful.

## Important production rules

- Never put database/Razorpay secrets in the APK.
- Do not use Supabase's anon/service key for this backend; this backend connects directly to Postgres with the dedicated Prisma DB user.
- Keep Razorpay Key Secret on Render only.
- Keep the webhook endpoint public, but rely on the webhook HMAC signature validation already implemented.
- Use HTTPS only in the production mobile app.
- Student passwords should be temporary and changed after first login.
- Test every payment in Razorpay Test Mode before replacing keys with Live Mode keys.

See `API.md` and `MOBILE_INTEGRATION.md` for the endpoint contract and app wiring plan.
