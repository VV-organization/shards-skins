import { describe, expect, it } from "vitest";

import { parseNotificationsWorkerOptions, runNotificationsWorker } from "./notifications-worker";

describe("notifications worker", () => {
  it("parses watch mode with a bounded poll interval", () => {
    expect(parseNotificationsWorkerOptions(["--watch", "--limit=5"], {
      NOTIFICATIONS_WORKER_INTERVAL_MS: "2500",
    })).toEqual({ help: false, intervalMs: 2500, limit: 5, once: false });
  });

  it("keeps the command finite unless watch mode is requested", () => {
    expect(parseNotificationsWorkerOptions(["--limit=1"], {})).toMatchObject({ once: true });
  });

  it("processes pending notifications until the dispatcher has no work", async () => {
    const processNext = () => Promise.resolve({ status: "none" as const });
    await expect(runNotificationsWorker({ processNext }, 5)).resolves.toBe(0);
  });
});
