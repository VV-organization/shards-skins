import { describe, expect, it, vi } from "vitest";
import { parseCatalogGame, parseCatalogPublicGames } from "./catalog-game";
import { CatalogService } from "./catalog.service";
import { CatalogSupplierSyncService } from "./catalog-supplier-sync.service";
import { IntegrationHealthService } from "../integration/integration-health.service";
import { IntegrationService } from "../integration/integration.service";
import { loadAppConfig } from "../../config/app-config";

describe("Shards product boundary", () => {
  it("catalog health and admin capabilities do not depend on Apple", async () => {
    const config=loadAppConfig({NODE_ENV:"test"});
    const query=vi.fn().mockResolvedValueOnce({rows:[{total:"4"}]}).mockResolvedValue({rows:[{total:"0"}]});
    const health=new IntegrationHealthService({query} as never,config);
    await expect(health.visibleCatalog()).resolves.toMatchObject({status:"ok",total:4});
    expect(new IntegrationService(config).manifest()).not.toHaveProperty("storeOrders");
  });
  it("accepts only CS2 in public configuration and query parsing", () => {
    expect(parseCatalogPublicGames(undefined)).toEqual(["cs2"]);
    expect(parseCatalogGame("rust")).toBeNull();
    expect(parseCatalogGame("tf2")).toBeNull();
    expect(() => parseCatalogPublicGames("cs2,rust")).toThrow();
  });
  it("scopes even direct slug queries to CS2 skins", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const service = new CatalogService({ query } as never, {} as never);
    await expect(service.getBySlug("foreign-product")).rejects.toThrow();
    expect(query.mock.calls[0]?.[0]).toContain("catalog_products.kind = 'skins'");
    expect(query.mock.calls[0]?.[0]).toContain("lower(catalog_products.game) = 'cs2'");
  });
  it("rejects unsupported sync before supplier I/O", async () => {
    const getItems = vi.fn();
    const service = new CatalogSupplierSyncService({} as never, {} as never);
    await expect(service.syncSihGame({ game: "rust", client: { getItems } })).rejects.toThrow("CATALOG_GAME_UNSUPPORTED");
    expect(getItems).not.toHaveBeenCalled();
  });
});
