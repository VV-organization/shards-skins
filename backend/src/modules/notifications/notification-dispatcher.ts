import { Inject, Injectable } from "@nestjs/common";

import { renderEmailVerificationEmail, type RenderedEmail } from "./email-templates";
import { NotificationOutboxService, type NotificationOutboxRecord } from "./notification-outbox.service";
import { SmtpMailClient } from "./smtp-mail.client";
import { SlackClient } from "./slack.client";

export type NotificationDispatchResult =
  | { status: "none" }
  | { status: "accepted"; notificationId: string }
  | { status: "retry_scheduled"; notificationId: string };

type VerificationPayload = { email: string; expireMinutes: number; otp: string };

function isVerificationPayload(value: Record<string, unknown>): value is VerificationPayload {
  return typeof value.email === "string" && typeof value.otp === "string" && typeof value.expireMinutes === "number";
}


@Injectable()
export class NotificationDispatcher {
  constructor(
    @Inject(NotificationOutboxService) private readonly outbox: NotificationOutboxService,
    @Inject(SmtpMailClient) private readonly mail: Pick<SmtpMailClient, "send">,
    private readonly from: string,
    @Inject(SlackClient) private readonly slack?: Pick<SlackClient, "send">,
  ) {}

  async processNext(): Promise<NotificationDispatchResult> {
    const notification = await this.outbox.claimNext();
    if (notification === null) return { status: "none" };
    try {
      if (notification.channel === "slack") {
        if (!this.slack) throw new Error("SLACK_CLIENT_NOT_AVAILABLE");
        await this.slack.send({ blocks: this.resolveSlackBlocks(notification) });
        await this.outbox.markAccepted(notification.id, "slack-webhook");
        return { status: "accepted", notificationId: notification.id };
      }
      const email = this.resolveEmail(notification);
      const accepted = await this.mail.send({ ...email.message, from: this.from, to: email.to, idempotencyKey: notification.idempotencyKey });
      await this.outbox.markAccepted(notification.id, accepted.emailId);
      return { status: "accepted", notificationId: notification.id };
    } catch (error) {
      const errorCode = error instanceof Error ? error.message : "NOTIFICATION_DISPATCH_FAILED";
      await this.outbox.markRetryableFailure(notification.id, errorCode);
      return { status: "retry_scheduled", notificationId: notification.id };
    }
  }

  private resolveSlackBlocks(notification: NotificationOutboxRecord): unknown[] {
    if (notification.eventType === "order.slack-alert") return this.resolveOrderSlackBlocks(notification);
    throw new Error("SLACK_NOTIFICATION_EVENT_UNSUPPORTED");
  }

  private resolveOrderSlackBlocks(notification: NotificationOutboxRecord): unknown[] {
    const payload = notification.payload;
    if (typeof payload.orderNumber !== "string" || typeof payload.amount !== "string" || typeof payload.itemSummary !== "string") {
      throw new Error("SLACK_NOTIFICATION_PAYLOAD_INVALID");
    }
    const fields = [
      { type: "mrkdwn", text: `*Заказ:* ${payload.orderNumber}` },
      { type: "mrkdwn", text: `*Сумма:* ${payload.amount}` },
      { type: "mrkdwn", text: `*Товары:* ${payload.itemSummary}` },
    ];
    if (typeof payload.recipientSummary === "string" && payload.recipientSummary.length > 0) {
      fields.push({ type: "mrkdwn", text: `*Получатель:* ${payload.recipientSummary}` });
    }
    return [
      { type: "header", text: { type: "plain_text", text: "Новый заказ Shards" } },
      { type: "section", fields },
    ];
  }

  private resolveEmail(notification: NotificationOutboxRecord): { to: string; message: RenderedEmail } {
    if (notification.channel !== "email") throw new Error("NOTIFICATION_CHANNEL_UNSUPPORTED");
    if (notification.eventType === "email.verification" && isVerificationPayload(notification.payload)) {
      return { to: notification.payload.email, message: renderEmailVerificationEmail({ code: notification.payload.otp, expireMinutes: notification.payload.expireMinutes }) };
    }
    throw new Error("NOTIFICATION_EVENT_PAYLOAD_INVALID");
  }
}
