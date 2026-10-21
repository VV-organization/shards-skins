import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../../config/app-config";
import { VvAdminDispatcher } from "./vv-admin-dispatcher";
import { VvAdminOutboxService, type VvAdminIntegrationEvent } from "./vv-admin-outbox.service";

const event: VvAdminIntegrationEvent = {
  schemaVersion: 2,
  eventId: "evt_shards_order_1",
  eventType: "order.created",
  source: "customer",
  occurredAt: "2026-08-13T12:00:00.000Z",
  site: { domain: "shards.example" },
  subject: { type: "order", externalId: "order-1" },
  data: {
    externalOrderId: "order-1",
    externalUserId: "user-1",
    status: "created",
    payment: {
      status: "paid",
      method: {
        type: "internal_balance",
        displayName: "Shards Coins",
        provider: null,
      },
      paidAt: "2026-08-13T12:00:00.000Z",
    },
    totalAmount: "1250.00",
    currency: "FC",
    createdAtExternal: "2026-08-13T12:00:00.000Z",
    paidAtExternal: "2026-08-13T12:00:00.000Z",
    items: [],
  },
};

function createOutbox() {
  return new VvAdminOutboxService({ isConfigured: () => false } as never);
}

function createConfig(secretFile: string): AppConfig {
  return {
    nodeEnv: "test",
    port: 3000,
    admin: {},
    steam: {},
    arcoPay: { paymentOrigin: "https://payment.paidlayer.com", environment: "sandbox", providerMode: "disabled", apiUrl: "https://api.clickit.team/api/v1" },
    sih: {
      marketBaseUrl: "https://api.sih.market",
      maximumBodyBytes: 4096,
      requestTimeoutMs: 2500,
      steamRefillBaseUrl: "https://core.steaminventoryhelper.com",
    },
    catalog: { publicGames: ["cs2"] },
    notifications: {
      smtpHost: "smtp.purelymail.com",
      smtpPort: 465,
      smtpSecure: true,
    },
    integration: {
      publicOrigin: "https://shards.example",
      adminOrigin: "https://shards.example",
      vvAdminWebhookUrl: "https://admin.example/commerce/webhook",
      vvAdminSiteKey: "shards",
      vvAdminWebhookSiteKey: "shards-webhook-site-key",
      vvAdminWebhookSecretFile: secretFile,
    },
    corsOrigins: [],
  };
}

describe("VvAdminOutboxService", () => {
  it("deduplicates events by event id and claims pending work", async () => {
    const outbox = createOutbox();

    const first = await outbox.enqueue(event);
    const second = await outbox.enqueue(event);
    const claimed = await outbox.claimNext();

    expect(second.id).toBe(first.id);
    expect(claimed).toMatchObject({
      id: first.id,
      eventId: "evt_shards_order_1",
      status: "processing",
      attemptCount: 1,
    });
  });

  it("refuses secret-like payloads", async () => {
    const outbox = createOutbox();

    await expect(
      outbox.enqueue({
        ...event,
        data: {
          ...event.data,
          attributes: { apiToken: "must-not-leave-site" },
        },
      }),
    ).rejects.toThrow("SENSITIVE_PAYLOAD");
  });
});

describe("VvAdminDispatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:01:00.000Z"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("sends a signed event to VV Admin and marks it accepted", async () => {
    const outbox = createOutbox();
    await outbox.enqueue(event);
    const secretFile = join(mkdtempSync(join(tmpdir(), "vv-admin-")), "secret");
    writeFileSync(secretFile, "shared-secret\n", "utf8");
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchImpl);
    const dispatcher = new VvAdminDispatcher(outbox, createConfig(secretFile));

    await expect(dispatcher.processNext()).resolves.toBe("accepted");

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://admin.example/commerce/webhook");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-vv-site-key"]).toBe("shards-webhook-site-key");
    expect(headers["x-vv-event-id"]).toBe("evt_shards_order_1");
    expect(headers["x-vv-signature"]).toMatch(/^sha256=/);
    await expect(outbox.claimNext()).resolves.toBeNull();
  });
});
