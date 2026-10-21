import request from "supertest";
import { APP_CONFIG } from "../../config/app-config.module";
import { loadAppConfig } from "../../config/app-config";
import { CUSTOMER_SESSION_COOKIE } from "../sessions/session-cookies";
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { EmailAuthRuntimeProvider, EmailAuthService } from './email-auth.service';
import { UsersService } from '../users/users.service';
import { SessionsService } from '../sessions/sessions.service';
const databaseUrl=process.env.SHARDS_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('durable email ownership binding',()=>{
  let app:INestApplication;let pool:Pool;
  beforeAll(async()=>{process.env.DATABASE_URL=databaseUrl;pool=new Pool({connectionString:databaseUrl});app=(await Test.createTestingModule({imports:[AppModule]}).overrideProvider(APP_CONFIG).useValue(loadAppConfig({...process.env, SHARDS_PAYMENTS_ENABLED:"true",SHARDS_FULFILLMENT_ENABLED:"true"})).overrideProvider(EmailAuthRuntimeProvider).useValue({createCode:()=> '123456',now:()=>new Date()}).compile()).createNestApplication();await app.init();});
  afterAll(async()=>{await app.close();await pool.end();delete process.env.DATABASE_URL;});
  it('persists linking purpose, rejects foreign email and keeps the original session',async()=>{
    const users=app.get(UsersService);const sessions=app.get(SessionsService);const email=app.get(EmailAuthService);
    const oldOwner=await users.upsertSteamUser({steamId64:'76561198000000201',claimedIdentifier:'https://steamcommunity.com/openid/id/76561198000000201',providerEndpoint:'https://steamcommunity.com/openid/login',responseNonce:'fixture'});
    await users.upsertEmailUser('taken@example.test',oldOwner.id);
    const steam=await users.upsertSteamUser({steamId64:'76561198000000200',claimedIdentifier:'https://steamcommunity.com/openid/id/76561198000000200',providerEndpoint:'https://steamcommunity.com/openid/login',responseNonce:'fixture'});
    const session=await sessions.createSession(steam.id,null);
    const challenge=await email.requestChallenge('taken@example.test',{purpose:'link_email',presentedSessionToken:session.token});
    const stored=await pool.query<{purpose:string;target_user_id:string}>('SELECT purpose,target_user_id FROM email_verification_challenges WHERE id=$1',[challenge.id]);
    expect(stored.rows[0]).toEqual({purpose:'link_email',target_user_id:steam.id});
    await expect(email.verifyChallenge({challengeId:challenge.id,code:'123456',presentedSessionToken:session.token})).rejects.toMatchObject({status:409});
    expect((await sessions.authenticate(session.token))?.userId).toBe(steam.id);
    expect((await users.requireUser(oldOwner.id)).email?.address).toBe('taken@example.test');
    const fresh=await email.requestChallenge('free@example.test',{purpose:'link_email',presentedSessionToken:session.token});
    await expect(email.verifyChallenge({challengeId:fresh.id,code:'123456',presentedSessionToken:session.token})).resolves.toMatchObject({userId:steam.id});
  });
  it('requires verified identity for direct Steam and Steam identity for a Shards top-up',async()=>{
    const server=app.getHttpServer() as Parameters<typeof request>[0];
    await request(server).post('/payments/steam-refill/sessions').send({amountRub:50,email:'forged@example.test',steamLogin:'buyer'}).expect(401);
    const sessions=app.get(SessionsService);
    const user=await app.get(UsersService).upsertEmailUser('direct@example.test');
    const session=await sessions.createSession(user.id,null);
    await request(server).get('/wallet/me').set('Cookie',`${CUSTOMER_SESSION_COOKIE}=${session.token}`).expect(403);
    await request(server).post('/payments/top-up/sessions').set('Cookie',`${CUSTOMER_SESSION_COOKIE}=${session.token}`).set('x-csrf-token',sessions.createCsrfToken(session.token)).set('idempotency-key','email-topup-forbidden').send({coinAmountMinor:10000}).expect(400);
    const rows=await pool.query<{count:number}>('SELECT count(*)::int AS count FROM top_up_payments');
    expect(rows.rows[0]?.count).toBe(0);
  });

});
