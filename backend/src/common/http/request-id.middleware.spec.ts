import { describe, expect, it } from "vitest";

import { resolveRequestId } from "./request-id.middleware";

describe("resolveRequestId", () => {
  it("preserves a valid incoming request id", () => {
    expect(resolveRequestId(" shards:req_123 ")).toBe("shards:req_123");
  });

  it("generates a request id when the incoming header is absent or unsafe", () => {
    expect(resolveRequestId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId("bad request id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
