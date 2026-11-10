import test from 'node:test';
import assert from 'node:assert/strict';
import {paymentContact} from '../src/payments/plan.js';
test('payment contact accepts genuine input formats and normalizes to E164',()=>{
  for(const input of ['9999999999','+91 99999 99999','91-9999999999',' (99999) 99999 '])
    assert.equal(paymentContact(input),'+919999999999');
});
test('blank, malformed and non-Indian payment contacts never become placeholder numbers',()=>{
  for(const input of [undefined,null,'',' ','12345','5999999999','9999999999999','+19999999999','payer@example.com','99999x99999'])
    assert.equal(paymentContact(input),null);
});
