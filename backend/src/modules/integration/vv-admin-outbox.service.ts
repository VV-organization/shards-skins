import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../../common/database/database.service";

export type VvAdminIntegrationEvent = {
  schemaVersion: 2;
  eventId: string;
  eventType:
    | "order.created"
    | "order.completed"
    | "order.paid"
    | "order.failed"
    | "order.cancelled"
    | "order.refunded"
    | "top_up.created"
    | "top_up.completed"
    | "top_up.failed";
  source: "customer" | "scenario";
  occurredAt: string;
  site: { domain: string };
  subject: { type: "order" | "top_up"; externalId: string };
  data: Record<string, unknown> & {
    payment?: {
      status: "pending" | "paid" | "failed" | "refunded";
      method: {
        type: "internal_balance" | "card" | "sbp" | "crypto" | "other";
        displayName: string;
        provider: string | null;
      };
      paidAt: string | null;
    };
  };
};

export type VvAdminOutboxRecord = {
  id: string;
  eventId: string;
  eventType: string;
  subjectType: "order" | "top_up";
  subjectExternalId: string;
  payload: VvAdminIntegrationEvent;
  status: "pending" | "processing" | "accepted" | "failed";
  attemptCount: number;
};

type VvAdminOutboxRow = {
  id: string;
  event_id: string;
  event_type: string;
  subject_type: "order" | "top_up";
  subject_external_id: string;
  payload: VvAdminIntegrationEvent;
  status: VvAdminOutboxRecord["status"];
  attempt_count: number;
};

@Injectable()
export class VvAdminOutboxService {
  private readonly memoryByEventId = new Map<string, VvAdminOutboxRecord>();

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async enqueue(event: VvAdminIntegrationEvent): Promise<VvAdminOutboxRecord> {
    assertNoSecrets(event);
    if (!this.database.isConfigured()) {
      const existing = this.memoryByEventId.get(event.eventId);
      if (existing) return cloneRecord(existing);
      const record: VvAdminOutboxRecord = {
        id: randomUUID(),
        eventId: event.eventId,
        eventType: event.eventType,
        subjectType: event.subject.type,
        subjectExternalId: event.subject.externalId,
        payload: event,
        status: "pending",
        attemptCount: 0,
      };
      this.memoryByEventId.set(event.eventId, record);
      return cloneRecord(record);
    }

    const result = await this.database.query<VvAdminOutboxRow>(`
      INSERT INTO vv_admin_integration_outbox (
        event_id, event_type, subject_type, subject_external_id, payload
      )
      VALUES ($1, $2, $3, $4, $5::jsonb)
      ON CONFLICT (event_id) DO UPDATE SET updated_at = vv_admin_integration_outbox.updated_at
      RETURNING id, event_id, event_type, subject_type, subject_external_id, payload, status, attempt_count
    `, [
      event.eventId,
      event.eventType,
      event.subject.type,
      event.subject.externalId,
      JSON.stringify(event),
    ]);
    const row = result.rows[0];
    if (!row) throw new Error("VV_ADMIN_OUTBOX_ENQUEUE_FAILED");
    return fromRow(row);
  }

  async claimNext(): Promise<VvAdminOutboxRecord | null> {
    if (!this.database.isConfigured()) {
      const record = [...this.memoryByEventId.values()].find((candidate) => candidate.status === "pending");
      if (!record) return null;
      record.status = "processing";
      record.attemptCount += 1;
      return cloneRecord(record);
    }

    return this.database.transaction(async (client) => {
      const claimed = await client.query<VvAdminOutboxRow>(`
        SELECT id, event_id, event_type, subject_type, subject_external_id, payload, status, attempt_count
        FROM vv_admin_integration_outbox
        WHERE status = 'pending' AND available_at <= clock_timestamp()
        ORDER BY available_at ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `);
      const row = claimed.rows[0];
      if (!row) return null;
      const updated = await client.query<VvAdminOutboxRow>(`
        UPDATE vv_admin_integration_outbox
        SET status = 'processing', locked_at = clock_timestamp(), attempt_count = attempt_count + 1, updated_at = clock_timestamp()
        WHERE id = $1
        RETURNING id, event_id, event_type, subject_type, subject_external_id, payload, status, attempt_count
      `, [row.id]);
      const claimedRow = updated.rows[0];
      if (!claimedRow) throw new Error("VV_ADMIN_OUTBOX_CLAIM_FAILED");
      await client.query(`
        INSERT INTO vv_admin_integration_attempts (outbox_id, status, idempotency_key, request_snapshot)
        VALUES ($1, 'sending', $2, $3::jsonb)
      `, [
        claimedRow.id,
        `${claimedRow.event_id}:${claimedRow.attempt_count}`,
        JSON.stringify({ eventId: claimedRow.event_id, eventType: claimedRow.event_type }),
      ]);
      return fromRow(claimedRow);
    });
  }

  async markAccepted(outboxId: string, statusCode: number): Promise<void> {
    if (!this.database.isConfigured()) {
      const record = [...this.memoryByEventId.values()].find((candidate) => candidate.id === outboxId);
      if (!record) throw new Error("VV_ADMIN_OUTBOX_NOT_FOUND");
      record.status = "accepted";
      return;
    }
    await this.database.transaction(async (client) => {
      const row = await client.query<{ event_id: string; attempt_count: number }>(
        "SELECT event_id, attempt_count FROM vv_admin_integration_outbox WHERE id = $1 FOR UPDATE",
        [outboxId],
      );
      const outbox = row.rows[0];
      if (!outbox) throw new Error("VV_ADMIN_OUTBOX_NOT_FOUND");
      await client.query(`
        UPDATE vv_admin_integration_attempts
        SET status = 'accepted', response_snapshot = $3::jsonb, finished_at = clock_timestamp()
        WHERE outbox_id = $1 AND idempotency_key = $2
      `, [outboxId, `${outbox.event_id}:${outbox.attempt_count}`, JSON.stringify({ statusCode })]);
      await client.query(`
        UPDATE vv_admin_integration_outbox
        SET status = 'accepted', completed_at = clock_timestamp(), locked_at = NULL, last_error_code = NULL, updated_at = clock_timestamp()
        WHERE id = $1
      `, [outboxId]);
    });
  }

  async markRetryableFailure(outboxId: string, errorCode: string): Promise<void> {
    if (!this.database.isConfigured()) {
      const record = [...this.memoryByEventId.values()].find((candidate) => candidate.id === outboxId);
      if (!record) throw new Error("VV_ADMIN_OUTBOX_NOT_FOUND");
      record.status = "pending";
      return;
    }
    await this.database.query(`
      UPDATE vv_admin_integration_outbox
      SET status = 'pending', locked_at = NULL, last_error_code = $2,
        available_at = clock_timestamp() + interval '1 minute', updated_at = clock_timestamp()
      WHERE id = $1
    `, [outboxId, errorCode.slice(0, 120)]);
  }
}

function fromRow(row: VvAdminOutboxRow): VvAdminOutboxRecord {
  return {
    id: row.id,
    eventId: row.event_id,
    eventType: row.event_type,
    subjectType: row.subject_type,
    subjectExternalId: row.subject_external_id,
    payload: row.payload,
    status: row.status,
    attemptCount: row.attempt_count,
  };
}

function cloneRecord(record: VvAdminOutboxRecord): VvAdminOutboxRecord {
  return { ...record, payload: { ...record.payload, data: { ...record.payload.data } } };
}

function assertNoSecrets(event: VvAdminIntegrationEvent): void {
  if (/(token|secret|password|credential|authorization|cookie|cvv|cardnumber|pan)/i.test(JSON.stringify(event))) {
    throw new Error("VV_ADMIN_OUTBOX_SENSITIVE_PAYLOAD_FORBIDDEN");
  }
}
