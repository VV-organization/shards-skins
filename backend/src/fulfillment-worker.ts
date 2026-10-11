import { APP_CONFIG } from "./config/app-config.module";
import type { AppConfig } from "./config/app-config";
import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { FulfillmentService, type ProcessFulfillmentResult, type ReconcileFulfillmentResult } from "./modules/fulfillment/fulfillment.service";

export type FulfillmentWorkerOptions = {
  intervalMs: number;
  once: boolean;
  skinTestMode: boolean;
};

export type FulfillmentWorkerCycleResult =
  | {
    didWork: false;
    operation: "none";
  }
  | {
    commandId: string;
    didWork: true;
    operation: "process";
    status: Exclude<ProcessFulfillmentResult, { status: "none" }>["status"];
  }
  | {
    commandId: string;
    commandStatus: Exclude<ReconcileFulfillmentResult, { status: "none" }>["commandStatus"];
    didWork: true;
    operation: "reconcile";
    providerStatus: Exclude<ReconcileFulfillmentResult, { status: "none" }>["providerStatus"];
  };

type FulfillmentWorkerService = Pick<FulfillmentService, "processNextPendingCommand" | "reconcileNextSubmittedSkinCommand">;

function parseIntervalMs(value: string | undefined): number {
  const normalized = value?.trim() || "10000";
  if (!/^\d+$/.test(normalized)) throw new Error("FULFILLMENT_WORKER_INTERVAL_MS_INVALID");
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 1_000 || parsed > 600_000) {
    throw new Error("FULFILLMENT_WORKER_INTERVAL_MS_INVALID");
  }
  return parsed;
}

function parseBooleanFlag(name: string, value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase() || "no";
  if (normalized === "1" || normalized === "true" || normalized === "yes") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no") return false;
  throw new Error(`${name}_INVALID`);
}

export function parseFulfillmentWorkerOptions(argv: string[], env: NodeJS.ProcessEnv = process.env): FulfillmentWorkerOptions {
  const once = argv.includes("--once");
  const skinTestMode = argv.includes("--skin-test-mode") || parseBooleanFlag("FULFILLMENT_WORKER_SKIN_TEST_MODE", env.FULFILLMENT_WORKER_SKIN_TEST_MODE);
  if (env.NODE_ENV === "production" && skinTestMode) throw new Error("FULFILLMENT_WORKER_SKIN_TEST_MODE_PRODUCTION_FORBIDDEN");
  return {
    intervalMs: parseIntervalMs(env.FULFILLMENT_WORKER_INTERVAL_MS),
    once,
    skinTestMode,
  };
}

export async function runFulfillmentWorkerCycle(
  fulfillment: FulfillmentWorkerService,
  options: Pick<FulfillmentWorkerOptions, "skinTestMode">,
): Promise<FulfillmentWorkerCycleResult> {
  const processed = await fulfillment.processNextPendingCommand({ skinTestMode: options.skinTestMode });
  if (processed.status !== "none") {
    return {
      commandId: processed.commandId,
      didWork: true,
      operation: "process",
      status: processed.status,
    };
  }

  const reconciled = await fulfillment.reconcileNextSubmittedSkinCommand();
  if (reconciled.status !== "none") {
    return {
      commandId: reconciled.commandId,
      commandStatus: reconciled.commandStatus,
      didWork: true,
      operation: "reconcile",
      providerStatus: reconciled.providerStatus,
    };
  }

  return {
    didWork: false,
    operation: "none",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function logWorkerEvent(event: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
}

async function main(): Promise<void> {
  const options = parseFulfillmentWorkerOptions(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  const state = { stopped: false };
  const stop = (): void => {
    state.stopped = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    const fulfillment = app.get(FulfillmentService);
    for (;;) {
      try {
        const config = app.get<AppConfig>(APP_CONFIG);
        const result = config.commerce?.fulfillmentEnabled
          ? await runFulfillmentWorkerCycle(fulfillment, options)
          : await fulfillment.reconcileNextSubmittedSkinCommand();
        logWorkerEvent({ result, status: "cycle" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "FULFILLMENT_WORKER_CYCLE_FAILED";
        process.stderr.write(`${JSON.stringify({ at: new Date().toISOString(), error: message, status: "cycle_failed" })}\n`);
      }
      if (options.once || state.stopped) break;
      await sleep(options.intervalMs);
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await app.close();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "FULFILLMENT_WORKER_FAILED";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
