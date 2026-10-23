import {Test} from '@nestjs/testing';
import type {INestApplication} from '@nestjs/common';
import {Pool} from 'pg';
import request from 'supertest';
import type {App} from 'supertest/types';
import {APP_CONFIG} from '../../config/app-config.module';
import type {AppConfig} from '../../config/app-config';
import type {PaymentQuoteDto} from './payment-quote.types';
import {PaymentsService} from './payments.service';
import {SessionsService} from '../sessions/sessions.service';
import {CUSTOMER_SESSION_COOKIE} from '../sessions/session-cookies';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {AppModule} from '../../app.module';
import {SihClient} from '../providers/sih/sih.client';
import {UsersService} from '../users/users.service';
import {PaymentQuotesService} from './payment-quotes.service';
import {PaymentHistoryService} from './payment-history.service';
import {OrdersService} from '../orders/orders.service';
const url=process.env.SHARDS_TEST_DATABASE_URL;
describe.skipIf(!url)('VV163 guest Steam and automatic history',()=>{
 let app:INestApplication,pool:Pool,server:App;
 type Guest={cookie:string;csrf:string;id:string;setCookie:string};
 type Payment={id:string};
 beforeAll(async()=>{
  vi.stubEnv('DATABASE_URL',url);
  vi.stubEnv('GUEST_STEAM_REFILL_ENABLED','true');
  vi.stubEnv('SHARDS_PAYMENTS_ENABLED','true');
  vi.stubEnv('SHARDS_FULFILLMENT_ENABLED','true');
  pool=new Pool({connectionString:url});
  app=(await Test.createTestingModule({imports:[AppModule]}).overrideProvider(SihClient).useValue({checkSteamAccount:()=>Promise.resolve({transactionId:'guest-check'})}).compile()).createNestApplication();await app.init();server=app.getHttpServer() as App;
  await pool.query("INSERT INTO users(id,steam_id64) VALUES ('steam-a','76561198000000571'),('steam-b','76561198000000572'),('old-email',NULL),('guest-race-owner','76561198000000573'),('guest-replay-owner','76561198000000574')");
 });
 afterAll(async()=>{try{await app.close();await pool.end();}finally{vi.unstubAllEnvs();}});
 async function guest():Promise<Guest>{
  const r=await request(server).post('/payments/guest/context').expect(201);
  const body=r.body as {csrfToken:string;id:string};
  const cookies=r.headers['set-cookie'] as string[]|undefined;
  const setCookie=cookies?.[0];if(!setCookie)throw new Error('Guest cookie missing');
  const cookie=setCookie.split(';')[0];if(!cookie)throw new Error('Guest cookie empty');
  return {cookie,csrf:body.csrfToken,id:body.id,setCookie};
 }
 async function purchase(g:Awaited<ReturnType<typeof guest>>,email:string,key:string){
  const q=await request(server).post('/payments/guest/steam-refill/quotes').set('Cookie',g.cookie).set('x-csrf-token',g.csrf).send({amountRub:500,steamLogin:'receiver',email}).expect(200);
  const quote=q.body as PaymentQuoteDto;
  const body={quoteId:quote.quoteId,acceptedFiatMinor:quote.fiatAmountMinor};
  const post=()=>request(server).post('/payments/guest/steam-refill/sessions').set('Cookie',g.cookie).set('x-csrf-token',g.csrf).set('Idempotency-Key',key).send(body);
  const p=await post().expect(200);return {p:p.body as Payment,post,quote};
 }
 it('restores existing guest CSRF without creating a context and protects payment checks',async()=>{
  const a=await guest(),b=await guest();const {p}=await purchase(a,'resume@example.test','guest-resume');
  const before=(await pool.query('SELECT id FROM guest_payment_contexts')).rowCount;
  await request(server).get('/payments/guest/context').expect(401);
  const context=await request(server).get('/payments/guest/context').set('Cookie',a.cookie).expect(200);
  expect(context.body).toEqual({id:a.id,csrfToken:a.csrf});
  expect((await pool.query('SELECT id FROM guest_payment_contexts')).rowCount).toBe(before);
  const path=`/payments/guest/steam-refill/sessions/${p.id}/check`;
  await request(server).post(path).set('Cookie',a.cookie).send({}).expect(403);
  await request(server).post(path).set('Cookie',b.cookie).set('x-csrf-token',b.csrf).send({}).expect(404);
  await request(server).post(path).set('Cookie',a.cookie).set('x-csrf-token',a.csrf).send({}).expect(200);
 });
 it('needs neither customer login nor OTP; preserves retry and isolates guest access from wallet',async()=>{
  const a=await guest(),b=await guest();const {p,post}=await purchase(a,' Guest@Example.test ','guest-one');
  expect(((await post().expect(200)).body as Payment).id).toBe(p.id);
  await request(server).get(`/payments/guest/steam-refill/sessions/${p.id}`).set('Cookie',a.cookie).expect(200);
  await request(server).get(`/payments/guest/steam-refill/sessions/${p.id}`).set('Cookie',b.cookie).expect(404);
  await request(server).get('/session/me').set('Cookie',a.cookie).expect(401);
  await request(server).get('/wallet/me').set('Cookie',a.cookie).expect(401);
  await request(server).post('/payments/guest/steam-refill/quotes').set('Cookie',a.cookie).send({amountRub:500,steamLogin:'receiver',email:'a@example.test'}).expect(403);
  expect((await pool.query('SELECT * FROM email_identities')).rowCount).toBe(0);
  expect((await pool.query('SELECT * FROM wallet_ledger_entries')).rowCount).toBe(0);
 });
 it('matches by verified email across guest browsers, not by shared guest owner; includes future refills',async()=>{
  const a=await guest(),b=await guest();const one=await purchase(a,'match@example.test','match-one'),other=await purchase(a,'other@example.test','other'),two=await purchase(b,'MATCH@example.test','match-two');
  expect((await app.get(PaymentHistoryService).listForUser('steam-a')).payments).toHaveLength(0);
  await app.get(UsersService).upsertEmailUser('match@example.test','steam-a');
  const three=await purchase(b,'match@example.test','match-three');
  const ids=(await app.get(PaymentHistoryService).listForUser('steam-a')).payments.map(p=>p.id);
  expect(ids.sort()).toEqual([one.p.id,two.p.id,three.p.id].sort());expect(ids).not.toContain(other.p.id);
  expect((await app.get(OrdersService).listUserOrders('steam-a')).orders).toHaveLength(3);
  expect((await app.get(PaymentQuotesService).getSession('steam-a',one.p.id)).id).toBe(one.p.id);
  await expect(app.get(PaymentQuotesService).getSession('steam-b',one.p.id)).rejects.toMatchObject({status:404});
  await app.get(UsersService).upsertEmailUser('match@example.test','steam-a');
  expect((await app.get(PaymentHistoryService).listForUser('steam-a')).payments).toHaveLength(3);
  await expect(app.get(UsersService).upsertEmailUser('match@example.test','steam-b')).rejects.toMatchObject({status:409});
 });
 it('adopts a verified legacy email-only profile without rewriting original payment identity',async()=>{
  await pool.query("INSERT INTO email_identities(email,user_id,verified_at) VALUES ('legacy@example.test','old-email',now())");
  const q=await app.get(PaymentQuotesService).quoteSteam('old-email',50,'legacy');
  const stale=await app.get(PaymentQuotesService).quoteSteam('old-email',50,'legacy','legacy@example.test');
  const p=await app.get(PaymentQuotesService).createSession({userId:'old-email',purpose:'steam_refill',quoteId:q.quoteId,acceptedFiatMinor:q.fiatAmountMinor,idempotencyKey:'legacy'});
  await app.get(UsersService).upsertEmailUser('legacy@example.test','steam-b');
  await expect(app.get(PaymentQuotesService).createSession({userId:'old-email',purpose:'steam_refill',quoteId:stale.quoteId,acceptedFiatMinor:stale.fiatAmountMinor,idempotencyKey:'stale-legacy'})).rejects.toMatchObject({status:409});
  expect((await app.get(PaymentHistoryService).listForUser('steam-b')).payments.map(x=>x.id)).toContain(p.id);
  expect((await pool.query<{user_id:string}>('SELECT user_id FROM steam_refill_payments WHERE id=$1',[p.id])).rows[0]?.user_id).toBe('old-email');
 });
 it('disables new guest contexts and quotes while keeping existing status readable',async()=>{
  const g=await guest();const {p}=await purchase(g,'guest-toggle@example.test','guest-toggle');
  const config=app.get<AppConfig>(APP_CONFIG);const original=config.commerce;
  if(!original)throw new Error('Commerce config missing');
  config.commerce={...original,guestSteamRefillEnabled:false};
  try{
   await request(server).post('/payments/guest/context').expect(503);
   await request(server).post('/payments/guest/steam-refill/quotes').set('Cookie',g.cookie).set('x-csrf-token',g.csrf).send({amountRub:500,steamLogin:'receiver',email:'guest-disabled@example.test'}).expect(503);
   await request(server).get(`/payments/guest/steam-refill/sessions/${p.id}`).set('Cookie',g.cookie).expect(200);
  }finally{config.commerce=original;}
 });
 it('sets a secure isolated cookie, reuses its context, and rejects expired contexts',async()=>{
  const g=await guest();
  expect(g.setCookie).toMatch(/^__Host-shards_guest_payment=/);
  for(const attribute of ['HttpOnly','Secure','SameSite=Lax','Path=/','Max-Age=2592000'])expect(g.setCookie).toContain(attribute);
  expect(g.setCookie).not.toContain('Domain=');
  const repeat=await request(server).post('/payments/guest/context').set('Cookie',g.cookie).expect(201);
  expect(repeat.body).toEqual({id:g.id,csrfToken:g.csrf});
  const expiry=await pool.query<{remaining:number}>('SELECT extract(epoch FROM expires_at-now())::integer AS remaining FROM guest_payment_contexts WHERE id=$1',[g.id]);
  expect(expiry.rows[0]?.remaining).toBeGreaterThan(2591900);
  expect(expiry.rows[0]?.remaining).toBeLessThanOrEqual(2592000);
  const {p}=await purchase(g,'guest-expiry@example.test','guest-expiry');
  await pool.query("UPDATE guest_payment_contexts SET expires_at=now()-interval '1 second' WHERE id=$1",[g.id]);
  await request(server).get(`/payments/guest/steam-refill/sessions/${p.id}`).set('Cookie',g.cookie).expect(401);
  await request(server).post('/payments/guest/steam-refill/quotes').set('Cookie',g.cookie).set('x-csrf-token',g.csrf).send({amountRub:500,steamLogin:'receiver',email:'guest-expiry@example.test'}).expect(401);
 });
 it('rejects another guest and customer CSRF tokens and cross-site context creation',async()=>{
  const a=await guest(),b=await guest();
  const sessions=app.get(SessionsService);const customer=await sessions.createSession('steam-a',null);
  const body={amountRub:500,steamLogin:'receiver',email:'guest-csrf@example.test'};
  for(const csrf of [b.csrf,sessions.createCsrfToken(customer.token)]){
   await request(server).post('/payments/guest/steam-refill/quotes').set('Cookie',a.cookie).set('x-csrf-token',csrf).send(body).expect(403);
  }
  await request(server).post('/payments/guest/steam-refill/quotes').set('Cookie',`${CUSTOMER_SESSION_COOKIE}=${customer.token}`).set('x-csrf-token',sessions.createCsrfToken(customer.token)).send(body).expect(401);
  await request(server).post('/payments/guest/context').set('sec-fetch-site','cross-site').expect(403);
 });
 it('matches a payment created concurrently with verification of the same email',async()=>{
  const g=await guest();
  const response=await request(server).post('/payments/guest/steam-refill/quotes').set('Cookie',g.cookie).set('x-csrf-token',g.csrf).send({amountRub:500,steamLogin:'receiver',email:'guest-race@example.test'}).expect(200);
  const quote=response.body as PaymentQuoteDto;
  const [purchaseResponse]=await Promise.all([
   request(server).post('/payments/guest/steam-refill/sessions').set('Cookie',g.cookie).set('x-csrf-token',g.csrf).set('Idempotency-Key','guest-race').send({quoteId:quote.quoteId,acceptedFiatMinor:quote.fiatAmountMinor}).expect(200),
   app.get(UsersService).upsertEmailUser('guest-race@example.test','guest-race-owner'),
  ]);
  const payment=purchaseResponse.body as Payment;
  const history=await app.get(PaymentHistoryService).listForUser('guest-race-owner');
  expect(history.payments.map(p=>p.id)).toEqual([payment.id]);
  expect((await app.get(OrdersService).listUserOrders('guest-race-owner')).orders).toHaveLength(1);
 });
 it('replays a captured callback after matching without duplicating orders or changing the wallet',async()=>{
  const g=await guest();const {p,quote}=await purchase(g,'guest-replay@example.test','guest-replay');
  await app.get(UsersService).upsertEmailUser('guest-replay@example.test','guest-replay-owner');
  const before=await app.get(OrdersService).listUserOrders('guest-replay-owner');
  expect(before.orders).toHaveLength(1);
  await pool.query("UPDATE steam_refill_payments SET provider_session_id='guest-replay-provider' WHERE id=$1",[p.id]);
  const event={providerEventId:'guest-replay-captured',eventType:'payment.captured',providerPaymentId:null,providerSessionId:'guest-replay-provider',topUpPaymentId:p.id,providerStatus:'captured',amountMinor:quote.fiatAmountMinor,currency:'RUB',payloadSnapshot:{}};
  const payments=app.get(PaymentsService);
  expect((await payments['processVerifiedArcoPayWebhook'](event)).status).toBe('processed');
  expect((await payments['processVerifiedArcoPayWebhook'](event)).status).toBe('duplicate');
  const after=await app.get(OrdersService).listUserOrders('guest-replay-owner');
  expect(after.orders).toHaveLength(1);
  const stored=await pool.query<{order_id:string}>('SELECT order_id FROM steam_refill_payments WHERE id=$1',[p.id]);
  expect(after.orders[0]?.id).toBe(stored.rows[0]?.order_id);
  expect((await pool.query('SELECT * FROM orders WHERE id=$1',[stored.rows[0]?.order_id])).rowCount).toBe(1);
  expect((await app.get(PaymentHistoryService).listForUser('guest-replay-owner')).payments.map(payment=>payment.id)).toEqual([p.id]);
  expect((await pool.query('SELECT * FROM wallet_ledger_entries')).rowCount).toBe(0);
  expect((await pool.query('SELECT * FROM wallet_holds')).rowCount).toBe(0);
  expect((await pool.query('SELECT * FROM top_up_payments')).rowCount).toBe(0);
 });

});
