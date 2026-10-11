import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import {FulfillmentOperationService,type OperationResult} from "./modules/fulfillment/fulfillment-operation.service";

export type FulfillmentWorkerOptions = {
  intervalMs: number;
  once: boolean;
  skinTestMode: boolean;
};

export type FulfillmentWorkerCycleResult={didWork:boolean;recovered:number;submitted:OperationResult|'error';reconciled:OperationResult|'error';settled:number|'error'};
type FulfillmentWorkerService=Pick<FulfillmentOperationService,'submitNext'|'reconcileNext'|'recoverExpired'|'settleTerminalHolds'>;

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
  const recovered=await fulfillment.recoverExpired(20);
  const results=await Promise.allSettled([fulfillment.submitNext(options.skinTestMode),fulfillment.reconcileNext(),fulfillment.settleTerminalHolds(20)]);
  const submitted=results[0].status==='fulfilled'?results[0].value:'error';
  const reconciled=results[1].status==='fulfilled'?results[1].value:'error';
  const settled=results[2].status==='fulfilled'?results[2].value:'error';
  return {didWork:recovered>0||submitted==='error'||reconciled==='error'||settled==='error'||submitted.status!=='none'||reconciled.status!=='none'||settled>0,recovered,submitted,reconciled,settled};
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
    const fulfillment = app.get(FulfillmentOperationService);
    for (;;) {
      try {
        const result = await runFulfillmentWorkerCycle(fulfillment, options);
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
