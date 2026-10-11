import { createHash } from "node:crypto";

import { normalizeCatalogDescription } from "../../catalog-description";
import type { CatalogMetadataItemInput } from "../../catalog-metadata.types";
import type { CatalogMetadataProviderResult } from "../metadata/catalog-metadata-provider";

export const TF2_AUTOBOT_SOURCE_URL = "https://schema.autobot.tf/getItem/fromName";

const maxTargets = 100_000;
const maxDefindex = 2_147_483_647;
const steamMediaPrefix = "/apps/440/icons/";

function invalid(code: string): never {
  throw new Error(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalText(value: unknown, maximumLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength || value.trim() !== value) {
    invalid("CATALOG_METADATA_TF2_AUTOBOT_ITEM_INVALID");
  }
  return value;
}

function optionalText(value: unknown, maximumLength: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  return canonicalText(value, maximumLength);
}

function trustedImageUrl(value: unknown): string | null {
  const normalized = optionalText(value, 2_048);
  if (normalized === null) return null;
  try {
    const url = new URL(normalized);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.hostname !== "media.steampowered.com" ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== "" ||
      !url.pathname.startsWith(steamMediaPrefix) ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      invalid("CATALOG_METADATA_TF2_AUTOBOT_ITEM_INVALID");
    }
    url.protocol = "https:";
    return url.toString();
  } catch {
    invalid("CATALOG_METADATA_TF2_AUTOBOT_ITEM_INVALID");
  }
}

function providerItemIdentity(defindex: number, targetMarketHashName: string): string {
  return `${defindex}:${createHash("sha256").update(targetMarketHashName).digest("hex")}`;
}

function normalizedTargets(targets: readonly string[]): readonly string[] {
  if (
    !Array.isArray(targets) ||
    targets.length === 0 ||
    targets.length > maxTargets ||
    targets.some((target) => typeof target !== "string" || target.length === 0 || target.length > 512 || target.trim() !== target)
  ) {
    invalid("CATALOG_METADATA_TF2_AUTOBOT_SNAPSHOT_INVALID");
  }
  return Array.from(new Set<string>(targets)).sort((left, right) => left.localeCompare(right));
}

export function parseTf2AutobotItem(document: unknown, targetMarketHashName: string): CatalogMetadataItemInput {
  const target = canonicalText(targetMarketHashName, 512);
  if (!isRecord(document) || document.success !== true || !isRecord(document.schemaItems)) {
    invalid("CATALOG_METADATA_TF2_AUTOBOT_ITEM_INVALID");
  }
  const source = document.schemaItems;
  if (
    typeof source.defindex !== "number" ||
    !Number.isSafeInteger(source.defindex) ||
    source.defindex < 1 ||
    source.defindex > maxDefindex
  ) {
    invalid("CATALOG_METADATA_TF2_AUTOBOT_ITEM_INVALID");
  }
  const baseName = canonicalText(source.item_name, 1_024);
  if (target !== baseName && !target.endsWith(` ${baseName}`)) invalid("CATALOG_METADATA_TF2_AUTOBOT_ITEM_INVALID");
  const typeName = canonicalText(source.item_type_name, 256);
  const imageUrl = trustedImageUrl(source.image_url_large) ?? trustedImageUrl(source.image_url);
  if (imageUrl === null) invalid("CATALOG_METADATA_TF2_AUTOBOT_ITEM_INVALID");
  return {
    provider: "tf2_autobot",
    game: "tf2",
    locale: "en",
    marketHashName: target,
    providerItemId: providerItemIdentity(source.defindex, target),
    title: target,
    description: normalizeCatalogDescription(optionalText(source.item_description, 65_536)),
    categoryName: typeName,
    productType: typeName,
    rarityName: null,
    imageUrl,
    tags: [typeName],
    raw: source,
  };
}

export function createTf2AutobotSnapshot(
  targets: readonly string[],
  matchedItems: readonly CatalogMetadataItemInput[],
  observedAt: Date,
): CatalogMetadataProviderResult {
  const targetNames = normalizedTargets(targets);
  const matchedItemsInput: unknown = matchedItems;
  if (!Array.isArray(matchedItemsInput) || !Number.isFinite(observedAt.getTime())) {
    invalid("CATALOG_METADATA_TF2_AUTOBOT_SNAPSHOT_INVALID");
  }
  const targetSet = new Set<string>(targetNames);
  const byTarget = new Map<string, CatalogMetadataItemInput>();
  for (const item of matchedItems) {
    if (item.provider !== "tf2_autobot" || item.game !== "tf2" || item.locale !== "en" || !targetSet.has(item.marketHashName) || byTarget.has(item.marketHashName)) {
      invalid("CATALOG_METADATA_TF2_AUTOBOT_SNAPSHOT_INVALID");
    }
    byTarget.set(item.marketHashName, item);
  }
  const items = targetNames.flatMap((target) => {
    const item = byTarget.get(target);
    return item === undefined ? [] : [item];
  });
  const sourceHash = createHash("sha256");
  for (const target of targetNames) {
    const item = byTarget.get(target);
    sourceHash.update(JSON.stringify(item ?? { marketHashName: target, unmatched: true })).update("\n");
  }
  return {
    provider: "tf2_autobot",
    game: "tf2",
    locale: "en",
    sourceUrl: TF2_AUTOBOT_SOURCE_URL,
    sourceHash: sourceHash.digest("hex"),
    observedAt,
    sourceItemCount: targetNames.length,
    filteredOutCount: targetNames.length - items.length,
    collapsedDuplicateCount: 0,
    metadata: {},
    items,
  };
}
