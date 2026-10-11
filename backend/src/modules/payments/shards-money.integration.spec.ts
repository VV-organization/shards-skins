import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { PaymentsService } from './payments.service';
import { UsersService } from '../users/users.service';
const databaseUrl = process.env.SHARDS_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('Shards payment money snapshots', () => {
  let app: INestApplication;
  let pool: Pool;
  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    pool = new Pool({connectionString:databaseUrl});
    app = (await Test.createTestingModule({imports:[AppModule]}).compile()).createNestApplication();
    await app.init();
    await app.get(UsersService).upsertSteamUser({steamId64:'76561198000000199', claimedIdentifier:'https://steamcommunity.com/openid/id/76561198000000199', providerEndpoint:'https://steamcommunity.com/openid/login', responseNonce:'fixture'});
  });
  afterAll(async () => { await app.close(); await pool.end(); delete process.env.DATABASE_URL; });
  it('stores 8/5 displayed terms and replays historical terms without repricing or crediting', async () => {
    const command = { userId:'user_76561198000000199', idempotencyKey:'shards-money-snapshot', coinAmountMinor:10100 };
    const payments = app.get(PaymentsService);
    const first = await payments.createTopUpSession(command);
    expect(first).toMatchObject({coinAmountMinor:10100, fiatAmountMinor:6313, rate:{fiatMinor:100,coinMinor:160}});
    await pool.query('UPDATE top_up_payments SET rate_coin_minor=150, fiat_amount_minor=6734 WHERE id=$1',[first.id]);
    const replay = await payments.createTopUpSession(command);
    expect(replay).toMatchObject({id:first.id, fiatAmountMinor:6734, rate:{coinMinor:150}});
    const rows = await pool.query<{count:number}>('SELECT count(*)::int AS count FROM wallet_ledger_entries');
    expect(rows.rows[0]?.count).toBe(0);
  });
});
