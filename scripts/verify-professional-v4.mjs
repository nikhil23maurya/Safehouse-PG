import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');
const server=read('src/server.ts');
const qr=read('src/razorpay.ts');
const payment=read('scripts/safehouse-atelier-payment-v3.js');
const visual=read('scripts/safehouse-professional-v4.css');
const patch=read('scripts/patch-mobile-atelier-v3.mjs');
const android=read('scripts/notification-android/MainActivity.java');

assert(server.includes('SAFEHOUSE_QR_SETTLEMENT_V2'),'provider capture settlement missing');
assert(server.includes('reconcileQrAttempt(attempt.providerOrderId)'),'QR status must reconcile on polling');
assert(server.includes('reconcileQrAttempt(candidate.providerOrderId)'),'old QR must reconcile before issuing new QR');
assert(server.includes('QR_RECHECK_REQUIRED'),'unknown state must block second payment');
assert(server.includes('tx.rentInvoice.updateMany'),'invoice settlement must use compare-and-swap');
assert(qr.includes('/qr_codes/" + encodeURIComponent(qrId) + "/payments?count=100'),'missing provider capture lookup');
assert(qr.includes('p?.captured === true'),'provider API must filter captured transactions');
assert(payment.includes("document.body.classList.remove('sh-pay-open')"),'checkout must unlock scrolling');
assert(payment.includes("r.attemptStatus==='CAPTURED'"),'success must require confirmed QR capture');
assert(!payment.includes('window.SafeHouseNative.openRazorpay('),'UPI must not open hosted checkout');
assert(visual.includes('SAFEHOUSE_PROFESSIONAL_V4'),'professional visual system missing');
assert(patch.includes('safehouse-professional-v4.css'),'production APK must include the professional theme');
assert(android.includes('window.setStatusBarColor(Color.rgb(255, 255, 255))'),'native system bars must match UI');
console.log('SafeHouse v4 professional UI / QR payment contract checks passed.');
