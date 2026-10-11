import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { WalletService } from "./modules/wallet/wallet.service";

function parseLimit(argv: string[]): number | undefined {
  const limitArg = argv.find((arg) => arg.startsWith("--limit="));
  if (limitArg === undefined) return undefined;
  const parsed = Number(limitArg.slice("--limit=".length));
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 500) {
    throw new Error("WALLET_RECONCILIATION_LIMIT_INVALID");
  }
  return parsed;
}

async function main(): Promise<void> {
  const limit = parseLimit(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  try {
    const wallet = app.get(WalletService);
    const result = await wallet.reconcileWallet(limit === undefined ? {} : { limit });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status !== "ok") process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "WALLET_RECONCILE_FAILED";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
