export function money(paise) {
  if (!Number.isSafeInteger(paise)) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(paise / 100);
}

export function rupeesInput(paise) {
  return Number.isSafeInteger(paise) ? (paise / 100).toFixed(paise % 100 ? 2 : 0) : '';
}

export function parseRupees(value, { min = 0, max = 10_000_000 } = {}) {
  const raw = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error('Enter a valid amount with up to two decimal places.');
  const [whole, fraction = ''] = raw.split('.');
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(paise) || paise < min * 100 || paise > max * 100) throw new Error('Amount is outside the allowed range.');
  return paise / 100;
}

export function invoiceStatus(invoice, now = Date.now()) {
  if (!invoice) return { label: 'Not issued', tone: 'neutral' };
  if (invoice.status === 'PAID') return { label: 'Paid', tone: 'success' };
  if (invoice.status === 'WAIVED') return { label: 'Waived', tone: 'neutral' };
  if (invoice.status === 'PROCESSING') return { label: 'Verifying', tone: 'blue' };
  if (Date.parse(invoice.dueDate) < now) return { label: 'Overdue', tone: 'warning' };
  return { label: 'Due', tone: 'warning' };
}

export function verifiedCapture(status, invoiceId) {
  return status?.attemptStatus === 'CAPTURED' && status.paid === true && status.invoiceStatus === 'PAID' &&
    status.invoice?.id === invoiceId && status.invoice.status === 'PAID' && status.invoice.remainingPaise === 0;
}

export function trustedQr(qr) {
  if (!qr || !/^qr_[a-zA-Z0-9]+$/.test(qr.id) || !Number.isSafeInteger(qr.amountPaise) || qr.amountPaise < 100 || !Number.isFinite(qr.expiresAt)) return false;
  try {
    const url = new URL(qr.imageUrl);
    return url.protocol === 'https:' && !url.username && !url.password &&
      (url.hostname === 'rzp.io' || url.hostname === 'razorpay.com' || url.hostname.endsWith('.razorpay.com'));
  } catch { return false; }
}
