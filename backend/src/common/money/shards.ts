/** Canonical Shards money. All inputs/outputs are integer hundredths. */
function minor(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('MONEY_AMOUNT_INVALID');
  return BigInt(value);
}
function safe(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('MONEY_AMOUNT_OVERFLOW');
  return Number(value);
}
export function rubToShardsMinor(rubMinor: number): number {
  return safe((minor(rubMinor) * 8n + 2n) / 5n);
}
export function shardsToRubReferenceMinor(shardsMinor: number): number {
  return safe((minor(shardsMinor) * 5n + 4n) / 8n);
}
export function topUpFiatMinor(shardsMinor: number): number {
  const amount = minor(shardsMinor);
  if (amount < 10_000n || amount > 10_000_000n || amount % 100n !== 0n) throw new RangeError('TOP_UP_AMOUNT_INVALID');
  return safe((amount * 5n + 7n) / 8n);
}
export function sumShardsMinor(amounts: readonly number[]): number {
  return safe(amounts.reduce((total, value) => total + minor(value), 0n));
}
