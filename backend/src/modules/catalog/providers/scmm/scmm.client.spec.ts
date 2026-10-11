import { afterEach, describe, expect, it, vi } from "vitest";

import { ScmmClient } from "./scmm.client";

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof Request ? input.url : input.toString();
}

describe("ScmmClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches Rust SCMM pages and returns only requested market hashes", async () => {
    const fetchSpy = vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify({
      page: 1,
      pageSize: 1,
      total: 1,
      items: [{
        appId: 252490,
        id: 123,
        nameHash: "Metal Facemask",
        name: "Metal Facemask",
        itemType: "Mask",
        iconUrl: "https://cdn.example/rust/metal-facemask.png",
        tags: [{ category: "scmmcat", value: "Armor" }],
      }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await new ScmmClient({
      maximumBodyBytesPerPage: 10_000,
      pageConcurrency: 1,
      pageSize: 1,
      requestTimeoutMs: 1_000,
    }).fetch({
      game: "rust",
      locale: "en",
      marketHashNames: ["Metal Facemask"],
    });

    expect(result.items.map((item) => item.marketHashName)).toEqual(["Metal Facemask"]);
    expect(result.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    const firstRequest = fetchSpy.mock.calls[0]?.[0];
    if (firstRequest === undefined) throw new Error("missing SCMM fetch request");
    const url = new URL(requestUrl(firstRequest));
    expect(url.origin + url.pathname).toBe("https://api.scmm.app/api/item");
    expect(url.searchParams.get("page")).toBe("1");
    expect(url.searchParams.get("pageSize")).toBe("1");
    expect(url.searchParams.has("start")).toBe(false);
    expect(url.searchParams.has("count")).toBe(false);
  });
});
