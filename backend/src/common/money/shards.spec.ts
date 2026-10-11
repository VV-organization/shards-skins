import { expect, it } from 'vitest';
import { rubToShardsMinor, shardsToRubReferenceMinor, topUpFiatMinor, sumShardsMinor } from './shards';
it('converts RUB and Shards with half-up integer rounding', () => {
  expect(rubToShardsMinor(100000)).toBe(160000);
  expect(shardsToRubReferenceMinor(2362080)).toBe(1476300);
  expect(rubToShardsMinor(1)).toBe(2);
  expect(shardsToRubReferenceMinor(4)).toBe(3);
  expect(shardsToRubReferenceMinor(sumShardsMinor([101,102]))).toBe(127);
});
it('charges only whole Shards top-ups inside limits', () => {
  expect(topUpFiatMinor(100000)).toBe(62500);
  expect(topUpFiatMinor(10100)).toBe(6313);
  for (const n of [10001,9999,10000100,-1,NaN,Infinity]) expect(() => topUpFiatMinor(n)).toThrow();
});
it('rejects unsafe amounts and totals', () => {
  for (const n of [-1,NaN,Infinity,0.1,Number.MAX_SAFE_INTEGER+1]) {
    expect(() => rubToShardsMinor(n)).toThrow();
    expect(() => shardsToRubReferenceMinor(n)).toThrow();
  }
  expect(() => rubToShardsMinor(Number.MAX_SAFE_INTEGER)).toThrow();
  expect(() => sumShardsMinor([Number.MAX_SAFE_INTEGER,1])).toThrow();
});
