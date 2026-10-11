import { describe, expect, it } from "vitest";

import {
  parseVvAdminDispatcherWorkerOptions,
  runVvAdminDispatcherWorker,
} from "./vv-admin-dispatcher-worker";

describe("VV Admin dispatcher worker", () => {
  it("parses bounded watch options", () => {
    expect(
      parseVvAdminDispatcherWorkerOptions(["--watch", "--limit=5"], {
        VV_ADMIN_DISPATCHER_INTERVAL_MS: "2500",
      }),
    ).toEqual({ help: false, intervalMs: 2500, limit: 5, once: false });
  });

  it("processes until the dispatcher is idle", async () => {
    const results: Array<"accepted" | "retry" | "idle"> = [
      "accepted",
      "retry",
      "idle",
    ];

    await expect(
      runVvAdminDispatcherWorker(
        {
          processNext: () => Promise.resolve(results.shift() ?? "idle"),
        },
        10,
      ),
    ).resolves.toBe(2);
  });
});
