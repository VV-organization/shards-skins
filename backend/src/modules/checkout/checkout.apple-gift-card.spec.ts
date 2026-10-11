import { describe, expect, it } from "vitest";

import { CheckoutService } from "./checkout.service";

describe("CheckoutService Apple gift cards", () => {
  const config = {
    integration: { publicOrigin: "https://shardsapp24.com" },
  };

  it("requires a verified delivery email instead of a Steam recipient", async () => {
    const catalog = {
      getBySlug: () => Promise.resolve({
        id: "apple_us_25",
        slug: "apple-usd-25",
        kind: "apple_gift_card",
        title: "Apple Gift Card 25 USD",
        availability: "available",
        price: { amountMinor: 2500 },
      }),
    };
    const service = new CheckoutService({} as never, catalog as never, {} as never, {} as never, {} as never, config as never, {} as never);

    await expect((service as never as { prepareLines: (userId: string, steamId64: undefined, email: undefined, items: unknown[]) => Promise<unknown> }).prepareLines(
      "user_1", undefined, undefined, [{ productSlug: "apple-usd-25", quantity: 1 }],
    )).rejects.toMatchObject({ code: "DELIVERY_EMAIL_REQUIRED" });
  });

  it("puts the full verified delivery email into the generic Slack order alert", async () => {
    const deliveryEmail = "a.golubev@finext.io";
    let slackPayload: Record<string, unknown> | null = null;
    const appleProduct = {
      id: "apple_ru_500",
      slug: "apple-rub-500",
      kind: "apple_gift_card",
      title: "Подарочная карта Apple",
      availability: "available",
      price: { amountMinor: 75000 },
      details: {
        appleGiftCard: {
          currency: "RUB",
          nominalMinor: 50000,
          regionCode: "RU",
          regionLabel: "Россия",
        },
      },
    };
    const database = {
      query: (text: string) => {
        if (text.includes("FROM orders") && text.includes("WHERE user_id")) return Promise.resolve({ rows: [] });
        throw new Error(`unexpected query outside transaction: ${text}`);
      },
      transaction: async (work: (client: { query: (text: string, values?: readonly unknown[]) => Promise<{ rows: unknown[] }> }) => Promise<unknown>) => {
        const client = {
          query: (text: string, values: readonly unknown[] = []) => {
            if (text.includes("FROM orders") && text.includes("WHERE user_id")) return Promise.resolve({ rows: [] });
            if (text.includes("INSERT INTO orders")) return Promise.resolve({ rows: [{ id: "order_1" }] });
            if (text.includes("INSERT INTO order_lines")) return Promise.resolve({ rows: [{ id: "line_1" }] });
            if (text.includes("INSERT INTO notification_outbox")) {
              const parsedPayload: unknown = JSON.parse(String(values[2]));
              if (typeof parsedPayload !== "object" || parsedPayload === null || Array.isArray(parsedPayload)) throw new Error("invalid slack payload");
              slackPayload = parsedPayload as Record<string, unknown>;
              return Promise.resolve({ rows: [] });
            }
            if (text.includes("SELECT id, user_id, status, total_coin_minor")) {
              return Promise.resolve({ rows: [{
                id: "order_1",
                user_id: "user_1",
                status: "held",
                total_coin_minor: 75000,
                recipient_snapshots: [{ kind: "delivery-email", email: deliveryEmail, verificationId: "user_1" }],
                request_hash: "hash",
              }] });
            }
            if (text.includes("SELECT id, product_slug, kind, title")) {
              return Promise.resolve({ rows: [{
                id: "line_1",
                product_slug: "apple-rub-500",
                kind: "apple_gift_card",
                title: "Подарочная карта Apple",
                quantity: 1,
                unit_price_coin_minor: 75000,
                recipient_snapshot: { kind: "delivery-email", email: deliveryEmail, verificationId: "user_1" },
              }] });
            }
            return Promise.resolve({ rows: [] });
          },
        };
        return work(client);
      },
    };
    const catalog = { getBySlug: () => Promise.resolve(appleProduct) };
    const fulfillment = { enqueueOrderLineCommands: () => Promise.resolve() };
    const users = { requireUser: () => Promise.resolve({ steam: { steamId64: undefined }, email: { address: deliveryEmail } }) };
    const wallet = {
      createHold: () => Promise.resolve(),
      lockUserBalance: () => Promise.resolve(),
    };
    const service = new CheckoutService(database as never, catalog as never, fulfillment as never, users as never, wallet as never, config as never, {} as never);

    await service.checkoutFromCart({
      userId: "user_1",
      idempotencyKey: "checkout-apple-full-email-slack",
      acceptedTotalCoinMinor: 75000,
      items: [{ productSlug: "apple-rub-500", quantity: 1 }],
    });

    expect(slackPayload).toMatchObject({ recipientSummary: deliveryEmail });
  });
});
