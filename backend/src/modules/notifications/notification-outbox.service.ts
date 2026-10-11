import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../../common/database/database.service";

export type NotificationChannel = "email" | "slack";
export type NotificationOutboxInput = {
  channel: NotificationChannel;
  eventType: string;
  entityId: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
};
export type NotificationOutboxRecord = NotificationOutboxInput & {
  id: string;
  status: "pending" | "processing" | "accepted" | "failed";
  attemptCount: number;
};

type NotificationOutboxRow = {
  id: string;
  channel: NotificationChannel;
  event_type: string;
  entity_id: string;
  idempotency_key: string;
  payload: Record<string, unknown>;
  status: NotificationOutboxRecord["status"];
  attempt_count: number;
};

function assertRedactedPayload(payload: Record<string, unknown>): void {
  const serialized = JSON.stringify(payload).toLowerCase();
  if (/(?:gift[_-]?card[_-]?code|code[_-]?(?:ciphertext|nonce|auth[_-]?tag)|ciphertext|auth[_-]?tag)/.test(serialized)) {
    throw new Error("NOTIFICATION_OUTBOX_SENSITIVE_PAYLOAD_FORBIDDEN");
  }
}

@Injectable()
export class NotificationOutboxService {
  private readonly memoryByKey = new Map<string, NotificationOutboxRecord>();

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async enqueue(input: NotificationOutboxInput): Promise<NotificationOutboxRecord> {
    assertRedactedPayload(input.payload);
    const memoryKey = `${input.channel}:${input.idempotencyKey}`;
    if (!this.database.isConfigured()) {
      const existing = this.memoryByKey.get(memoryKey);
      if (existing) return { ...existing, payload: { ...existing.payload } };
      const record: NotificationOutboxRecord = { ...input, id: randomUUID(), status: "pending", attemptCount: 0, payload: { ...input.payload } };
      this.memoryByKey.set(memoryKey, record);
      return { ...record, payload: { ...record.payload } };
    }

    const result = await this.database.query<NotificationOutboxRow>(`
      INSERT INTO notification_outbox (channel, event_type, entity_id, idempotency_key, payload)
      VALUES ($1, $2, $3, $4, $5::jsonb)
      ON CONFLICT (channel, idempotency_key) DO UPDATE SET updated_at = notification_outbox.updated_at
      RETURNING id, channel, event_type, entity_id, idempotency_key, payload, status, attempt_count
    `, [input.channel, input.eventType, input.entityId, input.idempotencyKey, JSON.stringify(input.payload)]);
    const row = result.rows[0];
    if (!row) throw new Error("NOTIFICATION_OUTBOX_ENQUEUE_FAILED");
    return this.fromRow(row);
  }

  async claimNext(): Promise<NotificationOutboxRecord | null> {
    if (!this.database.isConfigured()) {
      const record = [...this.memoryByKey.values()].find((candidate) => candidate.status === "pending");
      if (!record) return null;
      record.status = "processing";
      record.attemptCount += 1;
      return { ...record, payload: { ...record.payload } };
    }
    return this.database.transaction(async (client) => {
      const claimed = await client.query<NotificationOutboxRow>(`
        SELECT id, channel, event_type, entity_id, idempotency_key, payload, status, attempt_count
        FROM notification_outbox
        WHERE status = 'pending' AND available_at <= clock_timestamp()
        ORDER BY available_at ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `);
      const row = claimed.rows[0];
      if (!row) return null;
      const updated = await client.query<NotificationOutboxRow>(`
        UPDATE notification_outbox
        SET status = 'processing', locked_at = clock_timestamp(), attempt_count = attempt_count + 1, updated_at = clock_timestamp()
        WHERE id = $1
        RETURNING id, channel, event_type, entity_id, idempotency_key, payload, status, attempt_count
      `, [row.id]);
      const claimedRow = updated.rows[0];
      if (!claimedRow) throw new Error("NOTIFICATION_OUTBOX_CLAIM_FAILED");
      await client.query(`
        INSERT INTO notification_attempts (notification_id, channel, status, idempotency_key, request_snapshot)
        VALUES ($1, $2, 'sending', $3, $4::jsonb)
      `, [
        claimedRow.id,
        claimedRow.channel,
        `${claimedRow.idempotency_key}:${claimedRow.attempt_count}`,
        JSON.stringify({ applicationIdempotencyKey: claimedRow.idempotency_key }),
      ]);
      return this.fromRow(claimedRow);
    });
  }

  async markAccepted(notificationId: string, providerMessageId: string): Promise<void> {
    if (!this.database.isConfigured()) {
      const record = [...this.memoryByKey.values()].find((candidate) => candidate.id === notificationId);
      if (!record) throw new Error("NOTIFICATION_OUTBOX_NOT_FOUND");
      record.status = "accepted";
      return;
    }
    await this.database.transaction(async (client) => {
      const notification = await client.query<{ channel: NotificationChannel; idempotency_key: string; attempt_count: number }>(`
        SELECT channel, idempotency_key, attempt_count FROM notification_outbox WHERE id = $1 FOR UPDATE
      `, [notificationId]);
      const row = notification.rows[0];
      if (!row) throw new Error("NOTIFICATION_OUTBOX_NOT_FOUND");
      await client.query(`
        UPDATE notification_attempts
        SET status = 'accepted', response_snapshot = $4::jsonb, finished_at = clock_timestamp()
        WHERE notification_id = $1 AND channel = $2 AND idempotency_key = $3
      `, [notificationId, row.channel, `${row.idempotency_key}:${row.attempt_count}`, JSON.stringify({ providerMessageId })]);
      await client.query(`
        UPDATE notification_outbox
        SET status = 'accepted', completed_at = clock_timestamp(), locked_at = NULL, last_error_code = NULL, updated_at = clock_timestamp()
        WHERE id = $1
      `, [notificationId]);
    });
  }

  async markRetryableFailure(notificationId: string, errorCode: string): Promise<void> {
    if (!this.database.isConfigured()) {
      const record = [...this.memoryByKey.values()].find((candidate) => candidate.id === notificationId);
      if (!record) throw new Error("NOTIFICATION_OUTBOX_NOT_FOUND");
      record.status = "pending";
      return;
    }
    await this.database.query(`
      UPDATE notification_outbox
      SET status = 'pending', locked_at = NULL, last_error_code = $2,
        available_at = clock_timestamp() + interval '1 minute', updated_at = clock_timestamp()
      WHERE id = $1
    `, [notificationId, errorCode.slice(0, 120)]);
  }

  private fromRow(row: NotificationOutboxRow): NotificationOutboxRecord {
    return {
      id: row.id,
      channel: row.channel,
      eventType: row.event_type,
      entityId: row.entity_id,
      idempotencyKey: row.idempotency_key,
      payload: row.payload,
      status: row.status,
      attemptCount: row.attempt_count,
    };
  }
}
