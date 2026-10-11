import { describe, expect, it } from "vitest";

import { AuditService } from "./audit.service";

describe("AuditService", () => {
  it("records append-only events without leaking sensitive metadata", () => {
    const audit = new AuditService();

    audit.record({
      actorUserId: "user_1",
      action: "steam_trade_url.updated",
      targetType: "user",
      targetId: "user_1",
      requestId: "req_1",
      metadata: {
        token: "secret",
        partner: "39734273",
      },
    });

    expect(audit.list()).toEqual([{
      actorUserId: "user_1",
      action: "steam_trade_url.updated",
      targetType: "user",
      targetId: "user_1",
      requestId: "req_1",
      metadata: {
        token: "[redacted]",
        partner: "39734273",
      },
    }]);
  });
});
