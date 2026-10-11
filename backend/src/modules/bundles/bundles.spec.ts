import { describe, expect, it } from "vitest";
import { bundleMarketName, bundleSupplierNames, discountedBundlePrices, requireBundleId } from "./bundles.service";

describe("server bundle arithmetic and identity", () => {
  it("rounds once and allocates residual cents deterministically", () => {
    expect(discountedBundlePrices([101, 101, 101])).toEqual([96, 96, 96]);
    expect(discountedBundlePrices([110, 110, 110])).toEqual([105, 105, 104]);
    for (let price = 100; price < 200; price++) {
      const prices = [price, price + 13, price + 29];
      expect(discountedBundlePrices(prices).reduce((a, b) => a + b, 0)).toBe(Math.round(prices.reduce((a, b) => a + b, 0) * 95 / 100));
    }
  });
  it("rejects forged bundle identifiers and invalid prices", () => {
    for (const id of ["other", "__proto__", "constructor"]) expect(() => requireBundleId(id)).toThrow();
    expect(() => discountedBundlePrices([100, 100])).toThrow();
    expect(() => discountedBundlePrices([100, -1, 100])).toThrow();
  });
  it("enumerates exact supplier variants without admitting StatTrak or other finishes", () => {
    const names = bundleSupplierNames(["Karambit | Fade", "AK-47 | Asiimov"]);
    expect(names).toHaveLength(24);
    expect(new Set(names).size).toBe(24);
    expect(names).toContain("★ Karambit | Fade (Factory New)");
    expect(names).toContain("AK-47 | Asiimov (Battle-Scarred)");
    expect(names).not.toContain("StatTrak™ AK-47 | Asiimov (Field-Tested)");
    expect(names).not.toContain("Karambit | Marble Fade (Factory New)");
    expect(names.every(name => ["Karambit | Fade", "AK-47 | Asiimov"].includes(bundleMarketName(name)))).toBe(true);
  });
  it("normalizes only known wear suffixes and the knife/glove prefix", () => {
    expect(bundleMarketName("★ Karambit | Fade (Factory New)")).toBe("Karambit | Fade");
    expect(bundleMarketName("StatTrak™ AK-47 | Asiimov (Field-Tested)")).toBe("StatTrak™ AK-47 | Asiimov");
  });
});
