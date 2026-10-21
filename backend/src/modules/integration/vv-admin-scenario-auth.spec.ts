import { createHash, createHmac } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { AppConfig } from "../../config/app-config";
import { VvAdminScenarioAuthVerifier } from "./vv-admin-scenario-auth";

function createConfig(secretFile?: string): AppConfig {
  return {
    nodeEnv: "test",
    port: 3000,
    admin: {},
    steam: {},
    arcoPay: { paymentOrigin: "https://payment.paidlayer.com", environment: "sandbox", providerMode: "disabled", apiUrl: "https://api.clickit.team/api/v1" },
    sih: {
      marketBaseUrl: "https://api.sih.market",
      maximumBodyBytes: 4096,
      requestTimeoutMs: 2500,
      steamRefillBaseUrl: "https://core.steaminventoryhelper.com",
    },
    catalog: { publicGames: ["cs2"] },
    notifications: {
      smtpHost: "smtp.purelymail.com",
      smtpPort: 465,
      smtpSecure: true,
    },
    integration: {
      publicOrigin: "https://shards.example",
      adminOrigin: "https://shards.example",
      ...(secretFile ? { protocolAuthSecretFile: secretFile } : {}),
    },
    corsOrigins: [],
  };
}

function sign(input: {
  secret: string;
  timestamp: string;
  body: string;
  path: string;
}) {
  const bodyHash = createHash("sha256").update(input.body).digest("hex");
  return createHmac("sha256", input.secret)
    .update(["POST", input.path, input.timestamp, bodyHash].join("\n"))
    .digest("hex");
}

describe("VvAdminScenarioAuthVerifier", () => {
  it("accepts a valid VV Admin scenario signature", () => {
    const directory = mkdtempSync(join(tmpdir(), "vv-scenario-auth-"));
    const secretFile = join(directory, "secret");
    writeFileSync(secretFile, "shared-secret\n", "utf8");
    const verifier = new VvAdminScenarioAuthVerifier(createConfig(secretFile));
    const body = JSON.stringify({ runId: "run-1" });
    const timestamp = "2026-08-13T12:00:00.000Z";

    expect(
      verifier.verify({
        body,
        path: "/admin/integration/scenarios/checkout-payment-reached/run",
        signature: sign({
          secret: "shared-secret",
          timestamp,
          body,
          path: "/admin/integration/scenarios/checkout-payment-reached/run",
        }),
        timestamp,
      }),
    ).toBe(true);
  });

  it("rejects invalid or unconfigured signatures", () => {
    expect(
      new VvAdminScenarioAuthVerifier(createConfig()).verify({
        body: "{}",
        path: "/admin/integration/scenarios/checkout-payment-reached/run",
        signature: "bad",
        timestamp: "2026-08-13T12:00:00.000Z",
      }),
    ).toBe(false);
  });
});
