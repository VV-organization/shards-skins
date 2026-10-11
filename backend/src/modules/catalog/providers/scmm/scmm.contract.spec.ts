import { describe, expect, it } from "vitest";

import { createScmmSnapshot, parseScmmPage } from "./scmm.contract";

describe("SCMM metadata contract", () => {
  it("maps Rust metadata into publishable catalog metadata", () => {
    const page = parseScmmPage({
      page: 1,
      pageSize: 1,
      total: "1",
      items: [{
        appId: "252490",
        id: "123",
        nameHash: "Metal Facemask",
        name: "Metal Facemask",
        itemType: "Mask",
        iconUrl: "https://cdn.example/rust/metal-facemask.png",
        description: "Protects the face.",
        tags: [{ category: "scmmcat", value: "Armor" }],
        itemShortName: "metal.facemask",
        workshopFileId: "0",
      }],
    }, { pageSize: 1, requestedStart: 0 });

    const snapshot = createScmmSnapshot([page], new Set(["Metal Facemask"]), new Date("2026-07-31T10:00:00.000Z"));

    expect(snapshot).toMatchObject({
      provider: "scmm",
      game: "rust",
      locale: "en",
      sourceUrl: "https://api.scmm.app/api/item",
      sourceItemCount: 1,
      filteredOutCount: 0,
    });
    expect(snapshot.items).toEqual([
      expect.objectContaining({
        provider: "scmm",
        game: "rust",
        locale: "en",
        marketHashName: "Metal Facemask",
        title: "Metal Facemask",
        description: "Protects the face.",
        categoryName: "Armor",
        productType: "Mask",
        imageUrl: "https://cdn.example/rust/metal-facemask.png",
        tags: ["Armor", "Mask"],
      }),
    ]);
  });
});
