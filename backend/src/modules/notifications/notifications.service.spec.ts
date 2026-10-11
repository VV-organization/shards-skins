import { describe, expect, it } from "vitest";

import { renderEmailVerificationEmail } from "./email-templates";
import { NotificationDispatcher } from "./notification-dispatcher";
import { NotificationOutboxService } from "./notification-outbox.service";
import type { MailSendInput } from "./smtp-mail.client";

describe("notifications", () => {
  it("renders the approved OTP text in plain text and escaped HTML", () => {
    const message = renderEmailVerificationEmail({ code: "123456", expireMinutes: 10 });

    expect(message.subject).toBe("Подтверждение адреса электронной почты — Shards");
    expect(message.text).toContain("Код подтверждения: 123456");
    expect(message.html).toContain("Команда Shards");
  });

  it("does not create a second notification for the same idempotency key", async () => {
    const outbox = new NotificationOutboxService({ isConfigured: () => false } as never);

    const first = await outbox.enqueue({
      channel: "email",
      entityId: "challenge_1",
      eventType: "email.verification",
      idempotencyKey: "email-verification/challenge_1",
      payload: { challengeId: "challenge_1" },
    });
    const second = await outbox.enqueue({
      channel: "email",
      entityId: "challenge_1",
      eventType: "email.verification",
      idempotencyKey: "email-verification/challenge_1",
      payload: { challengeId: "challenge_1" },
    });

    expect(second).toEqual(first);
  });

  it("refuses gift-card code material in a generic outbox payload", async () => {
    const outbox = new NotificationOutboxService({ isConfigured: () => false } as never);
    await expect(outbox.enqueue({
      channel: "email",
      entityId: "line_1",
      eventType: "apple-card.delivery",
      idempotencyKey: "apple-card-delivery/line_1/1",
      payload: { giftCardCode: "ABCD-1234-EFGH" },
    })).rejects.toThrow("NOTIFICATION_OUTBOX_SENSITIVE_PAYLOAD_FORBIDDEN");
  });

  it("claims one notification and records an accepted send", async () => {
    const outbox = new NotificationOutboxService({ isConfigured: () => false } as never);
    const queued = await outbox.enqueue({
      channel: "email",
      entityId: "challenge_2",
      eventType: "email.verification",
      idempotencyKey: "email-verification/challenge_2",
      payload: { challengeId: "challenge_2", email: "buyer@example.com", otp: "123456", expireMinutes: 10 },
    });

    expect((await outbox.claimNext())?.id).toBe(queued.id);
    await outbox.markAccepted(queued.id, "re_123", 1);
    expect(await outbox.claimNext()).toBeNull();
  });

  it("sends a queued OTP email through SMTP using the durable application idempotency key", async () => {
    const outbox = new NotificationOutboxService({ isConfigured: () => false } as never);
    await outbox.enqueue({
      channel: "email",
      entityId: "challenge_3",
      eventType: "email.verification",
      idempotencyKey: "email-verification/challenge_3",
      payload: { challengeId: "challenge_3", email: "buyer@example.com", otp: "123456", expireMinutes: 10 },
    });
    const send = (input: MailSendInput) => {
      expect(input).toMatchObject({ to: "buyer@example.com", idempotencyKey: "email-verification/challenge_3" });
      return Promise.resolve({ emailId: "smtp-message-id" });
    };

    const result = await new NotificationDispatcher(outbox, { send }, "Shards <support@shards.example>").processNext();
    expect(result.status).toBe("accepted");
    if (result.status === "accepted") expect(typeof result.notificationId).toBe("string");
  });

  it("sends a generic order Slack alert for any checkout order", async () => {
    const outbox = new NotificationOutboxService({ isConfigured: () => false } as never);
    await outbox.enqueue({
      channel: "slack",
      entityId: "order_1",
      eventType: "order.slack-alert",
      idempotencyKey: "order-slack-alert/order_1",
      payload: {
        amount: "6 360 Coins",
        itemSummary: "2x Desert Eagle | Printstream",
        orderNumber: "VLT-ORDER1",
      },
    });
    const sent: unknown[] = [];

    const result = await new NotificationDispatcher(
      outbox,
      { send: () => Promise.resolve({ emailId: "unused" }) },
      "Shards <support@shards.example>",
      { send: (input) => { sent.push(input); return Promise.resolve(); } },
    ).processNext();

    expect(result.status).toBe("accepted");
    expect(JSON.stringify(sent)).toContain("Новый заказ Shards");
    expect(JSON.stringify(sent)).toContain("2x Desert Eagle | Printstream");
  });
});
