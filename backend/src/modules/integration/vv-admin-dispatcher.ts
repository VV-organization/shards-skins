import { createHmac } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import type { AppConfig } from "../../config/app-config";
import { APP_CONFIG } from "../../config/app-config.module";
import { optionalStringFromFile } from "../../config/secret-file";
import { VvAdminOutboxService } from "./vv-admin-outbox.service";

@Injectable()
export class VvAdminDispatcher {
  constructor(
    @Inject(VvAdminOutboxService) private readonly outbox: VvAdminOutboxService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async processNext(): Promise<"idle" | "accepted" | "retry"> {
    const record = await this.outbox.claimNext();
    if (!record) return "idle";

    try {
      const settings = this.requireSettings();
      const rawBody = JSON.stringify(record.payload);
      const timestamp = new Date().toISOString();
      const response = await fetch(settings.webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-vv-site-key": settings.siteKey,
          "x-vv-signature-version": "1",
          "x-vv-timestamp": timestamp,
          "x-vv-event-id": record.eventId,
          "x-vv-signature": signWebhook({
            secret: settings.secret,
            timestamp,
            eventId: record.eventId,
            rawBody,
          }),
        },
        body: rawBody,
      });
      if (!response.ok) {
        await this.outbox.markRetryableFailure(record.id, `HTTP_${response.status}`);
        return "retry";
      }
      await this.outbox.markAccepted(record.id, response.status);
      return "accepted";
    } catch (error) {
      await this.outbox.markRetryableFailure(record.id, readErrorCode(error));
      return "retry";
    }
  }

  private requireSettings(): {
    readonly webhookUrl: string;
    readonly siteKey: string;
    readonly secret: string;
  } {
    const webhookUrl = this.config.integration.vvAdminWebhookUrl;
    const siteKey = this.config.integration.vvAdminWebhookSiteKey;
    const secret = optionalStringFromFile(
      this.config.integration.vvAdminWebhookSecretFile,
    );
    if (!webhookUrl || !siteKey || !secret) {
      throw new Error("VV_ADMIN_WEBHOOK_NOT_CONFIGURED");
    }
    return { webhookUrl, siteKey, secret };
  }
}

function signWebhook(input: {
  readonly secret: string;
  readonly timestamp: string;
  readonly eventId: string;
  readonly rawBody: string;
}): string {
  const canonical = `v1.${input.timestamp}.${input.eventId}.${input.rawBody}`;
  return `sha256=${createHmac("sha256", input.secret).update(canonical).digest("hex")}`;
}

function readErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "UNKNOWN";
  return error.message.replace(/[^A-Z0-9_:-]/gi, "_").slice(0, 120);
}
