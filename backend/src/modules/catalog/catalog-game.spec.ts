import { describe, expect, it } from "vitest";

import {
  CATALOG_GAMES,
  getCatalogGameDefinition,
  isCatalogGame,
  parseCatalogGame,
  parseCatalogPublicGames,
} from "./catalog-game";

describe("catalog game model", () => {
  it("accepts only the Shards game set", () => {
    expect(CATALOG_GAMES).toEqual(["cs2"]);
    expect(isCatalogGame("cs2")).toBe(true);
    expect(isCatalogGame("rust")).toBe(false);
    expect(isCatalogGame("tf2")).toBe(false);
    expect(isCatalogGame("dota2")).toBe(false);
    expect(parseCatalogGame("CS2")).toBe("cs2");
    expect(parseCatalogGame("Team Fortress 2")).toBeNull();
  });

  it("exposes provider metadata definitions for every supported game", () => {
    expect(getCatalogGameDefinition("cs2")).toMatchObject({
      key: "cs2",
      label: "CS2",
      steamAppId: 730,
      sihAppId: 730,
      metadataProvider: "csgo_api",
      metadataLocale: "ru",
      metadataRequiredForPublication: false,
    });
    expect(getCatalogGameDefinition("rust")).toMatchObject({
      key: "rust",
      label: "Rust",
      steamAppId: 252490,
      sihAppId: 252490,
      metadataProvider: "scmm",
      metadataLocale: "en",
      metadataRequiredForPublication: true,
    });
    expect(getCatalogGameDefinition("tf2")).toMatchObject({
      key: "tf2",
      label: "Team Fortress 2",
      steamAppId: 440,
      sihAppId: 440,
      metadataProvider: "tf2_autobot",
      metadataLocale: "en",
      metadataRequiredForPublication: true,
    });
  });

  it("parses configured public games without accepting unsupported games", () => {
    expect(parseCatalogPublicGames(undefined)).toEqual(["cs2"]);
    expect(() => parseCatalogPublicGames("rust,cs2,tf2")).toThrow();
    expect(() => parseCatalogPublicGames("cs2,dota2")).toThrow("CATALOG_PUBLIC_GAMES contains unsupported game: dota2.");
  });
});
