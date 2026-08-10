# SafeHouse deployment checklist

## Supabase

- [ ] Create Supabase project
- [ ] Run `SUPABASE_PRISMA_USER.sql` after changing its password
- [ ] Copy **Session Pooler** connection string (port **5432**)
- [ ] Replace DB username with `prisma.PROJECT_REF`
- [ ] Save final string as Render `DATABASE_URL`

## GitHub / Render

- [ ] Push backend folder to GitHub
- [ ] Render -> New -> Web Service -> connect repo
- [ ] Build: `npm install && npm run build`
- [ ] Start: `npm run start:render`
- [ ] Health check: `/health`
- [ ] Add all required environment variables from `.env.example`
- [ ] Add all 4 `BOOTSTRAP_OWNER_*` values for first deploy only
- [ ] Deploy
- [ ] Open `/health`
- [ ] Open `/ready`
- [ ] Login with bootstrap owner
- [ ] Remove all 4 `BOOTSTRAP_OWNER_*` env variables after successful login

## Razorpay Test Mode

- [ ] Generate Test Key ID + Secret
- [ ] Add them to Render
- [ ] Enable automatic capture
- [ ] Create webhook URL: `https://YOUR-SERVICE.onrender.com/api/webhooks/razorpay`
- [ ] Webhook secret == Render `RAZORPAY_WEBHOOK_SECRET`
- [ ] Subscribe to `payment.captured`
- [ ] Subscribe to `payment.failed`
- [ ] Redeploy if environment variables changed
- [ ] Test one complete student payment
- [ ] Confirm invoice changes to PAID only after webhook

## Before Live Mode

- [ ] Razorpay KYC/live account ready
- [ ] Replace Test Key ID/Secret with Live keys
- [ ] Create/configure Live-mode webhook
- [ ] Test low-value real payment
- [ ] Verify receipt + owner dashboard + student history
- [ ] Never put Razorpay Key Secret or DB URL in APK
