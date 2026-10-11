/** Must run before constructing a pool or executing destructive fixture SQL. */
export function requireSafeTestDatabase(target: string | undefined): string {
  if (!target) throw new Error('SHARDS_TEST_DATABASE_URL is required. Use isolated shards_test.');
  const url = new URL(target);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', 'postgres-test'].includes(url.hostname) || url.pathname !== '/shards_test' || url.username !== 'shards_test' || url.search || url.hash) {
    throw new Error('Refusing to reset a database other than local shards_test owned by shards_test.');
  }
  return target;
}
