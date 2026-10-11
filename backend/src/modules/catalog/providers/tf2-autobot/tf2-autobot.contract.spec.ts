import { describe, expect, it } from "vitest";

import { createTf2AutobotSnapshot, parseTf2AutobotItem } from "./tf2-autobot.contract";

describe("TF2 Autobot metadata contract", () => {
  it("maps TF2 metadata into publishable catalog metadata", () => {
    const item = parseTf2AutobotItem({
      success: true,
      schemaItems: {
        defindex: 5021,
        item_name: "Mann Co. Supply Crate Key",
        item_type_name: "Tool",
        item_description: "Used to open crates.",
        image_url: "https://media.steampowered.com/apps/440/icons/key_small.png",
        image_url_large: "https://media.steampowered.com/apps/440/icons/key_large.png",
      },
    }, "Mann Co. Supply Crate Key");

    const snapshot = createTf2AutobotSnapshot(["Mann Co. Supply Crate Key"], [item], new Date("2026-07-31T10:00:00.000Z"));

    expect(snapshot).toMatchObject({
      provider: "tf2_autobot",
      game: "tf2",
      locale: "en",
      sourceUrl: "https://schema.autobot.tf/getItem/fromName",
      sourceItemCount: 1,
      filteredOutCount: 0,
    });
    expect(snapshot.items).toEqual([
      expect.objectContaining({
        provider: "tf2_autobot",
        game: "tf2",
        locale: "en",
        marketHashName: "Mann Co. Supply Crate Key",
        title: "Mann Co. Supply Crate Key",
        description: "Used to open crates.",
        categoryName: "Tool",
        productType: "Tool",
        imageUrl: "https://media.steampowered.com/apps/440/icons/key_large.png",
        tags: ["Tool"],
      }),
    ]);
  });
});
