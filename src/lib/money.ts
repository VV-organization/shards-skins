/** Minor units are hundredths; preview rounding is half-up, not a live payment contract. */
export const SHARDS_PER_RUBLE = 1.6;
export const STEAM_FEE_PERCENT = 5;
const MAX_MINOR = 999_999_999;

export function parseAmount(value: string): number | null {
  const clean = value.trim().replace(/[ \u00a0\u202f]/g, "").replace(",", ".");
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(clean)) return null;
  const [whole, fraction = ""] = clean.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(minor) && minor <= MAX_MINOR ? minor : null;
}
function validMinor(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MINOR) throw new RangeError("Invalid money amount");
}
export function shardsToRub(shardsMinor: number) {
  validMinor(shardsMinor);
  return Number((BigInt(shardsMinor) * 5n + 4n) / 8n);
}
export function rubToShards(rubMinor: number) {
  validMinor(rubMinor);
  return Number((BigInt(rubMinor) * 8n + 2n) / 5n);
}
export function steamQuote(amount: number) {
  validMinor(amount);
  const fee = Number((BigInt(amount) * 5n + 50n) / 100n);
  return { amount, fee, total: amount + fee };
}
export function sumPrices(prices: readonly number[]) {
  const shards=prices.reduce((sum,price)=>{validMinor(price);return sum+price;},0);
  if(!Number.isSafeInteger(shards))throw new RangeError("Invalid total");
  return {shards,rub:Number((BigInt(shards)*5n+4n)/8n)};
}
export function formatMinor(minor: number, digits = 2) {
  return (minor / 100).toLocaleString("ru-RU", { minimumFractionDigits:0, maximumFractionDigits:digits });
}
export function inputAmount(minor: number) {
  return (minor / 100).toFixed(2).replace(/\.00$/, "").replace(".", ",");
}
