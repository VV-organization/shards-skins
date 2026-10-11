import { createHash } from "node:crypto";

import { normalizeCatalogDescription } from "../../catalog-description";
import type { CatalogMetadataLocale } from "../../catalog-game";
import type { CatalogMetadataItemInput } from "../../catalog-metadata.types";

const categoryByPrefix: Readonly<Record<string, readonly [string, string]>> = {
  agent: ["agents", "Агенты"],
  collectible: ["collectibles", "Коллекционные предметы"],
  crate: ["containers", "Контейнеры"],
  graffiti: ["graffiti", "Граффити"],
  key: ["keys", "Ключи"],
  keychain: ["keychains", "Брелоки"],
  music: ["music_kits", "Музыкальные наборы"],
  patch: ["patches", "Нашивки"],
  sticker: ["stickers", "Наклейки"],
  tool: ["tools", "Инструменты"],
};

function invalid(): never {
  throw new Error("CSGO_API_METADATA_INVALID");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalText(value: unknown, maximumLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength || value.trim() !== value) {
    invalid();
  }
  return value;
}

function optionalText(value: unknown, maximumLength: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  return canonicalText(value, maximumLength);
}

function optionalHttpsUrl(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const normalized = canonicalText(value, 2_048);
  try {
    const url = new URL(normalized);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "") invalid();
  } catch {
    invalid();
  }
  return normalized;
}

function categoryOf(providerItemId: string, item: Record<string, unknown>): { categoryId: string; categoryName: string } {
  if (item.category !== undefined && item.category !== null) {
    if (!isRecord(item.category)) invalid();
    return {
      categoryId: canonicalText(item.category.id, 128),
      categoryName: canonicalText(item.category.name, 256),
    };
  }
  const prefix = providerItemId.split("-", 1)[0] ?? "";
  const fallback = categoryByPrefix[prefix] ?? ["other", "Другое"];
  return { categoryId: fallback[0], categoryName: fallback[1] };
}

function rarityNameOf(item: Record<string, unknown>): string | null {
  if (item.rarity === undefined || item.rarity === null) return null;
  if (!isRecord(item.rarity)) invalid();
  return canonicalText(item.rarity.name, 256);
}

function uniqueTags(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => value !== null && value.trim() !== ""))];
}

export function mapCsgoApiItem(
  documentKey: string,
  value: unknown,
  locale: CatalogMetadataLocale,
): CatalogMetadataItemInput | null {
  if (locale !== "ru") invalid();
  if (!isRecord(value)) invalid();
  const providerItemId = canonicalText(value.id, 256);
  if (documentKey !== providerItemId) invalid();
  if (value.market_hash_name === undefined || value.market_hash_name === null) return null;
  const marketHashName = canonicalText(value.market_hash_name, 512);
  const category = categoryOf(providerItemId, value);
  const rarityName = rarityNameOf(value);
  return {
    provider: "csgo_api",
    game: "cs2",
    locale,
    marketHashName,
    providerItemId,
    title: canonicalText(value.name, 1_024),
    description: normalizeCatalogDescription(optionalText(value.description, 65_536)),
    categoryName: category.categoryName,
    productType: category.categoryName,
    rarityName,
    imageUrl: optionalHttpsUrl(value.image),
    tags: uniqueTags([category.categoryName, rarityName]),
    raw: value,
  };
}

export function collapseCsgoApiMetadataItems(sourceItems: readonly CatalogMetadataItemInput[]): CatalogMetadataItemInput[] {
  const byMarketHashName = new Map<string, CatalogMetadataItemInput>();
  for (const candidate of sourceItems) {
    const current = byMarketHashName.get(candidate.marketHashName);
    if (current === undefined || (candidate.providerItemId ?? "") < (current.providerItemId ?? "")) {
      byMarketHashName.set(candidate.marketHashName, candidate);
    }
  }
  return [...byMarketHashName.values()].sort((left, right) => left.marketHashName.localeCompare(right.marketHashName));
}

export function parseCsgoApiDocument(rawPayload: string, locale: CatalogMetadataLocale): CatalogMetadataItemInput[] {
  let document: unknown;
  try {
    document = JSON.parse(rawPayload);
  } catch {
    invalid();
  }
  if (!isRecord(document)) invalid();
  const items: CatalogMetadataItemInput[] = [];
  for (const [documentKey, value] of Object.entries(document)) {
    const item = mapCsgoApiItem(documentKey, value, locale);
    if (item !== null) items.push(item);
  }
  return collapseCsgoApiMetadataItems(items);
}

export function hashCsgoApiPayload(rawPayload: string): string {
  return createHash("sha256").update(rawPayload).digest("hex");
}
