import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {commerceFixture,type CommerceFixture,type FixtureIdentity,responseBody} from '../../test-support/commerce-fixture';
import {UsersService} from '../users/users.service';
const databaseUrl=process.env.SHARDS_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('quoted checkout HTTP boundary',()=>{
 let f:CommerceFixture,owner:FixtureIdentity;
 beforeAll(async()=>{if(!databaseUrl)throw new Error('test database missing');f=await commerceFixture(databaseUrl);owner=await f.identity('checkout-http');await f.catalog();await f.app.get(UsersService).saveSteamTradeCredential(owner.userId,{partner:String(BigInt(owner.steamId)-76561197960265728n),token:'fixtureToken'});});
 afterAll(async()=>{await f.close();});
 it('rejects removed raw checkout and caller supplied prices or payment methods',async()=>{
  await f.http().post('/checkout').set('Cookie',owner.cookie).set('x-csrf-token',owner.csrf).send({items:[]}).expect(404);
  await f.http().post('/checkout/cart').set('Cookie',owner.cookie).set('x-csrf-token',owner.csrf).set('idempotency-key',f.key()).send({quoteId:'fixture',cartVersion:0,method:'card',total:1}).expect(400);
  expect((await f.pool.query('SELECT * FROM orders')).rowCount).toBe(0);
 });
 it('requires session and CSRF; reports insufficient available Shards as 402 without writes',async()=>{
  await f.http().post('/checkout/quotes').send({cartVersion:0}).expect(401);
  await f.http().post('/checkout/quotes').set('Cookie',owner.cookie).send({cartVersion:0}).expect(403);
  await f.http().put('/cart/items/fixture-knife').set('Cookie',owner.cookie).set('x-csrf-token',owner.csrf).set('idempotency-key',f.key()).send({quantity:1,expectedCartVersion:0}).expect(200);
  const quote=responseBody<{id:string}>(await f.http().post('/checkout/quotes').set('Cookie',owner.cookie).set('x-csrf-token',owner.csrf).send({cartVersion:1}).expect(200));
  await f.http().post('/checkout/cart').set('Cookie',owner.cookie).set('x-csrf-token',owner.csrf).set('idempotency-key',f.key()).send({quoteId:quote.id,cartVersion:1}).expect(402);
  expect((await f.pool.query('SELECT * FROM orders')).rowCount).toBe(0);expect((await f.pool.query('SELECT * FROM wallet_holds')).rowCount).toBe(0);
 });
});
