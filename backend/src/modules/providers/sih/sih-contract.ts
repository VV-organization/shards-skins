import type {
  SihCatalogGame,
  SihCreateSkinOrderResult,
  SihSkinOrder,
  SihSkinOrderStatus,
  SihSkinProtection,
  SihSteamCheckResult,
  SihSteamPayResult,
  SihSupplierItem,
} from "./sih.types";

const MAX_ITEM_COUNT = 1_000_000_000;
const MAX_MARKET_HASH_NAME_LENGTH = 512;
const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;
const SKIN_ORDER_STATUSES = new Set<SihSkinOrderStatus>(["created", "processing", "sent", "finished", "failed", "penalized"]);
const SKIN_PROTECTION_STATUSES = new Set<SihSkinProtection["status"]>(["processing", "finished", "failed"]);
const SKIN_PROTECTION_ERRORS = new Set<NonNullable<SihSkinProtection["error"]>>(["rollback user", "rollback supplier"]);
const TRUSTED_IMAGE_HOSTS = new Set([
  "cdn.cloudflare.steamstatic.com",
  "community.cloudflare.steamstatic.com",
  "steamcommunity-a.akamaihd.net",
]);

function invalid(): never {
  throw new Error("SIH_RESPONSE_INVALID");
}

export class SihSteamCheckRejectedError extends Error {
  constructor() {
    super("SIH_STEAM_CHECK_REJECTED");
    this.name = "SihSteamCheckRejectedError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalText(value: unknown, maximumLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength || value.trim() !== value) invalid();
  return value;
}

function optionalTrustedImage(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) return null;
  if (/^[A-Za-z0-9_-]{20,1024}$/.test(value)) {
    return `https://community.cloudflare.steamstatic.com/economy/image/${value}`;
  }
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !TRUSTED_IMAGE_HOSTS.has(url.hostname) ||
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

function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_ITEM_COUNT) invalid();
  return value;
}

function decimalMinor(value: unknown, scale: number, options: { allowZero?: true } = {}): bigint {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "number" && (!Number.isFinite(value) || value < 0)) ||
    (typeof value === "string" && !/^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.test(value)) ||
    (value === 0 && options.allowZero !== true) ||
    (value === "0" && options.allowZero !== true)
  ) {
    invalid();
  }
  const normalized = value.toString();
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(normalized);
  if (match === null) invalid();
  const whole = match[1];
  if (whole === undefined) invalid();
  const fraction = (match[2] ?? "").slice(0, scale).padEnd(scale, "0");
  return BigInt(whole) * (10n ** BigInt(scale)) + BigInt(fraction || "0");
}

function canonicalCustomId(value: unknown): string {
  return canonicalText(value, 128);
}

function canonicalSteamId64(value: unknown): string {
  const steamId64 = canonicalText(value, 32);
  if (!/^7656119[0-9]{10}$/.test(steamId64)) invalid();
  return steamId64;
}

function providerId(value: unknown): string {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) invalid();
    return String(value);
  }
  const normalized = canonicalText(value, 32);
  if (!/^[1-9][0-9]*$/.test(normalized)) invalid();
  return normalized;
}

function optionalProviderId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return providerId(value);
}

function optionalEpochSeconds(value: unknown): Date | null {
  if (value === undefined || value === null) return null;
  let normalized: string;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) invalid();
    normalized = String(value);
  } else {
    normalized = canonicalText(value, 32);
    if (!/^(?:0|[1-9][0-9]*)$/.test(normalized)) invalid();
  }
  const seconds = BigInt(normalized);
  if (seconds > 253_402_300_799n) invalid();
  return new Date(Number(seconds) * 1_000);
}

function exactUsd(microusd: bigint): string {
  if (typeof microusd !== "bigint" || microusd <= 0n || microusd > MAX_POSTGRES_BIGINT) {
    throw new Error("SIH_ORDER_AMOUNT_INVALID");
  }
  const whole = microusd / 1_000_000n;
  const fractional = (microusd % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fractional.length === 0 ? whole.toString() : `${whole}.${fractional}`;
}

function protection(value: unknown): SihSkinProtection | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || typeof value.status !== "string" || !SKIN_PROTECTION_STATUSES.has(value.status as SihSkinProtection["status"])) {
    invalid();
  }
  const status = value.status as SihSkinProtection["status"];
  const error = value.error;
  if (status === "failed" && (typeof error !== "string" || !SKIN_PROTECTION_ERRORS.has(error as NonNullable<SihSkinProtection["error"]>))) {
    invalid();
  }
  if (status !== "failed" && error !== undefined && error !== null) invalid();
  return {
    error: status === "failed" ? error as NonNullable<SihSkinProtection["error"]> : null,
    rollbackAmountMicrousd: value.rollbackAmount === undefined || value.rollbackAmount === null ? null : decimalMinor(value.rollbackAmount, 6, { allowZero: true }),
    rollbackAt: optionalEpochSeconds(value.rollbackAt),
    status,
  };
}

function parseSkinOrder(value: unknown, expectedCustomId: string): SihSkinOrder {
  if (!isRecord(value)) invalid();
  const customId = canonicalCustomId(value.customId);
  if (customId !== canonicalCustomId(expectedCustomId)) invalid();
  const status = value.status;
  if (typeof status !== "string" || !SKIN_ORDER_STATUSES.has(status as SihSkinOrderStatus)) invalid();
  return {
    amountMicrousd: decimalMinor(value.amount, 6),
    customId,
    expectedAmountMicrousd: value.expectedAmount === undefined || value.expectedAmount === null ? null : decimalMinor(value.expectedAmount, 6),
    marketHashName: canonicalText(value.item, MAX_MARKET_HASH_NAME_LENGTH),
    offerId: isRecord(value.sender) ? optionalProviderId(value.sender.offerId) : null,
    projection: "order",
    protection: protection(value.protection),
    providerOrderId: providerId(value.id),
    status: status as SihSkinOrderStatus,
    steamId64: canonicalSteamId64(value.steamId),
  };
}

function parseJson(rawPayload: string): unknown {
  try {
    return JSON.parse(rawPayload) as unknown;
  } catch {
    invalid();
  }
}

export function sihAppId(game: SihCatalogGame): number {
  switch (game) {
    case "cs2":
      return 730;
    case "rust":
      return 252490;
    case "tf2":
      return 440;
  }
}

export function parseSihItems(rawPayload: string, game: SihCatalogGame): SihSupplierItem[] {
  const payload = parseJson(rawPayload);
  if (!isRecord(payload) || payload.success !== true || !isRecord(payload.items)) invalid();
  return Object.entries(payload.items).map(([marketHashName, item]) => {
    if (!isRecord(item)) invalid();
    return {
      availableQuantity: integer(item.count),
      game,
      imageUrl: optionalTrustedImage(item.image),
      marketHashName: canonicalText(marketHashName, MAX_MARKET_HASH_NAME_LENGTH),
      priceMicrousd: decimalMinor(item.price, 6),
    };
  });
}

export function parseSihMinimumItem(rawPayload: string, game: SihCatalogGame, expectedMarketHashName: string): SihSupplierItem | null {
  const items = parseSihItems(rawPayload, game);
  if (items.length === 0) return null;
  if (items.length !== 1 || items[0]?.marketHashName !== expectedMarketHashName) invalid();
  return items[0];
}

export function parseSihSteamCheck(rawPayload: string): SihSteamCheckResult {
  const payload = parseJson(rawPayload);
  if (!isRecord(payload)) invalid();
  if (payload.success === false) throw new SihSteamCheckRejectedError();
  if (payload.success !== true) invalid();
  const transactionId = canonicalText(payload.transactionId, 100);
  if (transactionId.length < 10) invalid();
  return { transactionId };
}

export function parseSihSteamPay(rawPayload: string): SihSteamPayResult {
  const payload = parseJson(rawPayload);
  if (!isRecord(payload) || payload.status !== "success") invalid();
  return {
    cashbackUsd: decimalMinor(payload.cashback, 6, { allowZero: true }),
    paymentAmountRub: decimalMinor(payload.paymentAmount, 2),
    status: "success",
  };
}

export function buildSihCreateOrderBody(command: {
  amountMicrousd: bigint;
  customId: string;
  game: SihCatalogGame;
  marketHashName: string;
  steamId64: string;
  test: boolean;
  tradeToken: string;
}): string {
  const customId = canonicalCustomId(command.customId);
  const steamId64 = canonicalSteamId64(command.steamId64);
  const marketHashName = canonicalText(command.marketHashName, MAX_MARKET_HASH_NAME_LENGTH);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(command.tradeToken)) throw new Error("SIH_ORDER_TRADE_TOKEN_INVALID");
  if (typeof command.test !== "boolean") throw new Error("SIH_ORDER_TEST_FLAG_INVALID");
  return `{"steamId":${JSON.stringify(steamId64)},"token":${JSON.stringify(command.tradeToken)},"amount":${exactUsd(command.amountMicrousd)},"item":${JSON.stringify(marketHashName)},"customId":${JSON.stringify(customId)},"test":${String(command.test)},"appId":${sihAppId(command.game)}}`;
}

export function parseSihCreateSkinOrder(rawPayload: string, statusCode: number, expectedCustomId: string): SihCreateSkinOrderResult {
  const payload = parseJson(rawPayload);
  if (statusCode === 200) {
    if (!isRecord(payload) || payload.success !== true) invalid();
    return {
      projection: "create_acknowledgement",
      providerBalanceMicrousd: payload.balance === undefined || payload.balance === null ? null : decimalMinor(payload.balance, 6, { allowZero: true }),
      providerOrderId: providerId(payload.id),
    };
  }
  if (statusCode === 409 && isRecord(payload) && payload.success === false && payload.error === "custom id already exists") {
    return parseSkinOrder(payload.order, expectedCustomId);
  }
  invalid();
}

export function parseSihSkinOrder(rawPayload: string, expectedCustomId: string): SihSkinOrder {
  const payload = parseJson(rawPayload);
  if (!isRecord(payload) || payload.success !== true) invalid();
  return parseSkinOrder(payload.order, expectedCustomId);
}
