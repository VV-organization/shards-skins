import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../common/database/database.service";
import { FulfillmentService } from "../fulfillment/fulfillment.service";
import { AppModule } from "../../app.module";
import { CartService } from "../cart/cart.service";
import { CheckoutService } from "../checkout/checkout.service";
import { UsersService } from "../users/users.service";
import { WalletService } from "../wallet/wallet.service";
import { BUNDLE_DEFINITIONS, BundlesService, type BundleDto } from "./bundles.service";

const databaseUrl = process.env.SHARDS_TEST_DATABASE_URL;
const steamId64 = "76561198000000004";
const userId = `user_${steamId64}`;

describe.skipIf(!databaseUrl)("authoritative bundles and discounted settlement", () => {
  let app: INestApplication;
  let pool: Pool;
  let bundles: BundlesService;
  let cart: CartService;
  let checkout: CheckoutService;
  let wallet: WalletService;
  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    pool = new Pool({ connectionString: databaseUrl });
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    bundles = app.get(BundlesService);
    cart = app.get(CartService);
    checkout = app.get(CheckoutService);
    wallet = app.get(WalletService);
    const users = app.get(UsersService);
    await users.upsertSteamUser({ claimedIdentifier: `https://steamcommunity.com/openid/id/${steamId64}`, providerEndpoint: "https://steamcommunity.com/openid/login", responseNonce: "bundle-fixture", steamId64 });
    await users.saveSteamTradeCredential(userId, { partner: "39734273", token: "fixtureToken" });
    await wallet.creditUser({ userId, amountCoinMinor: 10_000_000, idempotencyKey: "bundle-fixture-credit", reason: "test-credit" });
    for (const [id, members] of Object.entries(BUNDLE_DEFINITIONS)) {
      for (const [index, name] of members.entries()) {
        const marketName = `${name} (Factory New)`;
        const slug = `fixture-${id}-${index}`;
        await pool.query(`INSERT INTO supplier_listings (supplier, game, market_hash_name, active, available_quantity, price_microusd, last_sync_run_id)
          VALUES ('sih','cs2',$1,true,10,$2,gen_random_uuid())`, [marketName, (index + 1) * 1_000_000]);
        await pool.query(`INSERT INTO catalog_products (id,slug,kind,category,game,product_type,title,description,price_coin_minor,availability,fulfillment_mode,popularity,meta,keywords,details,supplier_provider,supplier_item_id)
          SELECT $1,$1,'skins','skins','CS2','rifle',$2,'fixture',100,'available','steam-trade',1,'{}','{}',details,'sih',$2
          FROM catalog_products LIMIT 1`, [slug, marketName]);
      }
    }
  });
  afterAll(async () => { delete process.env.DATABASE_URL; await app.close(); await pool.end(); });

  it("publishes three public sets and versions SIH markup to exactly 25 percent", async () => {
    const response = await request(app.getHttpServer() as Parameters<typeof request>[0]).get("/bundles").expect(200);
    const body = response.body as { bundles: BundleDto[] };
    expect(body.bundles.map((bundle: { id: string }) => bundle.id)).toEqual(["mono", "chroma", "metal"]);
    expect(body.bundles.every((bundle: { availability: string }) => bundle.availability === "available")).toBe(true);
    const active = await pool.query("SELECT markup_bps FROM pricing_settings WHERE scope = 'sih-skins' AND superseded_at IS NULL");
    expect(active.rows).toEqual([{ markup_bps: 2500 }]);
    const quote = await bundles.quote("mono");
    expect(quote.items[0]?.price.amountMinor).toBe(17900); // $1 * 95 RUB * 1.25 * 1.5 Coins, rounded to whole Coin.
  });

  it("keeps set members atomic while standalone duplicates remain independent", async () => {
    const added = await cart.setBundle(userId, "mono");
    expect(added.items).toEqual([]);
    expect(added.bundles).toHaveLength(1);
    expect((await cart.setBundle(userId, "mono")).bundles).toHaveLength(1);
    expect((await cart.removeItem(userId, "fixture-mono-0")).bundles[0]?.items).toHaveLength(3);
    const mixed = await cart.setItem({ userId, productSlug: "fixture-mono-0", quantity: 1 });
    expect(mixed.items).toHaveLength(1);
    expect(mixed.totalCoinMinor).toBe((mixed.items[0]?.lineTotalCoinMinor ?? 0) + (mixed.bundles[0]?.totalCoinMinor ?? 0));
    expect((await cart.removeBundle(userId, "mono")).items).toHaveLength(1);
    await cart.clearCart(userId);
    expect(await cart.getCart(userId)).toEqual({ items: [], bundles: [], totalCoinMinor: 0 });
  });

  it("rejects unknown, partial, forged and repeated bundle membership", async () => {
    for (const items of [
      [{ productSlug: "fixture-mono-0", quantity: 1, bundleId: "fake" }],
      [{ productSlug: "fixture-mono-0", quantity: 1, bundleId: "mono" }],
      [0, 1, 2].map(i => ({ productSlug: `fixture-chroma-${i}`, quantity: 1, bundleId: "mono" })),
      [0, 0, 2].map(i => ({ productSlug: `fixture-mono-${i}`, quantity: 1, bundleId: "mono" })),
      [0, 1, 2].map(i => ({ productSlug: `fixture-mono-${i}`, quantity: 2, bundleId: "mono" })),
    ]) {
      await expect(checkout.checkoutFromCart({ userId, idempotencyKey: "forged-bundle", acceptedTotalCoinMinor: 1_000_000, items })).rejects.toThrow();
    }
    expect((await pool.query<{ count: number }>("SELECT count(*)::integer AS count FROM orders")).rows[0]?.count).toBe(0);
  });

  it("retries purchased-entry cleanup without deleting items added after the order", async () => {
    const current = await cart.setBundle(userId, "chroma");
    const order = await checkout.checkoutFromCart({ userId, idempotencyKey: "cleanup-bundle", acceptedTotalCoinMinor: current.totalCoinMinor, items: await cart.getCheckoutItems(userId) });
    await cart.setItem({ userId, productSlug: "fixture-metal-0", quantity: 1 });
    await cart.clearPurchasedCart(userId, order.id);
    expect((await cart.getCart(userId)).bundles).toEqual([]);
    expect((await cart.getCart(userId)).items.map(item => item.productSlug)).toEqual(["fixture-metal-0"]);
    await cart.setBundle(userId, "chroma");
    await cart.clearPurchasedCart(userId, order.id);
    expect((await cart.getCart(userId)).bundles.map(bundle => bundle.id)).toEqual(["chroma"]);
    await cart.clearCart(userId);
    await wallet.settleOrderHold({ orderId: order.id, userId, captureCoinMinor: 0, idempotencyKey: "cleanup-release", reason: "fixture" });
  });

  it("persists discounted line amounts, preserves snapshot replay after clearing and releases the discounted hold", async () => {
    const current = await cart.setBundle(userId, "mono");
    const command = { userId, idempotencyKey: "bundle-checkout", acceptedTotalCoinMinor: current.totalCoinMinor, items: await cart.getCheckoutItems(userId) };
    const order = await checkout.checkoutFromCart(command);
    expect(order.lines).toHaveLength(3);
    expect(order.lines.every(line => line.bundleId === "mono")).toBe(true);
    expect(order.lines.reduce((sum, line) => sum + line.unitPriceCoinMinor, 0)).toBe(current.totalCoinMinor);
    expect((await wallet.getBalance(userId)).heldCoinMinor).toBe(current.totalCoinMinor);
    await pool.query("UPDATE supplier_listings SET active = false WHERE market_hash_name = $1", [`${BUNDLE_DEFINITIONS.mono[0]} (Factory New)`]);
    const unavailable = await cart.getCart(userId);
    expect(unavailable.bundles[0]?.availability).toBe("on-request");
    expect(unavailable.bundles[0]?.items).toHaveLength(3);
    await expect(checkout.checkoutFromCart({ ...command, idempotencyKey: "unavailable-bundle" })).rejects.toThrow();
    expect((await cart.removeBundle(userId, "mono")).bundles).toEqual([]);
    expect(await checkout.checkoutFromCart(command)).toEqual(order);
    expect(await checkout.replayServerCart(userId, command.idempotencyKey, command.acceptedTotalCoinMinor)).toEqual(order);
    await pool.query("UPDATE order_lines SET status = 'supplier_failed' WHERE order_id = $1", [order.id]);
    const successful = order.lines[0];
    if (!successful) throw new Error("Missing line");
    await pool.query("UPDATE order_lines SET status = 'supplier_finished' WHERE id = $1", [successful.id]);
    const fulfillment = app.get(FulfillmentService);
    await app.get(DatabaseService).transaction(client => fulfillment["settleOrderIfTerminal"](client, { orderId: order.id, userId }));
    const balance = await wallet.getBalance(userId);
    expect(balance.heldCoinMinor).toBe(0);
    expect(balance.availableCoinMinor).toBe(10_000_000 - successful.unitPriceCoinMinor);
    expect((await pool.query<{ status: string }>("SELECT status FROM orders WHERE id = $1", [order.id])).rows[0]?.status).toBe("partially_fulfilled");
  });
});
