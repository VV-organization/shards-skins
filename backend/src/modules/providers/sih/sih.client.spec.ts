import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  SihClient,
  SihProviderError,
  type SihFetch,
} from "./sih.client";

async function secretFile(name = "api-key", value = "test-secret-key"): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "shards-sih-"));
  const file = join(directory, name);
  await writeFile(file, `${value}\n`, { mode: 0o600 });
  return file;
}

const apiKeyFile = secretFile;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return new Response(JSON.stringify(body), {
    ...init,
    headers,
    status: init.status ?? 200,
  });
}

describe("SihClient", () => {
  it("fetches bounded SIH catalog items with file-backed api key and integer supplier prices", async () => {
    const seen: { url: string | undefined; apikey: string | undefined; signal: AbortSignal | undefined } = {
      apikey: undefined,
      signal: undefined,
      url: undefined,
    };
    const fetcher: SihFetch = (input, init) => {
      seen.url = input.toString();
      seen.apikey = new Headers(init?.headers).get("apikey") ?? undefined;
      seen.signal = init?.signal ?? undefined;
      return Promise.resolve(jsonResponse({
        success: true,
        items: {
          "AK-47 | Redline (Field-Tested)": {
            price: 1.011,
            count: 10,
            image: "-9a81dlWabc123abc123abc",
          },
          "AWP | Asiimov (Field-Tested)": {
            price: 15.79,
            count: 2,
            image: "https://steaminventoryhelper.com/cdn-cgi/imagedelivery/MvHeJSvDbl13NYkuyvKbPw/weapons/dd9f12f736ff63da9566/public",
          },
        },
      }));
    };
    const client = new SihClient({
      apiKeyFile: await apiKeyFile(),
      fetcher,
      marketBaseUrl: "https://api.sih.market",
      maximumBodyBytes: 4_096,
      requestTimeoutMs: 1_000,
      steamRefillBaseUrl: "https://core.steaminventoryhelper.com",
    });

    const items = await client.getItems({ game: "cs2" });

    expect(seen.url).toBe("https://api.sih.market/api/v1/get-items?appId=730&minified=false&extended=true");
    expect(seen.apikey).toBe("test-secret-key");
    expect(seen.signal).toBeInstanceOf(AbortSignal);
    expect(items).toEqual([
      {
        availableQuantity: 10,
        game: "cs2",
        imageUrl: "https://community.cloudflare.steamstatic.com/economy/image/-9a81dlWabc123abc123abc",
        marketHashName: "AK-47 | Redline (Field-Tested)",
        priceMicrousd: 1_011_000n,
      },
      {
        availableQuantity: 2,
        game: "cs2",
        imageUrl: null,
        marketHashName: "AWP | Asiimov (Field-Tested)",
        priceMicrousd: 15_790_000n,
      },
    ]);
  });

  it("redacts secrets and bounds provider response bodies", async () => {
    const fetcher: SihFetch = () => Promise.resolve(new Response(
      JSON.stringify({
        success: true,
        items: {
          "test-secret-key leaked by provider": {
            price: 1.01,
            count: 1,
          },
        },
      }),
      {
        headers: {
          "content-length": "9000",
          "content-type": "application/json",
        },
        status: 200,
      },
    ));
    const client = new SihClient({
      apiKeyFile: await apiKeyFile(),
      fetcher,
      marketBaseUrl: "https://api.sih.market",
      maximumBodyBytes: 1_024,
      requestTimeoutMs: 1_000,
      steamRefillBaseUrl: "https://core.steaminventoryhelper.com",
    });

    await expect(client.getItems({ game: "cs2" })).rejects.toMatchObject({
      code: "SIH_RESPONSE_TOO_LARGE",
      disposition: "retryable",
    });
    await expect(client.getItems({ game: "cs2" })).rejects.not.toThrow(/test-secret-key/);
  });

  it("checks and pays Steam refill through the separate public API header", async () => {
    const requests: Array<{ path: string; apiKey: string | null; body: unknown }> = [];
    const fetcher: SihFetch = (input, init) => {
      const url = new URL(input.toString());
      if (typeof init?.body !== "string") throw new Error("Expected JSON request body");
      requests.push({
        path: url.pathname,
        apiKey: new Headers(init.headers).get("api-key"),
        body: JSON.parse(init.body) as unknown,
      });
      if (url.pathname.endsWith("/steam/check")) {
        return Promise.resolve(jsonResponse({
          success: true,
          message: "Steam account found successfully",
          transactionId: "d34cb700-fcf9-4cab-89b1-7a6b552a0df5",
        }));
      }
      return Promise.resolve(jsonResponse({
        status: "success",
        message: "Payment completed successfully",
        paymentAmount: 50,
        cashback: 0.003,
      }));
    };
    const client = new SihClient({
      apiKeyFile: await secretFile("market-api-key", "market-secret-key"),
      fetcher,
      marketBaseUrl: "https://api.sih.market",
      maximumBodyBytes: 4_096,
      requestTimeoutMs: 1_000,
      steamRefillApiKeyFile: await secretFile("steam-refill-api-key", "steam-refill-secret-key"),
      steamRefillBaseUrl: "https://core.steaminventoryhelper.com",
    });

    const check = await client.checkSteamAccount({ steamUsername: "igb53" });
    const paid = await client.paySteamRefill({
      amountRub: 50,
      steamUsername: "igb53",
      transactionId: check.transactionId,
    });

    expect(requests).toEqual([
      {
        path: "/p/api/v1.0/steam/check",
        apiKey: "steam-refill-secret-key",
        body: { steamUsername: "igb53" },
      },
      {
        path: "/p/api/v1.0/steam/pay",
        apiKey: "steam-refill-secret-key",
        body: {
          amount: 50,
          currency: "RUB",
          steamUsername: "igb53",
          transactionId: "d34cb700-fcf9-4cab-89b1-7a6b552a0df5",
        },
      },
    ]);
    expect(paid).toEqual({
      cashbackUsd: 3_000n,
      paymentAmountRub: 5_000n,
      status: "success",
    });
  });

  it("accepts idempotent Steam refill pay responses with zero cashback", async () => {
    const fetcher: SihFetch = () => Promise.resolve(jsonResponse({
      cashback: 0,
      message: "Payment already completed",
      paymentAmount: 50,
      status: "success",
    }));
    const client = new SihClient({
      apiKeyFile: await apiKeyFile(),
      fetcher,
      marketBaseUrl: "https://api.sih.market",
      maximumBodyBytes: 4_096,
      requestTimeoutMs: 1_000,
      steamRefillApiKeyFile: await secretFile("steam-refill-api-key"),
      steamRefillBaseUrl: "https://core.steaminventoryhelper.com",
    });

    await expect(client.paySteamRefill({
      amountRub: 50,
      steamUsername: "igb53",
      transactionId: "d34cb700-fcf9-4cab-89b1-7a6b552a0df5",
    })).resolves.toEqual({
      cashbackUsd: 0n,
      paymentAmountRub: 5_000n,
      status: "success",
    });
  });

  it("requires a separate Steam refill api key file for Steam refill requests", async () => {
    const fetcher: SihFetch = () => Promise.resolve(jsonResponse({ success: true }));
    const client = new SihClient({
      apiKeyFile: await secretFile("market-api-key", "market-secret-key"),
      fetcher,
      marketBaseUrl: "https://api.sih.market",
      maximumBodyBytes: 4_096,
      requestTimeoutMs: 1_000,
      steamRefillBaseUrl: "https://core.steaminventoryhelper.com",
    });

    await expect(client.checkSteamAccount({ steamUsername: "igb53" })).rejects.toMatchObject({
      code: "SIH_CONFIGURATION_INVALID",
      disposition: "permanent",
    });
  });

  it("treats a rejected Steam account check as a permanent provider rejection", async () => {
    const fetcher: SihFetch = () => Promise.resolve(jsonResponse({
      message: "Аккаунт Steam herald.winston не найден: User not found",
      success: false,
    }));
    const client = new SihClient({
      apiKeyFile: await secretFile("market-api-key"),
      fetcher,
      marketBaseUrl: "https://api.sih.market",
      maximumBodyBytes: 4_096,
      requestTimeoutMs: 1_000,
      steamRefillApiKeyFile: await secretFile("steam-refill-api-key"),
      steamRefillBaseUrl: "https://core.steaminventoryhelper.com",
    });

    await expect(client.checkSteamAccount({ steamUsername: "herald.winston" })).rejects.toMatchObject({
      code: "SIH_REQUEST_REJECTED",
      disposition: "permanent",
    });
  });

  it("creates SIH skin purchase orders with customId and exact micro-USD amount", async () => {
    const seen: { apiKey: string | null; body: unknown; path: string } = {
      apiKey: null,
      body: undefined,
      path: "",
    };
    const fetcher: SihFetch = (input, init) => {
      const url = new URL(input.toString());
      if (typeof init?.body !== "string") throw new Error("Expected JSON request body");
      seen.path = url.pathname;
      seen.apiKey = new Headers(init.headers).get("apikey");
      seen.body = JSON.parse(init.body) as unknown;
      return Promise.resolve(jsonResponse({
        balance: 99.123456,
        id: 42,
        success: true,
      }));
    };
    const client = new SihClient({
      apiKeyFile: await apiKeyFile(),
      fetcher,
      marketBaseUrl: "https://api.sih.market",
      maximumBodyBytes: 4_096,
      requestTimeoutMs: 1_000,
      steamRefillBaseUrl: "https://core.steaminventoryhelper.com",
    });

    const created = await client.createSkinOrder({
      amountMicrousd: 1_011_000n,
      customId: "12504cd4-f6f0-4396-b577-9bf22746ca94",
      game: "cs2",
      marketHashName: "AK-47 | Redline (Field-Tested)",
      steamId64: "76561198027391269",
      test: true,
      tradeToken: "SSH18JS",
    });

    expect(seen).toEqual({
      apiKey: "test-secret-key",
      path: "/api/v1/create-order",
      body: {
        amount: 1.011,
        appId: 730,
        customId: "12504cd4-f6f0-4396-b577-9bf22746ca94",
        item: "AK-47 | Redline (Field-Tested)",
        steamId: "76561198027391269",
        test: true,
        token: "SSH18JS",
      },
    });
    expect(created).toEqual({
      providerBalanceMicrousd: 99_123_456n,
      providerOrderId: "42",
      projection: "create_acknowledgement",
    });
  });

  it("returns the existing SIH order when create-order replays a duplicate customId", async () => {
    const customId = "12504cd4-f6f0-4396-b577-9bf22746ca94";
    const fetcher: SihFetch = () => Promise.resolve(jsonResponse({
      error: "custom id already exists",
      order: {
        amount: 1.011,
        customId,
        id: 42,
        item: "AK-47 | Redline (Field-Tested)",
        status: "processing",
        steamId: "76561198027391269",
      },
      success: false,
    }, { status: 409 }));
    const client = new SihClient({
      apiKeyFile: await apiKeyFile(),
      fetcher,
      marketBaseUrl: "https://api.sih.market",
      maximumBodyBytes: 4_096,
      requestTimeoutMs: 1_000,
      steamRefillBaseUrl: "https://core.steaminventoryhelper.com",
    });

    await expect(client.createSkinOrder({
      amountMicrousd: 1_011_000n,
      customId,
      game: "cs2",
      marketHashName: "AK-47 | Redline (Field-Tested)",
      steamId64: "76561198027391269",
      test: true,
      tradeToken: "SSH18JS",
    })).resolves.toMatchObject({
      amountMicrousd: 1_011_000n,
      customId,
      marketHashName: "AK-47 | Redline (Field-Tested)",
      providerOrderId: "42",
      projection: "order",
      status: "processing",
    });
  });

  it("looks up SIH orders by customId with trade protection details", async () => {
    const requests: Array<{ path: string; customId: string | null }> = [];
    const customId = "12504cd4-f6f0-4396-b577-9bf22746ca94";
    const fetcher: SihFetch = (input) => {
      const url = new URL(input.toString());
      requests.push({ path: url.pathname, customId: url.searchParams.get("customId") });
      return Promise.resolve(jsonResponse({
        order: {
          amount: 1.011,
          customId,
          expectedAmount: 1.01,
          id: 43,
          item: "AK-47 | Redline (Field-Tested)",
          protection: {
            error: "rollback user",
            rollbackAmount: 1.01,
            rollbackAt: 1783468800,
            status: "failed",
          },
          sender: {
            offerId: 44,
          },
          status: "finished",
          steamId: "76561198027391269",
        },
        success: true,
      }));
    };
    const client = new SihClient({
      apiKeyFile: await apiKeyFile(),
      fetcher,
      marketBaseUrl: "https://api.sih.market",
      maximumBodyBytes: 4_096,
      requestTimeoutMs: 1_000,
      steamRefillBaseUrl: "https://core.steaminventoryhelper.com",
    });

    const order = await client.getSkinOrder({ customId });

    expect(requests).toEqual([{ path: "/api/v1/get-order", customId }]);
    expect(order).toEqual({
      amountMicrousd: 1_011_000n,
      customId,
      expectedAmountMicrousd: 1_010_000n,
      marketHashName: "AK-47 | Redline (Field-Tested)",
      offerId: "44",
      projection: "order",
      protection: {
        error: "rollback user",
        rollbackAmountMicrousd: 1_010_000n,
        rollbackAt: new Date("2026-07-08T00:00:00.000Z"),
        status: "failed",
      },
      providerOrderId: "43",
      status: "finished",
      steamId64: "76561198027391269",
    });
  });

  it("rejects invalid configuration before making provider calls", async () => {
    expect(() => new SihClient({
      fetcher: () => Promise.resolve(jsonResponse({ success: true, items: {} })),
      marketBaseUrl: "https://api.sih.market",
      maximumBodyBytes: 0,
      requestTimeoutMs: 1_000,
      steamRefillBaseUrl: "https://core.steaminventoryhelper.com",
    })).toThrow("SIH_CLIENT_OPTIONS_INVALID");

    const client = new SihClient({
      fetcher: () => Promise.resolve(jsonResponse({ success: true, items: {} })),
      marketBaseUrl: "https://api.sih.market",
      maximumBodyBytes: 4_096,
      requestTimeoutMs: 1_000,
      steamRefillBaseUrl: "https://core.steaminventoryhelper.com",
    });

    await expect(client.getItems({ game: "cs2" })).rejects.toBeInstanceOf(SihProviderError);
    await expect(client.getItems({ game: "cs2" })).rejects.toMatchObject({
      code: "SIH_CONFIGURATION_INVALID",
      disposition: "permanent",
    });
  });
});
