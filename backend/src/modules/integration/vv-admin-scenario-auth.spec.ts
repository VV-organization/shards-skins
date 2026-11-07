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
    const timestamp = new Date().toISOString();

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
  it("binds the signature to the public /api prefix and rejects stale timestamps",()=>{
    const secretFile=join(mkdtempSync(join(tmpdir(),"vv-auth-")),"secret");writeFileSync(secretFile,"shared-secret");
    const config=createConfig(secretFile);config.integration.adminOrigin="https://shards.example/api";
    const verifier=new VvAdminScenarioAuthVerifier(config);
    const body="{}",path="/admin/integration/scenarios/checkout-payment-reached/run",timestamp=new Date().toISOString();
    const signature=sign({secret:"shared-secret",body,path:"/api"+path,timestamp});
    expect(verifier.verify({body,path,timestamp,signature})).toBe(true);
    expect(verifier.verify({body:path,path,timestamp,signature})).toBe(false);
    expect(verifier.verify({body,path,timestamp,signature:sign({secret:"shared-secret",body,path,timestamp})})).toBe(false);
    for(const t of [new Date(Date.now()-301000).toISOString(),new Date(Date.now()+301000).toISOString(),"invalid", "2026-02-30T00:00:00.000Z"]){expect(verifier.verify({body,path,timestamp:t,signature:sign({secret:"shared-secret",body,path:"/api"+path,timestamp:t})})).toBe(false);}
  });

});
