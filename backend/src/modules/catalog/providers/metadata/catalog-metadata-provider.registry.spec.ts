import { describe, expect, it, vi } from "vitest";

import type { CatalogMetadataProvider, CatalogMetadataProviderResult } from "./catalog-metadata-provider";
import { CatalogMetadataProviderRegistry } from "./catalog-metadata-provider.registry";

function client(
  game: CatalogMetadataProvider["game"],
  provider: CatalogMetadataProvider["provider"],
  locale: CatalogMetadataProvider["locale"],
): CatalogMetadataProvider {
  return {
    game,
    locale,
    provider,
    fetch: vi.fn<() => Promise<CatalogMetadataProviderResult>>(),
  };
}

describe("catalog metadata provider registry", () => {
  it("routes supported games to the provider required by the catalog game definition", () => {
    const cs2 = client("cs2", "csgo_api", "ru");
    const rust = client("rust", "scmm", "en");
    const tf2 = client("tf2", "tf2_autobot", "en");

    const registry = new CatalogMetadataProviderRegistry([cs2]);

    expect(registry.require("cs2")).toBe(cs2);
    expect(() => new CatalogMetadataProviderRegistry([rust])).toThrow();
    expect(() => new CatalogMetadataProviderRegistry([tf2])).toThrow();
    expect(registry.games()).toEqual(["cs2"]);
  });

  it("rejects missing, duplicate, or mismatched providers", () => {
    expect(() => new CatalogMetadataProviderRegistry([])).toThrow("CATALOG_METADATA_PROVIDER_REGISTRY_EMPTY");
    expect(() => new CatalogMetadataProviderRegistry([
      client("cs2", "csgo_api", "ru"),
      client("cs2", "csgo_api", "ru"),
    ])).toThrow("CATALOG_METADATA_PROVIDER_DUPLICATE_GAME");
    expect(() => new CatalogMetadataProviderRegistry([
      client("rust", "tf2_autobot", "en"),
    ])).toThrow("CATALOG_METADATA_PROVIDER_REGISTRATION_INVALID");
  });
});
