import { readFileSync } from "node:fs";

import { Injectable } from "@nestjs/common";

import type { AppConfig } from "../../config/app-config";

export type SlackSendInput = { blocks: unknown[] };

@Injectable()
export class SlackClient {
  private readonly webhookUrl: string | null;

  constructor(config: AppConfig) {
    this.webhookUrl = config.notifications.slackOrdersWebhookUrlFile
      ? readFileSync(config.notifications.slackOrdersWebhookUrlFile, "utf8").trim() || null
      : null;
  }

  async send(input: SlackSendInput): Promise<void> {
    if (!this.webhookUrl) throw new Error("SLACK_SHARDS_ORDERS_WEBHOOK_NOT_CONFIGURED");
    const response = await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blocks: input.blocks }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("SLACK_SHARDS_ORDERS_WEBHOOK_REJECTED");
  }
}
