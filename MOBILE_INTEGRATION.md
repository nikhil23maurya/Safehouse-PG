# Mobile integration notes

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
