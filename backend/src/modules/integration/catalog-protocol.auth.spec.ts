import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { authenticateCatalogProtocolRequest } from "./catalog-protocol.auth";

const timestamp = "2026-08-20T10:00:00.000Z";
const requestId = "00000000-0000-4000-8000-000000000001";
const secret = "integration-secret";

describe("authenticateCatalogProtocolRequest", () => {
  it("accepts the VV Admin HMAC canonical request", () => {
    const body = JSON.stringify({ isActive: false });
    const signature = sign({
      body,
      method: "PATCH",
      path: "/products/apple-usd-25",
    });

    expect(
      authenticateCatalogProtocolRequest(
        {
          body,
          method: "PATCH",
          path: "/products/apple-usd-25",
          headers: {
            "x-vv-actor-id": "operator-1",
            "x-vv-request-id": requestId,
            "x-vv-site-key": "shards",
            "x-vv-timestamp": timestamp,
            "x-vv-signature": signature,
            "idempotency-key": "11111111-1111-4111-8111-111111111111",
          },
        },
        secret,
        "shards",
        new Date("2026-08-20T10:01:00.000Z"),
      ),
    ).toEqual({
      actorId: "operator-1",
      requestId,
      siteKey: "shards",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("rejects mutation requests without idempotency", () => {
    const body = JSON.stringify({ isActive: false });

    expect(() =>
      authenticateCatalogProtocolRequest(
        {
          body,
          method: "PATCH",
          path: "/products/apple-usd-25",
          headers: {
            "x-vv-actor-id": "operator-1",
            "x-vv-request-id": requestId,
            "x-vv-site-key": "shards",
            "x-vv-timestamp": timestamp,
            "x-vv-signature": sign({
              body,
              method: "PATCH",
              path: "/products/apple-usd-25",
            }),
          },
        },
        secret,
        "shards",
        new Date("2026-08-20T10:01:00.000Z"),
      ),
    ).toThrow("CATALOG_PROTOCOL_AUTH_FAILED");
  });

  it("rejects signatures for a different relative path", () => {
    expect(() =>
      authenticateCatalogProtocolRequest(
        {
          body: "",
          method: "GET",
          path: "/products",
          headers: {
            "x-vv-actor-id": "operator-1",
            "x-vv-request-id": requestId,
            "x-vv-site-key": "shards",
            "x-vv-timestamp": timestamp,
            "x-vv-signature": sign({
              body: "",
              method: "GET",
              path: "/offers",
            }),
          },
        },
        secret,
        "shards",
        new Date("2026-08-20T10:01:00.000Z"),
      ),
    ).toThrow("CATALOG_PROTOCOL_AUTH_FAILED");
  });
});

function sign(input: {
  readonly body: string;
  readonly method: string;
  readonly path: string;
}): string {
  const digest = createHash("sha256").update(input.body).digest("hex");
  const canonical = [
    "vv-admin",
    timestamp,
    requestId,
    input.method,
    input.path,
    digest,
  ].join(".");
  return `sha256=${createHmac("sha256", secret).update(canonical).digest("hex")}`;
}
