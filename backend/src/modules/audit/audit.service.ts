import { Injectable } from "@nestjs/common";

export type AuditEventInput = {
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  requestId: string | null;
  metadata: Record<string, unknown>;
};

export type AuditEvent = AuditEventInput;

const SENSITIVE_KEYS = new Set(["token", "secret", "password", "cookie", "authorization"]);

function redactMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      key,
      SENSITIVE_KEYS.has(key.toLowerCase()) ? "[redacted]" : value,
    ]),
  );
}

@Injectable()
export class AuditService {
  private readonly events: AuditEvent[] = [];

  record(input: AuditEventInput): void {
    this.events.push({
      ...input,
      metadata: redactMetadata(input.metadata),
    });
  }

  list(): AuditEvent[] {
    return this.events.map((event) => ({
      ...event,
      metadata: { ...event.metadata },
    }));
  }
}
