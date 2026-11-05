# Mobile integration notes

The maintained Android application now uses the Java/WebView source in `mobile/`, with modules in `mobile/frontend/src/`. Follow [the current Android instructions](mobile/README.md) for builds, secure storage and testing. The Expo environment example below is historical; the maintained app uses the existing public API URL in `mobile/frontend/src/core/api.js` and an encrypted Android Keystore vault.

## Current QR checkout

- `POST /api/student/payments/upi-qr` receives `{ invoiceId }` and returns the backend-issued fixed-amount QR.
- `GET /api/student/payments/orders/:orderId/status` reconciles the existing attempt. The frontend does not credit an invoice from UPI app return, a screenshot or a button.
- The success screen requires the matching captured attempt, fully paid invoice, and matching payment/receipt record from `/api/student/invoices`.
- Existing owner requests include `X-Property-Id` and the selected billing period where supported. Authenticated owner receipt downloads retain the property header.
- Native QR decoding checks the provider image, exact amount and currency before UPI handoff. API and database secrets are never shipped in the app.

## Historical integration reference

Production mobile environment:

```env
EXPO_PUBLIC_API_URL=https://YOUR-RENDER-SERVICE.onrender.com
```

Only the public API URL and Razorpay **Key ID** may reach the app. Never place these in the APK:

- `DATABASE_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`

## Authentication storage

Store the access + refresh tokens with Expo SecureStore (or the platform secure keystore), not AsyncStorage. If an API returns 401 because the access token expired, call `/api/auth/refresh`, replace the tokens, and retry once.

## Screens -> API mapping

- Owner login -> `/api/auth/login`
- Owner Home -> `/api/owner/dashboard`
- Students -> `/api/owner/students`
- Add Student -> `POST /api/owner/students`
- Rooms -> `/api/owner/rooms`
- Dues -> `/api/owner/dues`
- WhatsApp button -> open returned `whatsappUrl`
- Owner transactions -> `/api/owner/payments`
- Student Home -> `/api/student/dashboard`
- History/Receipts -> `/api/student/invoices`
- Pay Rent -> order -> Razorpay checkout -> verify -> poll status

The current frontend mock/demo data should be removed after these endpoints are connected.
