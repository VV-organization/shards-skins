import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../../app.module";
import { CatalogPricingService } from "./catalog-pricing.service";

const databaseUrl = process.env.SHARDS_TEST_DATABASE_URL;
const testScope = `test-sih-skins-${process.pid}`;

async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe.skipIf(!databaseUrl)("catalog pricing settings", () => {
  let app: INestApplication;
  let pool: Pool;

  beforeAll(() => {
    process.env.DATABASE_URL = databaseUrl;
    pool = new Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    await pool.query("DELETE FROM pricing_settings WHERE scope = $1", [testScope]);
    delete process.env.DATABASE_URL;
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    app = await createApp();
    await pool.query("DELETE FROM pricing_settings WHERE scope = $1", [testScope]);
  });

  it("quotes supplier micro-USD into Coins with the active append-only pricing setting", async () => {
    await pool.query(
      `
        INSERT INTO pricing_settings (
          id,
          scope,
          source,
          supplier_currency,
          fiat_currency,
          supplier_to_fiat_rate_minor,
          coin_rate_numerator,
          coin_rate_denominator,
          markup_bps,
          min_price_coin_minor,
          round_to_coin_minor,
          valid_from,
          superseded_at
        )
        VALUES
          ($1, $3, 'sih', 'USD', 'RUB', 9000, 3, 2, 0, 100, 100, '2026-07-26T00:00:00.000Z', '2026-07-27T00:00:00.000Z'),
          ($2, $3, 'sih', 'USD', 'RUB', 9500, 3, 2, 2500, 100, 100, '2026-07-27T00:00:00.000Z', NULL)
      `,
      [`${testScope}-old`, `${testScope}-active`, testScope],
    );

    const pricing = app.get(CatalogPricingService);
    const quote = await pricing.quoteSupplierPrice({
      scope: testScope,
      supplierAmountMicrounit: 1_011_000n,
    });

    expect(quote).toEqual({
      currency: "COINS",
      amountMinor: 18_100,
      scale: 2,
      display: "181 Coins",
      pricingSettingId: `${testScope}-active`,
      breakdown: {
        fiatCurrency: "RUB",
        fiatAmountMinor: 12_007,
        markupBps: 2500,
        supplierCurrency: "USD",
        supplierAmountMicrounit: "1011000",
      },
    });
  });
});
