import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {commerceFixture,type CommerceFixture,type FixtureIdentity,responseBody} from '../../test-support/commerce-fixture';
import {WalletService} from '../wallet/wallet.service';
const databaseUrl=process.env.SHARDS_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('quoted payment HTTP boundary',()=>{
 let f:CommerceFixture,owner:FixtureIdentity,email:FixtureIdentity;
 beforeAll(async()=>{if(!databaseUrl)throw new Error('test database missing');f=await commerceFixture(databaseUrl);owner=await f.identity('wallet-http');email=await f.identity('email-http',false);await f.pool.query("INSERT INTO email_identities(email,user_id,verified_at) VALUES ('owner@example.test',$1,now())",[email.userId]);});
 afterAll(async()=>{await f.close();});
 it('rejects guest email upsert, unquoted amounts and client recipient overrides',async()=>{
  await f.http().post('/payments/steam-refill/sessions').send({amountRub:50,steamLogin:'player',email:'guest@example.test'}).expect(401);
  await f.http().post('/payments/top-up/sessions').set('Cookie',owner.cookie).set('x-csrf-token',owner.csrf).set('idempotency-key',f.key()).send({coinAmountMinor:100000}).expect(400);
  await f.http().post('/payments/steam-refill/quotes').set('Cookie',email.cookie).set('x-csrf-token',email.csrf).send({amountRub:50,steamLogin:'player',email:'foreign@example.test'}).expect(400);
  expect((await f.pool.query("SELECT * FROM email_identities WHERE email='guest@example.test'")).rowCount).toBe(0);
 });
 it('creates one quoted top-up, verifies callback signature, survives restart and credits once',async()=>{
  const quote=responseBody<{quoteId:string;fiatAmountMinor:number}>(await f.http().post('/payments/top-up/quotes').set('Cookie',owner.cookie).set('x-csrf-token',owner.csrf).send({coinAmountMinor:100000}).expect(200));expect(quote.fiatAmountMinor).toBe(62500);
  const key=f.key(),command={quoteId:quote.quoteId,acceptedFiatMinor:quote.fiatAmountMinor};
  const payment=responseBody<{id:string}>(await f.http().post('/payments/top-up/sessions').set('Cookie',owner.cookie).set('x-csrf-token',owner.csrf).set('idempotency-key',key).send(command).expect(200));
  expect((await f.captured(payment.id,62500,'bad-signature',false)).status).toBe(401);expect((await f.app.get(WalletService).getBalance(owner.userId)).availableCoinMinor).toBe(0);
  expect((await f.captured(payment.id,1,'wrong-amount')).body).toMatchObject({status:'rejected'});
  await f.restart();const replay=await f.http().post('/payments/top-up/sessions').set('Cookie',owner.cookie).set('x-csrf-token',owner.csrf).set('idempotency-key',key).send(command).expect(200);expect(replay.body).toMatchObject({id:payment.id});
  expect((await f.captured(payment.id,62500)).body).toMatchObject({status:'processed'});expect((await f.captured(payment.id,62500)).body).toMatchObject({status:'duplicate'});
  expect((await f.app.get(WalletService).getBalance(owner.userId)).availableCoinMinor).toBe(100000);
  await f.http().get(`/payments/sessions/${payment.id}`).set('Cookie',email.cookie).expect(404);
 });
 it('verified email can quote direct Steam but cannot top up a Shards wallet',async()=>{
  await f.http().post('/payments/top-up/quotes').set('Cookie',email.cookie).set('x-csrf-token',email.csrf).send({coinAmountMinor:100000}).expect(400);
  const quote=responseBody<{quoteId:string}>(await f.http().post('/payments/steam-refill/quotes').set('Cookie',email.cookie).set('x-csrf-token',email.csrf).send({amountRub:50,steamLogin:'player-login'}).expect(200));
  await f.http().post('/payments/steam-refill/sessions').set('Cookie',email.cookie).set('x-csrf-token',email.csrf).set('idempotency-key',f.key()).send({quoteId:quote.quoteId,acceptedFiatMinor:5250}).expect(200);
  expect((await f.pool.query('SELECT * FROM wallet_transactions WHERE user_id=$1',[email.userId])).rowCount).toBe(0);
 });
});
