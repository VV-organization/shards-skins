import { describe, expect, it } from "vitest";

import { parseCs2MetadataImages } from "./catalog-sync-cs2-images";

describe("parseCs2MetadataImages", () => {
  it("keeps only public HTTPS image URLs keyed by market hash name", () => {
    const images = parseCs2MetadataImages(JSON.stringify({
      "weapon-ak-redline": {
        category: { id: "rifles", name: "Винтовки" },
        description: "Мощная и надежная винтовка с русским описанием.",
        id: "weapon-ak-redline",
        image: "https://community.akamai.steamstatic.com/economy/image/abc123",
        market_hash_name: "AK-47 | Redline (Field-Tested)",
        name: "AK-47 | Красная линия",
        rarity: { color: "#d32ce6", id: "classified", name: "Засекреченное" },
      },
      "weapon-awp-asiimov": {
        category: { id: "rifles", name: "Винтовки" },
        description: "Снайперская винтовка с русским описанием.",
        id: "weapon-awp-asiimov",
        image: "https://raw.githubusercontent.com/ByMykel/counter-strike-image-tracker/main/static/panorama/images/econ/default_generated/weapon_awp_cu_awp_asimov_light_png.png",
        market_hash_name: "AWP | Asiimov (Field-Tested)",
        name: "AWP | Азимов",
      },
      "blocked-sih": {
        category: { id: "other", name: "Другое" },
        description: "Этот товар нельзя публиковать с SIH CDN.",
        id: "blocked-sih",
        image: "https://steaminventoryhelper.com/cdn-cgi/imagedelivery/MvHeJSvDbl13NYkuyvKbPw/weapons/dd9f12/public",
        market_hash_name: "Blocked SIH item",
        name: "Заблокированный SIH товар",
      },
      "sticker-capsule": {
        description: "В этой капсуле содержатся разнообразные наклейки от художников из мастерской Steam.",
        id: "crate-4847",
        image: "https://community.akamai.steamstatic.com/economy/image/capsule123",
        market_hash_name: "10 Year Birthday Sticker Capsule",
        name: "Капсула наклеек десятилетнего юбилея",
        rarity: { color: "#b0c3d9", id: "common", name: "базового класса" },
      },
      "no-market-hash": {
        id: "no-market-hash",
        image: "https://community.akamai.steamstatic.com/economy/image/skip",
      },
    }));

    expect(images).toEqual([
      {
        categoryName: "Капсулы",
        conditionName: null,
        description: "В этой капсуле содержатся разнообразные наклейки от художников из мастерской Steam.",
        imageUrl: "https://community.akamai.steamstatic.com/economy/image/capsule123",
        inferredProductType: "Капсула",
        marketHashName: "10 Year Birthday Sticker Capsule",
        rarityName: "базового класса",
        title: "Капсула наклеек десятилетнего юбилея",
      },
      {
        categoryName: "Винтовки",
        conditionName: "После полевых испытаний",
        description: "Мощная и надежная винтовка с русским описанием.",
        imageUrl: "https://community.akamai.steamstatic.com/economy/image/abc123",
        inferredProductType: "Автомат",
        marketHashName: "AK-47 | Redline (Field-Tested)",
        rarityName: "Засекреченное",
        title: "AK-47 | Красная линия",
      },
      {
        categoryName: "Винтовки",
        conditionName: "После полевых испытаний",
        description: "Снайперская винтовка с русским описанием.",
        imageUrl: "https://raw.githubusercontent.com/ByMykel/counter-strike-image-tracker/main/static/panorama/images/econ/default_generated/weapon_awp_cu_awp_asimov_light_png.png",
        inferredProductType: "Снайперская винтовка",
        marketHashName: "AWP | Asiimov (Field-Tested)",
        rarityName: null,
        title: "AWP | Азимов",
      },
    ]);
  });
});
