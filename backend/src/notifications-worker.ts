import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { NotificationDispatcher } from "./modules/notifications/notification-dispatcher";

export type NotificationsWorkerOptions = {
  help: boolean;
  intervalMs: number;
  limit: number;
  once: boolean;
};

function parseIntervalMs(value: string | undefined): number {
  const normalized = value?.trim() || "10000";
  if (!/^\d+$/.test(normalized)) throw new Error("NOTIFICATIONS_WORKER_INTERVAL_MS_INVALID");
  const intervalMs = Number(normalized);
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000 || intervalMs > 600_000) {
    throw new Error("NOTIFICATIONS_WORKER_INTERVAL_MS_INVALID");
  }
  return intervalMs;
}

export function parseNotificationsWorkerOptions(argv: string[], env: NodeJS.ProcessEnv = process.env): NotificationsWorkerOptions {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true, intervalMs: 0, limit: 0, once: true };
  if (argv.includes("--watch") && argv.includes("--once")) throw new Error("NOTIFICATIONS_WORKER_MODE_INVALID");
  const limitArgument = argv.find((argument) => argument.startsWith("--limit="));
  const value = limitArgument?.slice("--limit=".length) ?? "20";
  if (!/^\d+$/.test(value)) throw new Error("NOTIFICATIONS_WORKER_LIMIT_INVALID");
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("NOTIFICATIONS_WORKER_LIMIT_INVALID");
  return {
    help: false,
    intervalMs: parseIntervalMs(env.NOTIFICATIONS_WORKER_INTERVAL_MS),
    limit,
    once: !argv.includes("--watch"),
  };
}

export async function runNotificationsWorker(dispatcher: Pick<NotificationDispatcher, "processNext">, limit: number): Promise<number> {
  let processed = 0;
  while (processed < limit) {
    const result = await dispatcher.processNext();
    if (result.status === "none") break;
    processed += 1;
  }
  return processed;
}

async function main(): Promise<void> {
  const options = parseNotificationsWorkerOptions(process.argv.slice(2));
  if (options.help) {
    process.stdout.write("Usage: notifications-worker [--watch] [--limit=20]\nProcesses at most 1-100 pending notifications per cycle; --help sends nothing.\n");
    return;
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  const state = { stopped: false };
  const stop = (): void => {
    state.stopped = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    for (;;) {
      try {
        const processed = await runNotificationsWorker(app.get(NotificationDispatcher), options.limit);
        process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), processed, status: "completed" })}\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "NOTIFICATIONS_WORKER_CYCLE_FAILED";
        process.stderr.write(`${JSON.stringify({ at: new Date().toISOString(), error: message, status: "cycle_failed" })}\n`);
      }
      if (options.once || state.stopped) break;
      await new Promise<void>((resolve) => setTimeout(resolve, options.intervalMs));
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await app.close();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "NOTIFICATIONS_WORKER_FAILED"}\n`);
    process.exitCode = 1;
  });
}
