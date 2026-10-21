import { describe, expect, test } from "vitest";

import { evaluateProviderAcceptanceReadiness, type FileProbe } from "./provider-acceptance-readiness";

const readableFileProbe: FileProbe = () => Promise.resolve("readable-nonempty");

describe("provider acceptance readiness", () => {
  test("blocks all real provider gates when required env is missing", async () => {
    const result = await evaluateProviderAcceptanceReadiness({}, readableFileProbe);

    expect(result.ready).toBe(false);
    expect(result.gates).toEqual([
      {
        id: "steam-openid-browser",
        status: "blocked",
        reasons: ["PUBLIC_BASE_URL missing", "PUBLIC_FRONTEND_ORIGIN missing"],
      },
      {
        id: "arco-pay-hosted-checkout",
        status: "blocked",
        reasons: ["ARCO_PAY_PROVIDER_MODE must be real", "ARCO_PAY_API_KEY_FILE missing", "ARCO_PAY_BEARER_TOKEN_FILE missing", "ARCO_PAY_SHOP_ID must be a positive integer", "ARCO_PAY_CALLBACK_URL missing", "ARCO_PAY_PUBLIC_ORIGIN missing"],
      },
      {
        id: "arco-pay-webhook",
        status: "blocked",
        reasons: ["ARCO_PAY_PUBLIC_KEY_FILE missing", "PUBLIC_BASE_URL missing"],
      },
      {
        id: "sih-catalog",
        status: "blocked",
        reasons: ["SIH_API_KEY_FILE missing"],
      },
      {
        id: "sih-skin-test-order",
        status: "blocked",
        reasons: ["SIH_API_KEY_FILE missing", "SIH_ACCEPTANCE_STEAM_ID64 missing", "SIH_ACCEPTANCE_TRADE_TOKEN_FILE missing"],
      },
      {
        id: "sih-steam-refill",
        status: "blocked",
        reasons: [
          "SIH_STEAM_REFILL_API_KEY_FILE missing",
          "SIH_STEAM_REFILL_ACCEPTANCE_LOGIN missing",
          "SIH_STEAM_REFILL_ACCEPTANCE_AMOUNT_RUB missing",
          "SIH_STEAM_REFILL_MUTATION_APPROVED must be yes",
        ],
      },
    ]);
  });

  test("marks every gate ready when public origins and secret files are valid", async () => {
    const result = await evaluateProviderAcceptanceReadiness(
      {
        PUBLIC_BASE_URL: "https://backend.example",
        PUBLIC_FRONTEND_ORIGIN: "https://shards.example",
        ARCO_PAY_PROVIDER_MODE: "real",
        ARCO_PAY_BEARER_TOKEN_FILE: "/run/secrets/token", ARCO_PAY_SHOP_ID:"1581", ARCO_PAY_CALLBACK_URL:"https://shards.example/api/payments/webhooks/arco-pay",
        ARCO_PAY_API_KEY_FILE: "/run/secrets/arcoPay",
        ARCO_PAY_PUBLIC_ORIGIN: "https://shards.example/pay",
        ARCO_PAY_PUBLIC_KEY_FILE: "/run/secrets/arco-pay-webhook",
        SIH_API_KEY_FILE: "/run/secrets/sih",
        SIH_STEAM_REFILL_API_KEY_FILE: "/run/secrets/sih-steam-refill",
        SIH_ACCEPTANCE_STEAM_ID64: "76561198000000000",
        SIH_ACCEPTANCE_TRADE_TOKEN_FILE: "/run/secrets/sih-trade-token",
        SIH_STEAM_REFILL_ACCEPTANCE_LOGIN: "shards_acceptance",
        SIH_STEAM_REFILL_ACCEPTANCE_AMOUNT_RUB: "10",
        SIH_STEAM_REFILL_MUTATION_APPROVED: "yes",
      },
      readableFileProbe,
    );

    expect(result.ready).toBe(true);
    expect(result.gates.map((gate) => gate.status)).toEqual(["ready", "ready", "ready", "ready", "ready", "ready"]);
  });

  test("rejects non-HTTPS public origins and unreadable secret files without exposing paths", async () => {
    const probe: FileProbe = (path) => Promise.resolve(path.includes("empty") ? "empty" : "missing");

    const result = await evaluateProviderAcceptanceReadiness(
      {
        PUBLIC_BASE_URL: "http://backend.example",
        PUBLIC_FRONTEND_ORIGIN: "https://shards.example",
        ARCO_PAY_PROVIDER_MODE: "fake",
        ARCO_PAY_API_KEY_FILE: "/run/secrets/missing-arcoPay",
        ARCO_PAY_PUBLIC_ORIGIN: "https://user:pass@shards.example",
        ARCO_PAY_PUBLIC_KEY_FILE: "/run/secrets/empty-webhook",
        SIH_API_KEY_FILE: "/run/secrets/missing-sih",
      },
      probe,
    );

    expect(result.ready).toBe(false);
    expect(result.gates).toContainEqual({
      id: "arco-pay-webhook",
      status: "blocked",
      reasons: ["ARCO_PAY_PUBLIC_KEY_FILE empty", "PUBLIC_BASE_URL must be HTTPS origin/base URL"],
    });
    expect(JSON.stringify(result)).not.toContain("/run/secrets");
  });
});
