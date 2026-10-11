import { afterEach, describe, expect, it, vi } from "vitest";

import { Tf2AutobotClient } from "./tf2-autobot.client";

describe("Tf2AutobotClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches TF2 metadata target by target and skips 404 misses", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      success: true,
      schemaItems: {
        defindex: 5021,
        item_name: "Mann Co. Supply Crate Key",
        item_type_name: "Tool",
        image_url_large: "https://media.steampowered.com/apps/440/icons/key_large.png",
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }))));

    const result = await new Tf2AutobotClient({
      concurrency: 1,
      maximumBodyBytes: 10_000,
      requestTimeoutMs: 1_000,
      runTimeoutMs: 10_000,
    }).fetch({
      game: "tf2",
      locale: "en",
      marketHashNames: ["Mann Co. Supply Crate Key"],
    });

    expect(result.items.map((item) => item.marketHashName)).toEqual(["Mann Co. Supply Crate Key"]);
    expect(result.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
