import { describe, expect, it } from 'vitest';
import { loadAppConfig } from './app-config';
import { buildDatabaseConnectionOptions } from '../common/database/database.config';

describe('Shards isolation boundaries', () => {
  it('refuses production boot without durable storage', () => {
    expect(() => loadAppConfig({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
  });
  it('refuses a production database fallback even for manually constructed config', () => {
    expect(() => buildDatabaseConnectionOptions({ ...loadAppConfig({}), nodeEnv: 'production' })).toThrow(/DATABASE_URL/);
  });
  it('refuses production boot with missing identity encryption secrets', () => {
    expect(() => loadAppConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://localhost/shards' })).toThrow(/SECRET|KEY/);
  });
  it('disables new money movement by default', () => {
    expect(loadAppConfig({})).toMatchObject({ commerce: { checkoutEnabled: false, paymentsEnabled: false, fulfillmentEnabled: false } });
  });
  it('uses its own local origin and port', () => {
    const config = loadAppConfig({});
    expect(config.port).toBe(5199);
    expect(config.integration.publicOrigin).toBe('https://shards.example');
  });
});
