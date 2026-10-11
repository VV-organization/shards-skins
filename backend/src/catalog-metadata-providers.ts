import { CsgoApiClient } from "./modules/catalog/providers/csgo-api/csgo-api.client";
import { CatalogMetadataProviderRegistry } from "./modules/catalog/providers/metadata/catalog-metadata-provider.registry";

export function createCatalogMetadataProviderRegistry(): CatalogMetadataProviderRegistry {
  return new CatalogMetadataProviderRegistry([
    new CsgoApiClient({
      maximumBodyBytes: 100 * 1024 * 1024,
      requestTimeoutMs: 60_000,
    }),
  ]);
}
