import test from "node:test";
import assert from "node:assert/strict";
import { parseAmount, prismToRub, rubToPrism, steamQuote, sumPrices } from "../src/lib/money.ts";

test("парсер: десятичный ввод без потери копеек", () => {
  assert.equal(parseAmount("1 000,50"), 100050);
  assert.equal(parseAmount("0.01"), 1);
  for (const value of ["", "-1", "NaN", "Infinity", "1e8", "1.001", "9".repeat(30)]) assert.equal(parseAmount(value), null);
});
test("курс PRISM 1,5 в обе стороны", () => {
  assert.equal(prismToRub(100), 150);
  assert.equal(prismToRub(10000), 15000);
  assert.equal(rubToPrism(150000), 100000);
  assert.equal(prismToRub(1), 2);
});
test("Steam 5% сверху, округление справочной котировки половина вверх", () => {
  assert.deepEqual(steamQuote(100000), { amount:100000, fee:5000, total:105000 });
  assert.deepEqual(steamQuote(250000), { amount:250000, fee:12500, total:262500 });
  assert.deepEqual(steamQuote(10), { amount:10, fee:1, total:11 });
  assert.throws(() => steamQuote(-1));
});
test("итог переводит общую сумму PRISM с единственным округлением", () => {
  assert.deepEqual(sumPrices([1,1]), { prism:2, rub:3 });
  assert.deepEqual(sumPrices([100,200]), { prism:300, rub:450 });
});
