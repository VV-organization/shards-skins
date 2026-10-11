import { Inject, Injectable, NotFoundException } from "@nestjs/common";

import { DatabaseService } from "../../common/database/database.service";

export type SupplierPriceQuoteCommand = {
  scope: string;
  supplierAmountMicrounit: bigint;
};

export type SupplierPriceQuote = {
  currency: "COINS";
  amountMinor: number;
  scale: 2;
  display: string;
  pricingSettingId: string;
  breakdown: {
    fiatCurrency: string;
    fiatAmountMinor: number;
    markupBps: number;
    supplierCurrency: string;
    supplierAmountMicrounit: string;
  };
};

type PricingSettingRow = {
  id: string;
  supplier_currency: string;
  fiat_currency: string;
  supplier_to_fiat_rate_minor: number;
  coin_rate_numerator: number;
  coin_rate_denominator: number;
  markup_bps: number;
  min_price_coin_minor: number;
  round_to_coin_minor: number;
};

const supplierMicrounitDenominator = 1_000_000n;
const basisPointDenominator = 10_000n;

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("CATALOG_PRICING_DENOMINATOR_INVALID");
  return (numerator + denominator - 1n) / denominator;
}

function numberToPositiveBigInt(value: number, code: string): bigint {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(code);
  return BigInt(value);
}

function numberToNonNegativeBigInt(value: number, code: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
  return BigInt(value);
}

function safeNumber(value: bigint, code: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(code);
  return Number(value);
}

function formatCoins(amountMinor: number): string {
  if (amountMinor % 100 === 0) return `${(amountMinor / 100).toLocaleString("ru-RU")} Coins`;
  return `${(amountMinor / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Coins`;
}

function roundUp(value: bigint, increment: bigint): bigint {
  return ceilDiv(value, increment) * increment;
}

function calculateQuote(setting: PricingSettingRow, supplierAmountMicrounit: bigint): SupplierPriceQuote {
  if (supplierAmountMicrounit <= 0n) throw new Error("CATALOG_PRICING_SUPPLIER_AMOUNT_INVALID");

  const supplierToFiatRateMinor = numberToPositiveBigInt(setting.supplier_to_fiat_rate_minor, "CATALOG_PRICING_RATE_INVALID");
  const coinRateNumerator = numberToPositiveBigInt(setting.coin_rate_numerator, "CATALOG_PRICING_COIN_RATE_INVALID");
  const coinRateDenominator = numberToPositiveBigInt(setting.coin_rate_denominator, "CATALOG_PRICING_COIN_RATE_INVALID");
  const markupBps = numberToNonNegativeBigInt(setting.markup_bps, "CATALOG_PRICING_MARKUP_INVALID");
  const minPriceCoinMinor = numberToNonNegativeBigInt(setting.min_price_coin_minor, "CATALOG_PRICING_MIN_PRICE_INVALID");
  const roundToCoinMinor = numberToPositiveBigInt(setting.round_to_coin_minor, "CATALOG_PRICING_ROUNDING_INVALID");

  const supplierFiatMinor = ceilDiv(supplierAmountMicrounit * supplierToFiatRateMinor, supplierMicrounitDenominator);
  const fiatAmountMinor = ceilDiv(supplierFiatMinor * (basisPointDenominator + markupBps), basisPointDenominator);
  const coinAmountMinor = ceilDiv(fiatAmountMinor * coinRateNumerator, coinRateDenominator);
  const roundedCoinAmountMinor = roundUp(coinAmountMinor > minPriceCoinMinor ? coinAmountMinor : minPriceCoinMinor, roundToCoinMinor);

  const amountMinor = safeNumber(roundedCoinAmountMinor, "CATALOG_PRICING_AMOUNT_OVERFLOW");
  return {
    currency: "COINS",
    amountMinor,
    scale: 2,
    display: formatCoins(amountMinor),
    pricingSettingId: setting.id,
    breakdown: {
      fiatCurrency: setting.fiat_currency,
      fiatAmountMinor: safeNumber(fiatAmountMinor, "CATALOG_PRICING_FIAT_AMOUNT_OVERFLOW"),
      markupBps: setting.markup_bps,
      supplierCurrency: setting.supplier_currency,
      supplierAmountMicrounit: supplierAmountMicrounit.toString(),
    },
  };
}

@Injectable()
export class CatalogPricingService {
  private readonly activeSettingCache = new Map<string, Promise<PricingSettingRow>>();

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private async activeSetting(scope: string): Promise<PricingSettingRow> {
    const cached = this.activeSettingCache.get(scope);
    if (cached !== undefined) return cached;
    const lookup = this.database.query<PricingSettingRow>(
      `
        SELECT
          id,
          supplier_currency,
          fiat_currency,
          supplier_to_fiat_rate_minor,
          coin_rate_numerator,
          coin_rate_denominator,
          markup_bps,
          min_price_coin_minor,
          round_to_coin_minor
        FROM pricing_settings
        WHERE scope = $1
          AND superseded_at IS NULL
        ORDER BY valid_from DESC, created_at DESC, id DESC
        LIMIT 1
      `,
      [scope],
    ).then((result) => {
      const setting = result.rows[0];
      if (setting === undefined) throw new NotFoundException("Pricing setting not found");
      return setting;
    }).catch((error: unknown) => {
      this.activeSettingCache.delete(scope);
      throw error;
    });
    this.activeSettingCache.set(scope, lookup);
    return lookup;
  }

  async quoteSupplierPrice(command: SupplierPriceQuoteCommand): Promise<SupplierPriceQuote> {
    return calculateQuote(await this.activeSetting(command.scope), command.supplierAmountMicrounit);
  }
}
