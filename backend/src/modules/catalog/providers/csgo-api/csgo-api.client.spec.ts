import { afterEach, describe, expect, it, vi } from "vitest";

import { CsgoApiClient } from "./csgo-api.client";

describe("CsgoApiClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches and parses the pinned Russian CS2 metadata document", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      "skin-ak-redline": {
        id: "skin-ak-redline",
        name: "AK-47 | Красная линия",
        market_hash_name: "AK-47 | Redline (Field-Tested)",
        image: "https://cdn.example/cs2/ak.png",
        category: { id: "rifles", name: "Автоматы" },
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json", etag: "\"fixture\"" },
    }))));

    const result = await new CsgoApiClient({ maximumBodyBytes: 10_000, requestTimeoutMs: 1_000 }).fetch({
      game: "cs2",
      locale: "ru",
      marketHashNames: ["AK-47 | Redline (Field-Tested)"],
    });

    expect(result).toMatchObject({
      provider: "csgo_api",
      game: "cs2",
      locale: "ru",
      sourceItemCount: 1,
      filteredOutCount: 0,
    });
    expect(result.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.metadata).toEqual({
      sourceCommit: "5e01f938a115de71a5be644c5b198d93abc6a3cf",
      sourceEtag: "\"fixture\"",
    });
    expect(result.items.map((item) => item.marketHashName)).toEqual(["AK-47 | Redline (Field-Tested)"]);
  });
});
