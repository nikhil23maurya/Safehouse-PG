import { test, expect } from '@playwright/test';
import { setup, login, go, noOverflow } from './helpers.js';

test('owner login, invalid credentials, visibility and logout', async ({ page }) => {
  const fixture = await setup(page);
  await page.getByLabel('Email address').fill('owner@example.test');
  await page.getByLabel('Password', { exact: true }).fill('IncorrectPass!');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('.form-error')).toContainText('Invalid email or password');
  await login(page);
  await page.locator('.bottom-nav [data-route="profile"]').click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.locator('[data-action="dialog-confirm"]').click();
  await expect(page).toHaveTitle(/^Sign in/);
  expect(fixture.errors).toEqual([]);
});

test('resident role guard and required password change', async ({ page }) => {
  const fixture = await setup(page); fixture.control.mustChangePassword = true;
  await page.getByLabel('Email address').fill('resident@example.test');
  await page.getByLabel('Password', { exact: true }).fill('FixturePass123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveTitle(/^Change password/);
  await page.getByLabel('Current password', { exact: true }).fill('FixturePass123!');
  await page.getByLabel('New password', { exact: true }).fill('NewFixturePass123!');
  await page.getByLabel('Confirm new password', { exact: true }).fill('NewFixturePass123!');
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page).toHaveTitle(/^Home/);
  await page.evaluate(() => { const record = { name: 'ownerHome', params: {}, depth: 1 }; history.pushState(record, '', '#ownerHome'); dispatchEvent(new PopStateEvent('popstate', { state: record })); });
  await expect(page).toHaveURL(/#studentHome$/);
  expect(fixture.control.requests.filter(r => r.path.startsWith('/api/owner/'))).toHaveLength(0);
});

test('property and month selection never mix financial context', async ({ page }) => {
  const fixture = await setup(page); await login(page);
  await page.getByRole('button', { name: 'Previous month' }).click();
  await expect(page.locator('.period-control')).not.toContainText(new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(new Date()));
  await page.locator('.property-context [data-route="properties"]').click();
  await page.locator('[data-action="selectProperty"][data-id="property2"]').click();
  await expect(page.locator('.property-context')).toContainText('Cedar House');
  const latest = fixture.control.requests.filter(r => r.path === '/api/owner/dashboard').at(-1);
  expect(latest.propertyId).toBe('property2');
  await page.locator('.bottom-nav [data-route="residents"]').click();
  await expect(page.getByText('Make room for your first resident')).toBeVisible();
  expect(fixture.errors).toEqual([]);
});

test('create resident retains values on capacity and duplicate rejection, then saves once', async ({ page }) => {
  const fixture = await setup(page); await login(page);
  await page.locator('.quick-actions [data-route="residentForm"]').click();
  await page.getByLabel('Full name').fill('Nisha Rao');
  await page.getByLabel('Email address').fill('nisha@example.test');
  await page.getByLabel('Mobile number').fill('9876543219');
  await page.getByLabel('Room', { exact: true }).selectOption('room1');
  await page.getByLabel('Monthly rent (₹)').fill('9100.25');
  await page.getByLabel('Temporary password').fill('FixturePass123!');
  fixture.control.capacityRejected = true;
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('.form-error')).toContainText('no vacant beds');
  await expect(page.getByLabel('Full name')).toHaveValue('Nisha Rao');
  await expect(page.locator('#field-roomId-error')).toContainText('Room is full');
  fixture.control.capacityRejected = false; fixture.control.duplicateResident = true;
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('.form-error')).toContainText('already exists');
  fixture.control.duplicateResident = false;
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveTitle(/^Resident details/);
  await expect(page.getByRole('heading', { name: 'Nisha Rao', exact: true })).toBeVisible();
  const writes = fixture.control.requests.filter(r => r.path === '/api/owner/students' && r.method === 'POST');
  expect(writes).toHaveLength(3); expect(writes.at(-1).body.monthlyRent).toBe(9100.25);
});

test('unsaved resident details are protected during back navigation', async ({ page }) => {
  await setup(page); await login(page); await go(page, 'residentForm');
  await page.getByLabel('Full name').fill('Retain this draft');
  await page.getByRole('button', { name: 'Go back' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByLabel('Full name')).toHaveValue('Retain this draft');
  await page.getByRole('button', { name: 'Go back' }).click();
  await page.getByRole('button', { name: 'Leave page' }).click();
  await expect(page).toHaveTitle(/^Home/);
});

test('room validation, unique number and successful create', async ({ page }) => {
  const fixture = await setup(page); await login(page); await go(page, 'roomForm');
  await page.getByLabel('Room number').fill('203');
  await page.getByLabel('Number of beds').fill('2');
  await page.getByRole('button', { name: 'Add room', exact: true }).click();
  await expect(page.locator('.form-error')).toContainText('already exists');
  await page.getByLabel('Room number').fill('206');
  await page.getByRole('button', { name: 'Add room', exact: true }).click();
  await expect(page).toHaveTitle(/^Room details/); await expect(page.getByRole('heading', { name: 'Room 206', exact: true })).toBeVisible();
  expect(fixture.errors).toEqual([]);
});

test('manual payment requires confirmation and preserves its method field', async ({ page }) => {
  const fixture = await setup(page); await login(page); await go(page, 'manualPayment', { id: 'invoice1', residentId: 'resident1' });
  await page.getByLabel('Amount received (₹)').fill('500.25');
  await page.getByLabel('Payment method').selectOption('BANK_TRANSFER');
  await page.getByRole('button', { name: 'Review payment' }).click();
  expect(fixture.control.requests.some(r => r.path.endsWith('/manual-payment'))).toBe(false);
  await page.getByRole('button', { name: 'Record payment', exact: true }).click();
  await expect(page).toHaveTitle(/^Payment history/);
  const write = fixture.control.requests.find(r => r.path.endsWith('/manual-payment'));
  expect(write.body).toEqual({ amount: 500.25, method: 'BANK_TRANSFER' });
});

test('interrupted manual payment cannot be submitted twice', async ({ page }) => {
  await setup(page); await login(page); await go(page, 'manualPayment', { id: 'invoice1', residentId: 'resident1' });
  let calls = 0;
  await page.route('**/api/owner/invoices/invoice1/manual-payment', async route => { calls++; await route.abort('connectionreset'); });
  await page.getByRole('button', { name: 'Review payment' }).click();
  await page.getByRole('button', { name: 'Record payment', exact: true }).click();
  await expect(page.locator('.form-error')).toContainText('may already be recorded');
  await expect(page.locator('button[type="submit"]')).toBeDisabled(); expect(calls).toBe(1);
});

test('QR is pending until exact backend capture and receipt record arrive', async ({ page }) => {
  const fixture = await setup(page); await login(page, 'STUDENT');
  await page.getByRole('button', { name: 'Pay rent', exact: true }).click();
  await expect(page.getByAltText('Provider-issued rent payment QR')).toBeVisible();
  await expect(page.getByText('Payment Successful', { exact: true })).toHaveCount(0);
  fixture.control.paymentState = 'VERIFIED';
  await page.getByRole('button', { name: 'Check payment status' }).click();
  await expect(page.getByText('Payment Successful', { exact: true })).toHaveCount(0);
  fixture.control.paymentState = 'CAPTURED'; fixture.control.omitPayment = true;
  await page.getByRole('button', { name: 'Check payment status' }).click();
  await expect(page.getByText('Verifying payment', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Payment Successful', { exact: true })).toHaveCount(0);
  fixture.control.omitPayment = false;
  await page.getByRole('button', { name: 'Check payment status' }).click();
  await expect(page.getByRole('heading', { name: 'Payment Successful' })).toBeVisible();
  await expect(page.getByText('pay_fixture1', { exact: true })).toBeVisible();
  await expect(page.locator('.success-amount')).toHaveText('₹8,500.99');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download receipt' }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('SafeHouse-SH-TEST-1001.pdf');
  expect(fixture.errors).toEqual([]);
});

for (const scenario of ['disabled', 'expired', 'image', 'network', 'failed']) test(`payment handles ${scenario} without false success`, async ({ page }) => {
  const fixture = await setup(page);
  if (scenario === 'disabled') fixture.control.qrDisabled = true;
  if (scenario === 'expired') fixture.control.qrExpired = true;
  if (scenario === 'network') fixture.control.failStatus = true;
  if (scenario === 'failed') fixture.control.paymentState = 'FAILED';
  if (scenario === 'image') await page.route('https://rzp.io/i/fixture', route => route.abort());
  await login(page, 'STUDENT'); await page.getByRole('button', { name: 'Pay rent', exact: true }).click();
  const expected = { disabled: 'not enabled', expired: 'QR expired', image: 'QR couldn’t load', network: 'Status temporarily unavailable', failed: 'Payment failed' }[scenario];
  await expect(page.getByText(expected, { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Payment Successful', { exact: true })).toHaveCount(0);
  expect(fixture.control.requests.filter(r => r.path.endsWith('/upi-qr'))).toHaveLength(1);
});

test('notification audience, schedules and campaign states use the existing API', async ({ page }) => {
  const fixture = await setup(page); await login(page); await go(page, 'notificationForm');
  await page.getByLabel('Audience', { exact: true }).selectOption('SELECTED');
  await page.locator('[name="selectedStudent"][value="resident1"]').check();
  await page.getByLabel('Timing').selectOption('schedule');
  await page.getByLabel('Times per day').selectOption('2');
  await page.getByRole('button', { name: 'Review notification' }).click();
  await page.getByRole('button', { name: 'Schedule', exact: true }).click();
  await expect(page).toHaveTitle(/^Notifications/);
  const write = fixture.control.requests.find(r => r.path === '/api/owner/notifications/campaigns' && r.method === 'POST');
  expect(write.body.selectedStudentIds).toEqual(['resident1']); expect(write.body.scheduleTimes).toEqual(['10:00', '18:00']);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await expect(page.getByText('accepted by push provider', { exact: false })).toBeVisible();
});

test('responsive text scaling and landscape do not overflow', async ({ page }) => {
  await setup(page); await login(page);
  await page.evaluate(() => { document.documentElement.style.fontSize = '20px'; });
  await noOverflow(page);
  await page.setViewportSize({ width: 852, height: 393 }); await go(page, 'residentForm'); await noOverflow(page);
});
