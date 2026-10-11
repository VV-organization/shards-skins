import test from 'node:test';
import assert from 'node:assert/strict';
import {paymentMessage,skinShortfall,balanceCoverage} from '../src/lib/commerce-status.ts';
test('paid Steam is pending until fulfillment actually confirms delivery',()=>{
 assert.equal(paymentMessage('steam_refill','paid','pending'),'Оплата получена. Пополнение Steam выполняется.');
 assert.equal(paymentMessage('steam_refill','paid','delivered'),'Баланс Steam пополнен');
 assert.match(paymentMessage('steam_refill','paid','failed'),/получена/);
});
test('available balance, not posted funds, determines top-up and preserves the maximum',()=>{
 assert.deepEqual(skinShortfall(25001,10000),{missing:15001,topUp:15100});
 assert.deepEqual(skinShortfall(10100001,0),{missing:10100001,topUp:null});
});
test('coverage uses available funds and never rounds an insufficient balance to 100%',()=>{
 assert.deepEqual(balanceCoverage(25001,0),{percent:0,remaining:0});
 assert.deepEqual(balanceCoverage(25001,10000),{percent:39,remaining:0});
 assert.deepEqual(balanceCoverage(25001,25000),{percent:99,remaining:0});
 assert.deepEqual(balanceCoverage(25001,25001),{percent:100,remaining:0});
 assert.deepEqual(balanceCoverage(25001,30000),{percent:100,remaining:4999});
 assert.deepEqual(balanceCoverage(0,0),{percent:0,remaining:0});
});
