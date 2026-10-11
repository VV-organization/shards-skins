import { describe, expect, it } from "vitest";

import {
  STEAM_REFILL_MAX_RUB,
  STEAM_REFILL_MIN_RUB,
  parseSteamRefillAmountRub,
} from "./steam-refill-product";

describe("steam refill amount parser", () => {
  it("accepts only whole SIH RUB amounts inside the provider bounds", () => {
    expect(parseSteamRefillAmountRub(`steam-top-up-${STEAM_REFILL_MIN_RUB}-rub`)).toBe(STEAM_REFILL_MIN_RUB);
    expect(parseSteamRefillAmountRub(`steam-top-up-${STEAM_REFILL_MAX_RUB}-rub`)).toBe(STEAM_REFILL_MAX_RUB);

    expect(parseSteamRefillAmountRub("steam-top-up-49-rub")).toBeNull();
    expect(parseSteamRefillAmountRub("steam-top-up-9434-rub")).toBeNull();
    expect(parseSteamRefillAmountRub("steam-top-up-100.5-rub")).toBeNull();
    expect(parseSteamRefillAmountRub("steam-top-up-rub")).toBeNull();
  });
});
