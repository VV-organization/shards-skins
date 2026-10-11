import { expect, it } from 'vitest';
import { requireSafeTestDatabase } from './test-database';
it('rejects missing, foreign and nonlocal databases before any reset', () => {
  for (const target of [undefined, 'postgres://foreign_test:x@localhost/foreign_test', 'postgres://shards_test:x@production/shards_test', 'postgres://root:x@localhost/shards_test', 'postgres://shards_test:x@localhost/shards', 'https://shards_test:x@localhost/shards_test']) {
    expect(() => requireSafeTestDatabase(target)).toThrow();
  }
});
it('accepts only explicitly isolated local test targets', () => {
  expect(requireSafeTestDatabase('postgres://shards_test:local@127.0.0.1:55440/shards_test')).toContain('/shards_test');
});
