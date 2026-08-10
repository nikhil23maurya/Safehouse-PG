# SafeHouse API contract

Base path: `/api`

All protected endpoints use:

```http
Authorization: Bearer <accessToken>
Content-Type: application/json
```

Money fields are stored and returned in **paise** for correctness. Convenience rupee values are also returned on invoices/payments.

## Authentication

- `POST /api/auth/login` — `{ email, password }`
- `POST /api/auth/refresh` — `{ refreshToken }`
- `GET /api/auth/me`
- `POST /api/auth/change-password` — `{ currentPassword, newPassword }`
- `POST /api/auth/logout`

There is intentionally **no student signup endpoint**. Students are created only by the owner.

## Owner

- `GET /api/owner/dashboard?year=2026&month=8`
- `GET /api/owner/property`
- `PATCH /api/owner/property`
- `GET /api/owner/students?q=&status=ALL|ACTIVE|PAID|PENDING|OVERDUE`
- `POST /api/owner/students`
- `GET /api/owner/students/:id`
- `PATCH /api/owner/students/:id`
- `POST /api/owner/students/:id/reset-password`
- `GET /api/owner/rooms`
- `POST /api/owner/rooms`
- `PATCH /api/owner/rooms/:id`
- `GET /api/owner/dues?year=2026&month=8`
- `POST /api/owner/rents/generate`
- `PATCH /api/owner/invoices/:id`
- `POST /api/owner/invoices/:id/manual-payment`
- `GET /api/owner/payments`
- `GET /api/owner/payments/:id/receipt.pdf`

### Create student example

```json
{
  "fullName": "Aman Kumar",
  "email": "aman@example.com",
  "mobile": "9876543210",
  "roomId": "ROOM_ID_OR_NULL",
  "bedLabel": "B1",
  "joiningDate": "2026-08-01",
  "monthlyRent": 8500,
  "securityDeposit": 5000,
  "rentDueDay": 5,
  "tempPassword": "TempPass123!"
}
```

`monthlyRent` and `securityDeposit` are supplied in rupees by the app; the backend converts them to paise.

### WhatsApp reminders

`GET /api/owner/dues` returns a `whatsappUrl` for each due. The app opens that URL. No WhatsApp Business API is used.

## Student

- `GET /api/student/dashboard`
- `GET /api/student/invoices`
- `POST /api/student/payments/order` — `{ invoiceId }`
- `POST /api/student/payments/verify` — Razorpay success fields
- `GET /api/student/payments/orders/:orderId/status`
- `GET /api/student/payments/:id/receipt.pdf`

### Razorpay flow

1. App calls `POST /api/student/payments/order`.
2. Backend creates Razorpay order and returns `order.id`, amount, Key ID and prefill values.
3. Native checkout runs in the app.
4. On checkout success, app sends:

```json
{
  "razorpayOrderId": "order_...",
  "razorpayPaymentId": "pay_...",
  "razorpaySignature": "..."
}
```

5. Backend verifies the checkout signature and returns `PROCESSING`.
6. Backend does **not** mark the rent paid from the client callback.
7. Razorpay sends signed `payment.captured` to `/api/webhooks/razorpay`.
8. Only then does the backend create the payment + receipt and mark the invoice `PAID`.
9. App polls `GET /api/student/payments/orders/:orderId/status` briefly until `paid: true`.

This makes the webhook/captured payment the payment source of truth.
