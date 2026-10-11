import {Test} from '@nestjs/testing';
import type {INestApplication} from '@nestjs/common';
import {Pool} from 'pg';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {IntegrationHealthService} from './integration-health.service';
import {AppModule} from '../../app.module';
import {VvAdminOutboxService,type VvAdminIntegrationEvent} from './vv-admin-outbox.service';
import {NotificationOutboxService} from '../notifications/notification-outbox.service';
const databaseUrl=process.env.SHARDS_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('outbox crash recovery',()=>{
 let app:INestApplication,pool:Pool;
 beforeAll(async()=>{process.env.DATABASE_URL=databaseUrl;pool=new Pool({connectionString:databaseUrl});app=(await Test.createTestingModule({imports:[AppModule]}).compile()).createNestApplication();await app.init();});
 afterAll(async()=>{await app.close();await pool.end();delete process.env.DATABASE_URL;});
 it('recovers VV delivery without changing logical event ID and fences old workers',async()=>{
  const outbox=app.get(VvAdminOutboxService);
  const event:VvAdminIntegrationEvent={schemaVersion:2,eventId:'stable-event',eventType:'order.created',source:'customer',occurredAt:new Date().toISOString(),site:{domain:'shards.test'},subject:{type:'order',externalId:'order'},data:{status:'created'}};
  await outbox.enqueue(event);const first=await outbox.claimNext();expect(first).not.toBeNull();
  await pool.query("UPDATE vv_admin_integration_outbox SET locked_at=now()-interval '4 minutes'");
  const second=await outbox.claimNext();expect(second?.eventId).toBe(first?.eventId);expect(second?.attemptCount).toBe(2);
  if(!first||!second)throw new Error('claims missing');
  await outbox.markAccepted(first.id,200,first.attemptCount);expect((await pool.query<{status:string}>('SELECT status FROM vv_admin_integration_outbox')).rows[0]?.status).toBe('processing');
  await outbox.markAccepted(second.id,200,second.attemptCount);await outbox.markRetryableFailure(first.id,'OLD',first.attemptCount);expect((await pool.query<{status:string}>('SELECT status FROM vv_admin_integration_outbox')).rows[0]?.status).toBe('accepted');
  expect((await outbox.enqueue(event)).id).toBe(first.id);expect(await outbox.claimNext()).toBeNull();
 });
 it('recovers notification leases with stable idempotency and fences stale acknowledgements',async()=>{
  const outbox=app.get(NotificationOutboxService);await outbox.enqueue({channel:'email',eventType:'fixture',entityId:'entity',idempotencyKey:'stable-message',payload:{}});
  const first=await outbox.claimNext();await pool.query("UPDATE notification_outbox SET locked_at=now()-interval '4 minutes'");const second=await outbox.claimNext();expect(second?.idempotencyKey).toBe('stable-message');expect(second?.attemptCount).toBe(2);
  if(!first||!second)throw new Error('claims missing');await outbox.markAccepted(first.id,'late',first.attemptCount);expect((await pool.query<{status:string}>('SELECT status FROM notification_outbox')).rows[0]?.status).toBe('processing');await outbox.markAccepted(second.id,'accepted',second.attemptCount);expect(await outbox.claimNext()).toBeNull();
 });
 it('does not send a terminal event ahead of its retrying created event',async()=>{
  const outbox=app.get(VvAdminOutboxService);
  const event:VvAdminIntegrationEvent={schemaVersion:2,eventId:'ordered-created',eventType:'order.created',source:'customer',occurredAt:new Date().toISOString(),site:{domain:'shards.test'},subject:{type:'order',externalId:'ordered'},data:{status:'created'}};
  await outbox.enqueue(event);const first=await outbox.claimNext();if(!first)throw new Error('claim missing');
  await outbox.markRetryableFailure(first.id,'TIMEOUT',first.attemptCount);
  await outbox.enqueue({...event,eventId:'ordered-completed',eventType:'order.completed'});expect(await outbox.claimNext()).toBeNull();
  await pool.query("UPDATE vv_admin_integration_outbox SET available_at=now(),created_at=now()-interval '20 minutes' WHERE event_id='ordered-created'");
  const metrics=await app.get(IntegrationHealthService).operations();expect(metrics.stalled_outbox).toBe(1);
  const retry=await outbox.claimNext();if(!retry)throw new Error('claim missing');expect(retry.eventId).toBe('ordered-created');await outbox.markAccepted(retry.id,200,retry.attemptCount);expect((await outbox.claimNext())?.eventId).toBe('ordered-completed');
 });

});
