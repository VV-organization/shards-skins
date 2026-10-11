import test from "node:test";
import assert from "node:assert/strict";
import { parseAmount, shardsToRub, rubToShards, steamQuote, sumPrices } from "../src/lib/money.ts";

test("парсер: десятичный ввод без потери копеек", () => {
  assert.equal(parseAmount("1 000,50"), 100050);
  assert.equal(parseAmount("0.01"), 1);
  for (const value of ["", "-1", "NaN", "Infinity", "1e8", "1.001", "9".repeat(30)]) assert.equal(parseAmount(value), null);
});
test("курс 1 рубль = 1,6 Shards в обе стороны", () => {
  assert.equal(shardsToRub(160), 100);
  assert.equal(shardsToRub(100000), 62500);
  assert.equal(rubToShards(100000), 160000);
  assert.equal(shardsToRub(1), 1);
});
test("Steam 5% сверху, округление справочной котировки половина вверх", () => {
  assert.deepEqual(steamQuote(100000), { amount:100000, fee:5000, total:105000 });
  assert.deepEqual(steamQuote(250000), { amount:250000, fee:12500, total:262500 });
  assert.deepEqual(steamQuote(10), { amount:10, fee:1, total:11 });
  assert.throws(() => steamQuote(-1));
});
test("итог переводит общую сумму Shards с единственным округлением", () => {
  assert.deepEqual(sumPrices([1,1]), { shards:2, rub:1 });
  assert.deepEqual(sumPrices([100,200]), { shards:300, rub:188 });
});

test("fractional conversion rounds half up and rejects invalid money",()=>{assert.equal(shardsToRub(4),3);assert.equal(rubToShards(1),2);assert.equal(shardsToRub(160001),100001);assert.throws(()=>shardsToRub(-1));assert.throws(()=>rubToShards(NaN));});

test('top-up preview enforces whole Shards and never silently rounds an invalid request', async () => {
  const { topUpFiatMinor, topUpForShortfall } = await import('../src/lib/money.ts');
  assert.equal(topUpFiatMinor(10100), 6313);
  assert.throws(() => topUpFiatMinor(10001));
  assert.equal(topUpForShortfall(1), 10000);
  assert.equal(topUpForShortfall(10001), 10100);
  assert.equal(topUpForShortfall(10000001), null);
});
