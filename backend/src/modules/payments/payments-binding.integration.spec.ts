import {Test} from '@nestjs/testing';
import type {INestApplication} from '@nestjs/common';
import {Pool} from 'pg';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {AppModule} from '../../app.module';
import {SihClient} from '../providers/sih/sih.client';
import {PaymentsService} from './payments.service';
import {PaymentQuotesService} from './payment-quotes.service';
const databaseUrl=process.env.SHARDS_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('bound payment quotes',()=>{
 let app:INestApplication,pool:Pool,payments:PaymentQuotesService;
 beforeAll(async()=>{
  process.env.DATABASE_URL=databaseUrl;pool=new Pool({connectionString:databaseUrl});
  app=(await Test.createTestingModule({imports:[AppModule]}).overrideProvider(SihClient).useValue({checkSteamAccount:()=>Promise.resolve({transactionId:'prechecked-transaction'})}).compile()).createNestApplication();await app.init();payments=app.get(PaymentQuotesService);
  await pool.query("INSERT INTO users(id,steam_id64) VALUES ('wallet-owner','76561198000000510'),('email-owner',NULL),('other-owner',NULL)");
  await pool.query("INSERT INTO email_identities(email,user_id,verified_at) VALUES ('buyer@example.test','email-owner',now())");
 });
 afterAll(async()=>{await app.close();await pool.end();delete process.env.DATABASE_URL;});
 beforeEach(async()=>{await pool.query('TRUNCATE commerce_quotes,top_up_payments,steam_refill_payments,payment_provider_attempts,vv_admin_integration_outbox,notification_outbox,wallet_ledger_entries,wallet_transactions,wallet_holds,payment_webhook_events');});
 it('binds 1000 Shards to 625 RUB and replays the same payment after quote expiry',async()=>{
  const q=await payments.quoteWallet('wallet-owner',100000);expect(q.fiatAmountMinor).toBe(62500);
  const command={userId:'wallet-owner',purpose:'wallet_topup' as const,quoteId:q.quoteId,acceptedFiatMinor:62500,idempotencyKey:'quoted-wallet'};
  const first=await payments.createSession(command);await pool.query("UPDATE commerce_quotes SET expires_at=now()-interval '1 hour'");expect((await payments.createSession(command)).id).toBe(first.id);
  await expect(payments.createSession({...command,idempotencyKey:'another-key'})).rejects.toMatchObject({status:409});
  await expect(payments.createSession({...command,acceptedFiatMinor:1})).rejects.toMatchObject({status:409});
  await expect(payments.getSession('other-owner',first.id)).rejects.toMatchObject({status:404});
 });
 it('rejects expired quotes before creating payments',async()=>{
  const q=await payments.quoteWallet('wallet-owner',100000);await pool.query("UPDATE commerce_quotes SET expires_at=now()-interval '1 second'");
  await expect(payments.createSession({userId:'wallet-owner',purpose:'wallet_topup',quoteId:q.quoteId,acceptedFiatMinor:q.fiatAmountMinor,idempotencyKey:'expired'})).rejects.toMatchObject({status:409});expect((await pool.query('SELECT * FROM top_up_payments')).rowCount).toBe(0);
 });
 it('binds Steam login, verified email, fee and precheck without a Steam identity or wallet entries',async()=>{
  const q=await payments.quoteSteam('email-owner',50,'receiver');expect(q.fiatAmountMinor).toBe(5250);
  const payment=await payments.createSession({userId:'email-owner',purpose:'steam_refill',quoteId:q.quoteId,acceptedFiatMinor:5250,idempotencyKey:'direct-steam'});
  expect(await payments.getSession('email-owner',payment.id)).toMatchObject({purpose:'steam_refill',fulfillmentStatus:'not_started'});
  const snapshot=await pool.query<{metadata:{steamCheckTransactionId:string;contactEmail:string}}>('SELECT metadata FROM steam_refill_payments');expect(snapshot.rows[0]?.metadata).toMatchObject({steamCheckTransactionId:'prechecked-transaction',contactEmail:'buyer@example.test'});
  expect((await pool.query('SELECT * FROM wallet_ledger_entries')).rowCount).toBe(0);expect((await pool.query('SELECT * FROM wallet_holds')).rowCount).toBe(0);
 });
 it('rejects mismatched callback identity, environment, purpose, amount and currency; credits once',async()=>{
  const q=await payments.quoteWallet('wallet-owner',100000);const payment=await payments.createSession({userId:'wallet-owner',purpose:'wallet_topup',quoteId:q.quoteId,acceptedFiatMinor:q.fiatAmountMinor,idempotencyKey:'callback-wallet'});
  await pool.query("UPDATE top_up_payments SET provider_session_id='bound-provider' WHERE id=$1",[payment.id]);
  const service=app.get(PaymentsService);
  const event={providerEventId:'callback-ok',eventType:'payment.captured',providerPaymentId:null,providerSessionId:'bound-provider',topUpPaymentId:payment.id,providerStatus:'captured',amountMinor:q.fiatAmountMinor,currency:'RUB',payloadSnapshot:{}};
  for(const [index,change] of [{providerSessionId:'wrong-provider'},{amountMinor:1},{currency:'USD'},{payloadSnapshot:{metadata:{environment:'wrong'}}},{payloadSnapshot:{metadata:{purpose:'steam_refill'}}}].entries())expect((await service['processVerifiedArcoPayWebhook']({...event,...change,providerEventId:`wrong-${index}`})).status).not.toBe('processed');
  expect((await pool.query('SELECT * FROM wallet_ledger_entries')).rowCount).toBe(0);
  expect((await service['processVerifiedArcoPayWebhook'](event)).status).toBe('processed');expect((await service['processVerifiedArcoPayWebhook'](event)).status).toBe('duplicate');
  const balance=await pool.query<{amount:string}>("SELECT sum(amount_coin_minor)::text AS amount FROM wallet_ledger_entries WHERE user_id='wallet-owner'");expect(balance.rows[0]?.amount).toBe('100000');
 });
 it('enforces whole Steam bounds and verified identity',async()=>{
  for(const amount of [49,9434,50.5])await expect(payments.quoteSteam('email-owner',amount,'receiver')).rejects.toMatchObject({status:400});
  expect((await payments.quoteSteam('email-owner',9433,'receiver')).fiatAmountMinor).toBe(990465);
  await expect(payments.quoteSteam('other-owner',50,'receiver')).rejects.toMatchObject({status:400});
  await expect(payments.quoteWallet('email-owner',100000)).rejects.toMatchObject({status:400});
 });
});
