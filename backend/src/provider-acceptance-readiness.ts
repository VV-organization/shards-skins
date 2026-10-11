import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";

export type FileProbeResult = "readable-nonempty" | "missing" | "empty" | "unreadable";
export type FileProbe = (path: string) => Promise<FileProbeResult>;
export type ProviderGateStatus = "ready" | "blocked";

export type ProviderAcceptanceGate = {
  id:
    | "steam-openid-browser"
    | "arc-pay-hosted-checkout"
    | "arc-pay-webhook"
    | "sih-catalog"
    | "sih-skin-test-order"
    | "sih-steam-refill";
  status: ProviderGateStatus;
  reasons: string[];
};

export type ProviderAcceptanceReadiness = {
  ready: boolean;
  gates: ProviderAcceptanceGate[];
};

type EnvMap = Record<string, string | undefined>;

function optionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function validateHttpsPublicBaseUrl(name: string, value: string | undefined): string | undefined {
  const normalized = optionalString(value);
  if (normalized === undefined) return `${name} missing`;

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return `${name} must be HTTPS origin/base URL`;
  }

  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    return `${name} must be HTTPS origin/base URL`;
  }

  return undefined;
}

function validatePositiveInteger(name: string, value: string | undefined): string | undefined {
  const normalized = optionalString(value);
  if (normalized === undefined) return `${name} missing`;
  if (!/^\d+$/.test(normalized) || Number(normalized) <= 0 || !Number.isSafeInteger(Number(normalized))) {
    return `${name} must be positive integer`;
  }
  return undefined;
}

function formatFileProbeReason(name: string, result: FileProbeResult): string | undefined {
  if (result === "readable-nonempty") return undefined;
  return `${name} ${result}`;
}

async function validateSecretFile(name: string, env: EnvMap, probe: FileProbe): Promise<string | undefined> {
  const path = optionalString(env[name]);
  if (path === undefined) return `${name} missing`;
  return formatFileProbeReason(name, await probe(path));
}

function gate(id: ProviderAcceptanceGate["id"], reasons: Array<string | undefined>): ProviderAcceptanceGate {
  const blockingReasons = reasons.filter((reason): reason is string => reason !== undefined);
  return {
    id,
    status: blockingReasons.length === 0 ? "ready" : "blocked",
    reasons: blockingReasons,
  };
}

export async function probeReadableNonemptyFile(path: string): Promise<FileProbeResult> {
  try {
    await access(path, constants.R_OK);
  } catch {
    return "missing";
  }

  try {
    const content = await readFile(path, "utf8");
    return content.trim().length > 0 ? "readable-nonempty" : "empty";
  } catch {
    return "unreadable";
  }
}

export async function evaluateProviderAcceptanceReadiness(
  env: EnvMap,
  probe: FileProbe = probeReadableNonemptyFile,
): Promise<ProviderAcceptanceReadiness> {
  const sihApiKeyReason = await validateSecretFile("SIH_API_KEY_FILE", env, probe);
  const sihSteamRefillApiKeyReason = await validateSecretFile("SIH_STEAM_REFILL_API_KEY_FILE", env, probe);

  const gates: ProviderAcceptanceGate[] = [
    gate("steam-openid-browser", [
      validateHttpsPublicBaseUrl("PUBLIC_BASE_URL", env.PUBLIC_BASE_URL),
      validateHttpsPublicBaseUrl("PUBLIC_FRONTEND_ORIGIN", env.PUBLIC_FRONTEND_ORIGIN),
    ]),
    gate("arc-pay-hosted-checkout", [
      optionalString(env.ARC_PAY_PROVIDER_MODE) === "real" ? undefined : "ARC_PAY_PROVIDER_MODE must be real",
      await validateSecretFile("ARC_PAY_SECRET_KEY_FILE", env, probe),
      validateHttpsPublicBaseUrl("ARC_PAY_PUBLIC_ORIGIN", env.ARC_PAY_PUBLIC_ORIGIN),
    ]),
    gate("arc-pay-webhook", [
      await validateSecretFile("ARC_PAY_WEBHOOK_SIGNING_SECRET_FILE", env, probe),
      validateHttpsPublicBaseUrl("PUBLIC_BASE_URL", env.PUBLIC_BASE_URL),
    ]),
    gate("sih-catalog", [sihApiKeyReason]),
    gate("sih-skin-test-order", [
      sihApiKeyReason,
      optionalString(env.SIH_ACCEPTANCE_STEAM_ID64) === undefined ? "SIH_ACCEPTANCE_STEAM_ID64 missing" : undefined,
      await validateSecretFile("SIH_ACCEPTANCE_TRADE_TOKEN_FILE", env, probe),
    ]),
    gate("sih-steam-refill", [
      sihSteamRefillApiKeyReason,
      optionalString(env.SIH_STEAM_REFILL_ACCEPTANCE_LOGIN) === undefined ? "SIH_STEAM_REFILL_ACCEPTANCE_LOGIN missing" : undefined,
      validatePositiveInteger("SIH_STEAM_REFILL_ACCEPTANCE_AMOUNT_RUB", env.SIH_STEAM_REFILL_ACCEPTANCE_AMOUNT_RUB),
      optionalString(env.SIH_STEAM_REFILL_MUTATION_APPROVED) === "yes"
        ? undefined
        : "SIH_STEAM_REFILL_MUTATION_APPROVED must be yes",
    ]),
  ];

  return {
    ready: gates.every((candidate) => candidate.status === "ready"),
    gates,
  };
}

async function main(): Promise<void> {
  const result = await evaluateProviderAcceptanceReadiness(process.env);
  process.stdout.write(`PROVIDER_ACCEPTANCE_READINESS ${result.ready ? "ready" : "blocked"}\n`);
  for (const candidate of result.gates) {
    const suffix = candidate.reasons.length > 0 ? `: ${candidate.reasons.join("; ")}` : "";
    process.stdout.write(`${candidate.status.toUpperCase()} ${candidate.id}${suffix}\n`);
  }
  if (!result.ready) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "PROVIDER_ACCEPTANCE_READINESS_FAILED";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
