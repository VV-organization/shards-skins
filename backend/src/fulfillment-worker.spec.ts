import { describe, expect, it } from "vitest";

import { parseFulfillmentWorkerOptions, runFulfillmentWorkerCycle } from "./fulfillment-worker";

describe("fulfillment worker entrypoint", () => {
  it("claims a pending fulfillment command before reconciling submitted skin commands", async () => {
    const calls: string[] = [];
    const result = await runFulfillmentWorkerCycle({
      processNextPendingCommand: () => {
        calls.push("process");
        return Promise.resolve({ commandId: "command-1", providerOrderId: "provider-1", status: "completed" });
      },
      reconcileNextSubmittedSkinCommand: () => {
        calls.push("reconcile");
        return Promise.resolve({ status: "none" });
      },
    }, { skinTestMode: false });

    expect(result).toEqual({ commandId: "command-1", didWork: true, operation: "process", status: "completed" });
    expect(calls).toEqual(["process"]);
  });

  it("reconciles submitted skin commands when no pending command exists", async () => {
    const calls: string[] = [];
    const result = await runFulfillmentWorkerCycle({
      processNextPendingCommand: () => {
        calls.push("process");
        return Promise.resolve({ status: "none" });
      },
      reconcileNextSubmittedSkinCommand: () => {
        calls.push("reconcile");
        return Promise.resolve({ commandId: "command-2", commandStatus: "completed", providerStatus: "finished", status: "reconciled" });
      },
    }, { skinTestMode: false });

    expect(result).toEqual({ commandId: "command-2", commandStatus: "completed", didWork: true, operation: "reconcile", providerStatus: "finished" });
    expect(calls).toEqual(["process", "reconcile"]);
  });

  it("parses bounded production-safe loop options", () => {
    expect(parseFulfillmentWorkerOptions(["--once"], {
      FULFILLMENT_WORKER_INTERVAL_MS: "15000",
      FULFILLMENT_WORKER_SKIN_TEST_MODE: "no",
    })).toEqual({
      intervalMs: 15_000,
      once: true,
      skinTestMode: false,
    });
  });
});
