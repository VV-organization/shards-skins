import { describe, expect, it } from "vitest";

import { canonicalSteamId64, steamAccountId } from "./steam-identity";

describe("Steam identity helpers", () => {
  it("accepts canonical positive uint64 SteamID64 values", () => {
    expect(canonicalSteamId64("76561198000000001")).toBe("76561198000000001");
    expect(steamAccountId("76561198000000001")).toBe("39734273");
  });

  it("rejects non-canonical or out-of-range Steam IDs", () => {
    expect(() => canonicalSteamId64("001")).toThrow("SteamID64 is not canonical");
    expect(() => canonicalSteamId64("0")).toThrow("SteamID64 is out of range");
    expect(() => canonicalSteamId64("18446744073709551616")).toThrow("SteamID64 is out of range");
  });
});
