import assert from 'node:assert/strict';
import {test} from 'node:test';
import {hostedCheckoutTarget} from '../src/lib/hosted-checkout.ts';
test('hosted checkout preserves return session and uses Paidlayer POST',()=>{
 const target=hostedCheckoutTarget('https://payment.paidlayer.com/order-1','local-1','https://shardsmarket.com');
 assert.equal(target.action,'https://payment.paidlayer.com/order-1');
 assert.equal(new URL(target.successUrl).pathname,'/payments/return');
 assert.equal(new URL(target.successUrl).searchParams.get('session'),'local-1');
 assert.equal(new URL(target.failUrl).searchParams.get('session'),'local-1');
});
test('rejects foreign and malformed checkout destinations',()=>{
 for(const url of ['https://evil.test/order','https://payment.paidlayer.com.evil.test/order','https://payment.paidlayer.com/order?next=evil','https://user@payment.paidlayer.com/order','http://payment.paidlayer.com/order']){
  assert.throws(()=>hostedCheckoutTarget(url,'local-1','https://shardsmarket.com'));
 }
});
