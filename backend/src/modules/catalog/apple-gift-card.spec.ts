import { describe, expect, it } from "vitest";

import { parseAppleGiftCardDetails } from "./apple-gift-card";

describe("parseAppleGiftCardDetails", () => {
  it("accepts a complete immutable Apple-card region and nominal", () => {
    expect(parseAppleGiftCardDetails({
      fulfillment: { description: "Код отправляется на подтверждённый email.", requirements: ["Регион Apple ID должен совпадать."], title: "Ручная выдача" },
      appleGiftCard: { currency: "USD", nominalMinor: 2500, regionCode: "US", regionLabel: "США" },
      specifications: [{ label: "Регион", value: "США" }],
    })).toEqual({
      fulfillment: { description: "Код отправляется на подтверждённый email.", requirements: ["Регион Apple ID должен совпадать."], title: "Ручная выдача" },
      appleGiftCard: { currency: "USD", nominalMinor: 2500, regionCode: "US", regionLabel: "США" },
      specifications: [{ label: "Регион", value: "США" }],
    });
  });

  it("rejects an Apple-card nominal without an explicit region", () => {
    expect(parseAppleGiftCardDetails({
      fulfillment: { description: "Код отправляется на подтверждённый email.", requirements: [], title: "Ручная выдача" },
      appleGiftCard: { currency: "USD", nominalMinor: 2500, regionCode: "", regionLabel: "" },
      specifications: [],
    })).toBeNull();
  });
});
