import "reflect-metadata";

import { createHash } from "node:crypto";

import { NestFactory } from "@nestjs/core";

import { DatabaseService } from "./common/database/database.service";
import { AppModule } from "./app.module";

const CSGO_API_COMMIT = "5e01f938a115de71a5be644c5b198d93abc6a3cf";
const CSGO_API_SOURCE_URL = `https://raw.githubusercontent.com/TorentoFlag/CSGO-API/${CSGO_API_COMMIT}/public/api/ru/all.json`;
const MAX_CSGO_API_BODY_BYTES = 100 * 1024 * 1024;
const PUBLIC_IMAGE_HOSTS = new Set([
  "cdn.cloudflare.steamstatic.com",
  "community.akamai.steamstatic.com",
  "community.cloudflare.steamstatic.com",
  "raw.githubusercontent.com",
  "steamcommunity-a.akamaihd.net",
]);
const weaponTypes: Array<[RegExp, string]> = [
  [/^(?:AK-47|AUG|FAMAS|Galil AR|M4A1-S|M4A4|SG 553)\b/i, "Автомат"],
  [/^(?:AWP|G3SG1|SCAR-20|SSG 08)\b/i, "Снайперская винтовка"],
  [/^(?:Desert Eagle|Dual Berettas|Five-SeveN|Glock-18|P2000|P250|R8 Revolver|Tec-9|USP-S|CZ75-Auto)\b/i, "Пистолет"],
  [/^(?:MAC-10|MP5-SD|MP7|MP9|P90|PP-Bizon|UMP-45)\b/i, "Пистолет-пулемет"],
  [/^(?:MAG-7|Nova|Sawed-Off|XM1014)\b/i, "Дробовик"],
  [/^(?:M249|Negev)\b/i, "Пулемет"],
  [/^★ .*Gloves\b|Gloves\b/i, "Перчатки"],
  [/^★ |Knife\b|Bayonet\b|Karambit\b|Daggers\b/i, "Нож"],
  [/^Sticker\b/i, "Наклейка"],
  [/Capsule\b/i, "Капсула"],
  [/^Music Kit\b/i, "Музыкальный набор"],
  [/^Agent\b|^Operator\b/i, "Агент"],
  [/^Patch\b/i, "Нашивка"],
  [/^Graffiti\b/i, "Граффити"],
  [/^Charm\b/i, "Брелок"],
  [/Pin\b/i, "Значок"],
  [/Case\b/i, "Кейс"],
  [/Key\b/i, "Ключ"],
];
const fallbackCategories: Array<[RegExp, string]> = [
  [/Capsule\b/i, "Капсулы"],
  [/^Sticker\b|Sticker Slab\b/i, "Наклейки"],
  [/Graffiti\b/i, "Граффити"],
  [/Music Kit\b/i, "Музыкальные наборы"],
  [/^Patch\b/i, "Нашивки"],
  [/Charm\b/i, "Брелоки"],
  [/Pin\b/i, "Значки"],
  [/Package\b/i, "Наборы"],
  [/Case\b/i, "Кейсы"],
  [/Key\b/i, "Ключи"],
];

export type Cs2MetadataImage = {
  categoryName: string;
  conditionName: string | null;
  description: string;
  imageUrl: string;
  inferredProductType: string;
  marketHashName: string;
  rarityName: string | null;
  title: string;
};

type SyncCs2ImagesResult = {
  activeSihListingCount: number;
  blockedProductImageCount: number;
  blockedSupplierImageCount: number;
  matchedActiveCount: number;
  productUpdatedCount: number;
  sourceContentHash: string;
  sourceItemCount: number;
  sourceUrl: string;
  supplierUpdatedCount: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function publicImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !PUBLIC_IMAGE_HOSTS.has(url.hostname) ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== ""
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function canonicalText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength || value.trim() !== value) return null;
  return value;
}

function normalizeCatalogDescription(description: unknown): string | null {
  if (typeof description !== "string" || description.length === 0) return null;
  const decoded = description
    .replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, " ")
    .replace(/\\"/g, "\"")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p(?:\s[^>]*)?>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b-\u200d\ufeff]/g, "");
  const normalized = decoded
    .replace(/[^\S\n]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return normalized.length === 0 || /<(?:\/?[A-Za-z][^>]*|[!?][^>]*)>/.test(normalized) ? null : normalized;
}

function categoryName(value: unknown, marketHashName: string, id: unknown): string | null {
  if (!isRecord(value)) return fallbackCategoryName(marketHashName, id);
  const explicit = canonicalText(value.name, 256);
  if (explicit !== null) return explicit;
  return fallbackCategoryName(marketHashName, id);
}

function fallbackCategoryName(marketHashName: string, id: unknown): string | null {
  if (typeof id === "string" && id.startsWith("agent-")) return "Агенты";
  return fallbackCategories.find(([pattern]) => pattern.test(marketHashName))?.[1] ?? null;
}

function rarityName(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) return null;
  return canonicalText(value.name, 256);
}

function conditionName(marketHashName: string): string | null {
  const condition = /\(([^()]+)\)\s*$/.exec(marketHashName)?.[1];
  switch (condition) {
    case "Factory New":
      return "Прямо с завода";
    case "Minimal Wear":
      return "Немного поношенное";
    case "Field-Tested":
      return "После полевых испытаний";
    case "Well-Worn":
      return "Поношенное";
    case "Battle-Scarred":
      return "Закаленное в боях";
    default:
      return null;
  }
}

function inferProductType(marketHashName: string): string {
  return weaponTypes.find(([pattern]) => pattern.test(marketHashName))?.[1] ?? "Предмет CS2";
}

export function parseCs2MetadataImages(rawPayload: string): Cs2MetadataImage[] {
  const payload = JSON.parse(rawPayload) as unknown;
  if (!isRecord(payload)) throw new Error("CS2_METADATA_IMAGE_SOURCE_INVALID");

  const byMarketHashName = new Map<string, Cs2MetadataImage>();
  for (const item of Object.values(payload)) {
    if (!isRecord(item)) continue;
    const marketHashName = canonicalText(item.market_hash_name, 512);
    if (marketHashName === null) continue;
    const imageUrl = publicImageUrl(item.image);
    if (imageUrl === null) continue;
    const title = canonicalText(item.name, 1_024);
    const description = normalizeCatalogDescription(item.description);
    const category = categoryName(item.category, marketHashName, item.id);
    if (title === null || description === null || category === null) continue;
    if (!byMarketHashName.has(marketHashName)) {
      byMarketHashName.set(marketHashName, {
        categoryName: category,
        conditionName: conditionName(marketHashName),
        description,
        imageUrl,
        inferredProductType: inferProductType(marketHashName),
        marketHashName,
        rarityName: rarityName(item.rarity),
        title,
      });
    }
  }

  return [...byMarketHashName.values()].sort((left, right) => left.marketHashName.localeCompare(right.marketHashName));
}

async function fetchCs2MetadataImages(): Promise<{ contentHash: string; images: Cs2MetadataImage[]; sourceUrl: string }> {
  const response = await fetch(CSGO_API_SOURCE_URL, {
    headers: { accept: "application/json,text/plain" },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("CS2_METADATA_IMAGE_SOURCE_UNAVAILABLE");
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && BigInt(declaredLength) > BigInt(MAX_CSGO_API_BODY_BYTES)) {
    throw new Error("CS2_METADATA_IMAGE_SOURCE_TOO_LARGE");
  }
  const rawPayload = await response.text();
  if (Buffer.byteLength(rawPayload, "utf8") > MAX_CSGO_API_BODY_BYTES) {
    throw new Error("CS2_METADATA_IMAGE_SOURCE_TOO_LARGE");
  }
  return {
    contentHash: createHash("sha256").update(rawPayload).digest("hex"),
    images: parseCs2MetadataImages(rawPayload),
    sourceUrl: CSGO_API_SOURCE_URL,
  };
}

async function syncCs2Images(database: DatabaseService, images: readonly Cs2MetadataImage[], sourceContentHash: string): Promise<SyncCs2ImagesResult> {
  const active = await database.query<{ market_hash_name: string }>(
    `
      SELECT market_hash_name
      FROM supplier_listings
      WHERE supplier = 'sih'
        AND game = 'cs2'
        AND active = true
    `,
  );
  const activeNames = new Set(active.rows.map((row) => row.market_hash_name));
  const matched = images.filter((image) => activeNames.has(image.marketHashName));
  if (matched.length === 0) throw new Error("CS2_METADATA_IMAGE_MATCH_EMPTY");

  const result = await database.transaction(async (tx) => {
    await tx.query(`
      CREATE TEMP TABLE tmp_cs2_metadata_images (
        market_hash_name text PRIMARY KEY,
        category_name text NOT NULL,
        condition_name text,
        description text NOT NULL,
        image_url text NOT NULL,
        inferred_product_type text NOT NULL,
        rarity_name text,
        title text NOT NULL
      ) ON COMMIT DROP
    `);

    const batchSize = 2_000;
    for (let offset = 0; offset < matched.length; offset += batchSize) {
      const batch = matched.slice(offset, offset + batchSize);
      await tx.query(
        `
          INSERT INTO tmp_cs2_metadata_images (
            market_hash_name,
            category_name,
            condition_name,
            description,
            image_url,
            inferred_product_type,
            rarity_name,
            title
          )
          SELECT market_hash_name, category_name, condition_name, description, image_url, inferred_product_type, rarity_name, title
          FROM jsonb_to_recordset($1::jsonb) AS item(
            market_hash_name text,
            image_url text,
            category_name text,
            condition_name text,
            description text,
            inferred_product_type text,
            rarity_name text,
            title text
          )
          ON CONFLICT (market_hash_name) DO UPDATE
          SET category_name = EXCLUDED.category_name,
              condition_name = EXCLUDED.condition_name,
              description = EXCLUDED.description,
              image_url = EXCLUDED.image_url,
              inferred_product_type = EXCLUDED.inferred_product_type,
              rarity_name = EXCLUDED.rarity_name,
              title = EXCLUDED.title
        `,
        [JSON.stringify(batch.map((item) => ({
          category_name: item.categoryName,
          condition_name: item.conditionName,
          description: item.description,
          image_url: item.imageUrl,
          inferred_product_type: item.inferredProductType,
          market_hash_name: item.marketHashName,
          rarity_name: item.rarityName,
          title: item.title,
        })))],
      );
    }

    const supplier = await tx.query(`
      UPDATE supplier_listings
      SET image_url = tmp_cs2_metadata_images.image_url
      FROM tmp_cs2_metadata_images
      WHERE supplier_listings.supplier = 'sih'
        AND supplier_listings.game = 'cs2'
        AND supplier_listings.market_hash_name = tmp_cs2_metadata_images.market_hash_name
        AND supplier_listings.image_url IS DISTINCT FROM tmp_cs2_metadata_images.image_url
    `);
    const products = await tx.query(`
      UPDATE catalog_products
      SET category = tmp_cs2_metadata_images.category_name,
          product_type = tmp_cs2_metadata_images.category_name,
          title = tmp_cs2_metadata_images.title,
          description = tmp_cs2_metadata_images.description,
          image = tmp_cs2_metadata_images.image_url,
          image_alt = tmp_cs2_metadata_images.title || ' из Counter-Strike 2',
          meta = array_remove(ARRAY[
            'CS2',
            tmp_cs2_metadata_images.condition_name,
            tmp_cs2_metadata_images.category_name,
            tmp_cs2_metadata_images.rarity_name
          ], NULL),
          keywords = array_remove(ARRAY[
            'cs2',
            'counter-strike',
            'counter-strike 2',
            'steam trade',
            'sih',
            lower(tmp_cs2_metadata_images.title),
            lower(tmp_cs2_metadata_images.category_name),
            lower(tmp_cs2_metadata_images.inferred_product_type),
            lower(tmp_cs2_metadata_images.market_hash_name),
            lower(tmp_cs2_metadata_images.condition_name),
            lower(tmp_cs2_metadata_images.rarity_name)
          ], NULL),
          details = jsonb_build_object(
            'specifications',
            jsonb_build_array(
              jsonb_build_object('label', 'Игра', 'value', 'Counter-Strike 2'),
              jsonb_build_object('label', 'Категория', 'value', tmp_cs2_metadata_images.category_name)
            )
            || CASE
              WHEN tmp_cs2_metadata_images.condition_name IS NULL THEN '[]'::jsonb
              ELSE jsonb_build_array(jsonb_build_object('label', 'Состояние', 'value', tmp_cs2_metadata_images.condition_name))
            END
            || CASE
              WHEN tmp_cs2_metadata_images.rarity_name IS NULL THEN '[]'::jsonb
              ELSE jsonb_build_array(jsonb_build_object('label', 'Редкость', 'value', tmp_cs2_metadata_images.rarity_name))
            END,
            'fulfillment',
            jsonb_build_object(
              'title', 'Данные Steam Trade',
              'description', 'Предмет покупается через SIH и передается по Steam Trade после оплаты внутренними Coins.',
              'requirements', jsonb_build_array(
                'Для оформления игрового предмета требуется Steam-сессия.',
                'Перед покупкой укажите действующий Steam Trade URL.',
                'Цена и наличие проверяются по активному предложению SIH перед оформлением.'
              )
            )
          ),
          public_enabled = true,
          updated_at = clock_timestamp()
      FROM tmp_cs2_metadata_images
      WHERE catalog_products.supplier_provider = 'sih'
        AND catalog_products.kind = 'skins'
        AND lower(catalog_products.game) = 'cs2'
        AND catalog_products.supplier_item_id = tmp_cs2_metadata_images.market_hash_name
        AND (
          catalog_products.category IS DISTINCT FROM tmp_cs2_metadata_images.category_name
          OR catalog_products.product_type IS DISTINCT FROM tmp_cs2_metadata_images.category_name
          OR catalog_products.title IS DISTINCT FROM tmp_cs2_metadata_images.title
          OR catalog_products.description IS DISTINCT FROM tmp_cs2_metadata_images.description
          OR catalog_products.image IS DISTINCT FROM tmp_cs2_metadata_images.image_url
          OR catalog_products.image_alt IS DISTINCT FROM tmp_cs2_metadata_images.title || ' из Counter-Strike 2'
          OR NOT (lower(tmp_cs2_metadata_images.inferred_product_type) = ANY(catalog_products.keywords))
          OR catalog_products.public_enabled IS DISTINCT FROM true
        )
    `);
    const blockedSupplier = await tx.query(`
      UPDATE supplier_listings
      SET image_url = NULL
      WHERE supplier = 'sih'
        AND game = 'cs2'
        AND image_url LIKE 'https://steaminventoryhelper.com/%'
    `);
    const blockedProducts = await tx.query(`
      UPDATE catalog_products
      SET image = NULL,
          public_enabled = false,
          updated_at = clock_timestamp()
      WHERE supplier_provider = 'sih'
        AND kind = 'skins'
        AND image LIKE 'https://steaminventoryhelper.com/%'
    `);
    await tx.query(`
      UPDATE catalog_products
      SET public_enabled = false,
          updated_at = clock_timestamp()
      WHERE supplier_provider = 'sih'
        AND kind = 'skins'
        AND lower(game) = 'cs2'
        AND supplier_item_id NOT IN (
          SELECT market_hash_name
          FROM tmp_cs2_metadata_images
        )
        AND public_enabled = true
    `);
    await tx.query(`
      UPDATE catalog_products
      SET public_enabled = false,
          updated_at = clock_timestamp()
      WHERE supplier_provider = 'sih'
        AND kind = 'skins'
        AND (image IS NULL OR btrim(description) = '')
        AND public_enabled = true
    `);

    return {
      blockedProductImageCount: blockedProducts.rowCount ?? 0,
      blockedSupplierImageCount: blockedSupplier.rowCount ?? 0,
      productUpdatedCount: products.rowCount ?? 0,
      supplierUpdatedCount: supplier.rowCount ?? 0,
    };
  });

  return {
    activeSihListingCount: active.rows.length,
    blockedProductImageCount: result.blockedProductImageCount,
    blockedSupplierImageCount: result.blockedSupplierImageCount,
    matchedActiveCount: matched.length,
    productUpdatedCount: result.productUpdatedCount,
    sourceContentHash,
    sourceItemCount: images.length,
    sourceUrl: CSGO_API_SOURCE_URL,
    supplierUpdatedCount: result.supplierUpdatedCount,
  };
}

async function main(): Promise<void> {
  const source = await fetchCs2MetadataImages();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  try {
    const database = app.get(DatabaseService);
    const result = await syncCs2Images(database, source.images, source.contentHash);
    process.stdout.write(JSON.stringify({ ...result, status: "ok" }));
    process.stdout.write("\n");
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "CS2_METADATA_IMAGE_SYNC_FAILED";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
