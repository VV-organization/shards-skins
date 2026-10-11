import { requireSafeTestDatabase } from './common/database/test-database';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { beforeAll } from 'vitest';

// Every test file gets a freshly migrated fixture DB, so catalog cleanup cannot erase another suite's seed.
const target = requireSafeTestDatabase(process.env.SHARDS_TEST_DATABASE_URL);
beforeAll(async () => {
const pool = new Pool({ connectionString: target });
try {
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public');
  await migrate(drizzle(pool), { migrationsFolder: './drizzle/migrations' });
} finally { await pool.end(); }
});
