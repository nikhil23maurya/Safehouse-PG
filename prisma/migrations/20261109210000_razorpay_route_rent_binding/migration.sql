-- Route rent payments must remember their exact recipient when created.
-- Existing legacy Razorpay attempts remain unmodified (nullable binding).
ALTER TABLE "PaymentAttempt"
  ADD COLUMN IF NOT EXISTS "routeAccountId" TEXT;
