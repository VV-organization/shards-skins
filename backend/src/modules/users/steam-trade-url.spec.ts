import { describe, expect, it } from "vitest";

import { parseOwnedTradeUrl } from "./steam-trade-url";

describe("parseOwnedTradeUrl", () => {
  it("accepts only the authenticated user's official Steam Trade URL", () => {
    expect(parseOwnedTradeUrl(
      "https://steamcommunity.com/tradeoffer/new/?partner=39734273&token=abc_DEF-123",
      "76561198000000001",
    )).toEqual({ partner: "39734273", token: "abc_DEF-123" });
  });

  it("rejects Trade URLs for another Steam account or malformed hosts", () => {
    expect(() => parseOwnedTradeUrl(
      "https://steamcommunity.com/tradeoffer/new/?partner=39734274&token=abc",
      "76561198000000001",
    )).toThrow("Invalid Steam Trade URL");
    expect(() => parseOwnedTradeUrl(
      "https://evil.example/tradeoffer/new/?partner=39734273&token=abc",
      "76561198000000001",
    )).toThrow("Invalid Steam Trade URL");
  });
});
