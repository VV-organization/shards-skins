import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../app.module';
import { APP_CONFIG } from '../../config/app-config.module';
import { loadAppConfig } from '../../config/app-config';
import { ArcoPayClient } from '../providers/arco-pay/arco-pay.client';
import { PaymentsService } from './payments.service';
import { SYNTHETIC_PAYMENT_USER_ID } from './synthetic-payment';
const databaseUrl = process.env.SHARDS_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('synthetic payment isolation', () => {
 let app: INestApplication, pool: Pool, payments: PaymentsService;
 const create = vi.fn((command: { externalId: string }) => Promise.resolve({providerSessionId: `provider-${command.externalId}`, checkoutUrl: `https://payment.paidlayer.com/provider-${command.externalId}`}));
 beforeAll(async () => {
  pool = new Pool({connectionString: databaseUrl});
  const config = loadAppConfig({ NODE_ENV:'test', DATABASE_URL:databaseUrl, SHARDS_PAYMENTS_ENABLED:'true' });
  config.arcoPay={...config.arcoPay,providerMode:'real',apiKeyFile:'/fixture/key',bearerTokenFile:'/fixture/token',shopId:'1',callbackUrl:'https://shards.example/api/payments/webhooks/arco-pay',publicKeyFile:'/fixture/public-key',publicOrigin:'https://shards.example'};
  const module = await Test.createTestingModule({imports:[AppModule]}).overrideProvider(APP_CONFIG).useValue(config).overrideProvider(ArcoPayClient).useValue({createHostedCheckout:create}).compile();
  app=module.createNestApplication();await app.init();payments=app.get(PaymentsService);
 });
 afterAll(async()=>{await app.close();await pool.end();});
 beforeEach(async()=>{create.mockClear();await pool.query('TRUNCATE top_up_payments,steam_refill_payments,payment_provider_attempts,vv_admin_integration_outbox,notification_outbox,wallet_ledger_entries,wallet_transactions,wallet_holds,payment_webhook_events');});
 const command = (id:string)=>({userId:SYNTHETIC_PAYMENT_USER_ID,idempotencyKey:id,coinAmountMinor:10000});
 it('serializes concurrent runs to one provider invoice, replays same run, and preserves reconciliation',async()=>{
  const results=await Promise.allSettled([payments.createTopUpSession(command('run-1')),payments.createTopUpSession(command('run-2'))]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);expect(create).toHaveBeenCalledTimes(1);
  const rows=await pool.query<{id:string;idempotency_key:string;status:string}>("SELECT id,idempotency_key,status FROM top_up_payments");expect(rows.rows).toHaveLength(1);expect(rows.rows[0]?.status).toBe('checkout_pending');
  const stored=rows.rows[0];if(!stored)throw new Error('Missing synthetic payment');
  expect((await payments.createTopUpSession(command(stored.idempotency_key))).id).toBe(rows.rows[0]?.id);expect(create).toHaveBeenCalledTimes(1);
  await pool.query("UPDATE top_up_payments SET status='manual_review',metadata=metadata||'{\"paymentStatusUnresolved\":true}'::jsonb");
  await expect(payments.createTopUpSession(command('run-3'))).rejects.toThrow('SCENARIO_ATTEMPT_REQUIRES_REVIEW');expect(create).toHaveBeenCalledTimes(1);
  expect((await pool.query("SELECT payload->>'source' AS source FROM vv_admin_integration_outbox")).rows).toEqual([{source:'scenario'}]);
  expect((await pool.query('SELECT * FROM wallet_ledger_entries')).rowCount).toBe(0);expect((await pool.query('SELECT * FROM notification_outbox')).rowCount).toBe(0);
 });
 it('retains and accounts late settlement only in the technical wallet, with no customer notifications',async()=>{
  const payment=await payments.createTopUpSession(command('late-run'));
  const event={providerEventId:'synthetic-capture',eventType:'payment.captured',providerPaymentId:null,providerSessionId:`provider-${payment.id}`,topUpPaymentId:payment.id,providerStatus:'captured',amountMinor:6250,currency:'RUB',payloadSnapshot:{}};
  expect((await payments['processVerifiedArcoPayWebhook'](event)).status).toBe('processed');expect((await payments['processVerifiedArcoPayWebhook'](event)).status).toBe('duplicate');
  expect((await pool.query('SELECT user_id,amount_coin_minor FROM wallet_ledger_entries WHERE user_id IS NOT NULL')).rows).toEqual([{user_id:SYNTHETIC_PAYMENT_USER_ID,amount_coin_minor:10000}]);
  expect((await pool.query('SELECT sum(amount_coin_minor)::integer AS balance FROM wallet_ledger_entries')).rows).toEqual([{balance:0}]);
  expect((await pool.query("SELECT DISTINCT payload->>'source' AS source FROM vv_admin_integration_outbox")).rows).toEqual([{source:'scenario'}]);
  expect((await pool.query('SELECT * FROM notification_outbox')).rowCount).toBe(0);
 });
 it('allows a new run after authoritative provider failure, never from local timeout',async()=>{
  const payment=await payments.createTopUpSession(command('old-run'));
  const event={providerEventId:'synthetic-expired',eventType:'payment.expired',providerPaymentId:null,providerSessionId:`provider-${payment.id}`,topUpPaymentId:payment.id,providerStatus:'expired',amountMinor:6250,currency:'RUB',payloadSnapshot:{}};
  expect((await payments['processVerifiedArcoPayWebhook'](event)).status).toBe('processed');
  expect((await payments.createTopUpSession(command('new-run'))).id).not.toBe(payment.id);expect(create).toHaveBeenCalledTimes(2);
 });
});
