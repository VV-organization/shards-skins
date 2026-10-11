import { describe, expect, it } from "vitest";

import { parseCsgoApiDocument } from "./csgo-api.contract";

describe("CSGO-API metadata contract", () => {
  it("maps Russian CS2 metadata into publishable catalog metadata", () => {
    const items = parseCsgoApiDocument(JSON.stringify({
      "skin-ak-redline": {
        id: "skin-ak-redline",
        name: "AK-47 | Красная линия",
        market_hash_name: "AK-47 | Redline (Field-Tested)",
        description: "Проверенный скин<br>для CS2",
        image: "https://cdn.example/cs2/ak.png",
        category: { id: "rifles", name: "Автоматы" },
        rarity: { id: "classified", name: "Засекреченное", color: "#d32ce6" },
      },
    }), "ru");

    expect(items).toEqual([
      expect.objectContaining({
        provider: "csgo_api",
        game: "cs2",
        locale: "ru",
        marketHashName: "AK-47 | Redline (Field-Tested)",
        title: "AK-47 | Красная линия",
        description: "Проверенный скин\nдля CS2",
        categoryName: "Автоматы",
        productType: "Автоматы",
        rarityName: "Засекреченное",
        imageUrl: "https://cdn.example/cs2/ak.png",
        tags: ["Автоматы", "Засекреченное"],
      }),
    ]);
  });
});
