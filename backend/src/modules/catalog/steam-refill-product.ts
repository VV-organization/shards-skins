export const STEAM_REFILL_MIN_RUB = 50;
export const STEAM_REFILL_MAX_RUB = 9_433;

const steamRefillSlugPattern = /^steam-top-up-([1-9][0-9]*)-rub$/;

export function parseSteamRefillAmountRub(slug: string): number | null {
  const match = steamRefillSlugPattern.exec(slug);
  if (match === null || match[1] === undefined) return null;
  const amountRub = Number(match[1]);
  if (!Number.isSafeInteger(amountRub)) return null;
  if (amountRub < STEAM_REFILL_MIN_RUB || amountRub > STEAM_REFILL_MAX_RUB) return null;
  return amountRub;
}
