import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { loadAppConfig } from "../../../config/app-config";
import { SihClient } from "./sih.client";
import type { SihCatalogGame, SihSupplierItem } from "./sih.types";

const apiKeyFile = process.env.SIH_API_KEY_FILE;
const acceptedGames = (process.env.SIH_ACCEPT_GAMES ?? "cs2")
  .split(",")
  .map((game) => game.trim())
  .filter(Boolean) as SihCatalogGame[];

function hashIdentity(item: SihSupplierItem): string {
  return createHash("sha256")
    .update(`${item.game}:${item.marketHashName}`, "utf8")
    .digest("hex")
    .slice(0, 16);
}

describe.skipIf(apiKeyFile === undefined)("SIH sandbox catalog acceptance", () => {
  it.each(acceptedGames)("fetches inventory and a point minimum for %s", async (game) => {
    if (apiKeyFile === undefined) throw new Error("SIH_API_KEY_FILE_REQUIRED");
    const narrowedApiKeyFile = apiKeyFile;
    const config = loadAppConfig({
      ...process.env,
      SIH_API_KEY_FILE: narrowedApiKeyFile,
    });
    const client = new SihClient({
      apiKeyFile: narrowedApiKeyFile,
      marketBaseUrl: config.sih.marketBaseUrl,
      maximumBodyBytes: config.sih.maximumBodyBytes,
      requestTimeoutMs: config.sih.requestTimeoutMs,
      steamRefillBaseUrl: config.sih.steamRefillBaseUrl,
    });

    const items = await client.getItems({ game });
    expect(items.length).toBeGreaterThan(0);
    const candidate = items.find((item) => item.availableQuantity > 0);
    expect(candidate).toBeDefined();
    if (candidate === undefined) throw new Error("SIH_SANDBOX_NO_AVAILABLE_ITEM");

    const minimum = await client.getMinimumItem({
      game,
      marketHashName: candidate.marketHashName,
    });
    expect(minimum?.priceMicrousd).toBeGreaterThan(0n);
    expect(minimum?.availableQuantity).toBeGreaterThan(0);

    console.info("SIH_SANDBOX_CATALOG_ACCEPTED", {
      count: items.length,
      game,
      item: hashIdentity(candidate),
    });
  });
});
