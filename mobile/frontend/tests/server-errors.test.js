import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../src/core/api.js';

test('a financial server error is uncertain and is never automatically replayed', async () => {
  let calls = 0;
  const api = createApiClient({ getState: () => ({ authEpoch: 1, tokens: { accessToken: 'fixture' }, user: { id: 'owner', role: 'OWNER' }, property: { id: 'property1' } }), saveTokens: async () => {}, onExpired: () => {}, fetchImpl: async () => { calls++; return new Response(JSON.stringify({ error: { message: 'Internal error' } }), { status: 500 }); } });
  await assert.rejects(api('/api/owner/invoices/invoice1/manual-payment', { method: 'POST', body: { amount: 500 } }), error => error.uncertain === true);
  assert.equal(calls, 1);
});
