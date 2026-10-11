import type { CatalogMetadataItemInput } from "../../catalog-metadata.types";
import { CatalogMetadataProviderUnavailableError, type CatalogMetadataFetchCommand, type CatalogMetadataProvider, type CatalogMetadataProviderResult } from "../metadata/catalog-metadata-provider";
import { createTf2AutobotSnapshot, parseTf2AutobotItem, TF2_AUTOBOT_SOURCE_URL } from "./tf2-autobot.contract";

const contentTypePattern = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;
const maximumMetadataTargets = 100_000;

export type Tf2AutobotClientOptions = {
  concurrency: number;
  maximumBodyBytes: number;
  requestTimeoutMs: number;
  runTimeoutMs: number;
};

function unavailable(): CatalogMetadataProviderUnavailableError {
  return new CatalogMetadataProviderUnavailableError();
}

function validateTargets(targets: readonly string[]): readonly string[] {
  if (
    !Array.isArray(targets) ||
    targets.length === 0 ||
    targets.length > maximumMetadataTargets ||
    targets.some((target) => typeof target !== "string" || target.length === 0 || target.length > 512 || target.trim() !== target)
  ) {
    throw new Error("CATALOG_METADATA_PROVIDER_REQUEST_INVALID");
  }
  return Array.from(new Set<string>(targets)).sort((left, right) => left.localeCompare(right));
}

async function boundedJson(response: Response, maximumBodyBytes: number): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && (!/^(?:0|[1-9][0-9]*)$/.test(declaredLength) || BigInt(declaredLength) > maximumBodyBytes)) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("CATALOG_METADATA_TF2_AUTOBOT_BODY_INVALID");
  }
  const body = await response.arrayBuffer();
  if (body.byteLength > maximumBodyBytes) throw new Error("CATALOG_METADATA_TF2_AUTOBOT_BODY_INVALID");
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
  } catch {
    throw new Error("CATALOG_METADATA_TF2_AUTOBOT_BODY_INVALID");
  }
}

export class Tf2AutobotClient implements CatalogMetadataProvider {
  readonly game = "tf2" as const;
  readonly locale = "en" as const;
  readonly provider = "tf2_autobot" as const;

  constructor(private readonly options: Tf2AutobotClientOptions) {
    if (
      !Number.isSafeInteger(options.concurrency) ||
      options.concurrency < 1 ||
      options.concurrency > 8 ||
      !Number.isSafeInteger(options.maximumBodyBytes) ||
      options.maximumBodyBytes < 1_024 ||
      options.maximumBodyBytes > 1_048_576 ||
      !Number.isSafeInteger(options.requestTimeoutMs) ||
      options.requestTimeoutMs < 500 ||
      options.requestTimeoutMs > 30_000 ||
      !Number.isSafeInteger(options.runTimeoutMs) ||
      options.runTimeoutMs < 500 ||
      options.runTimeoutMs > 595_000
    ) {
      throw new Error("TF2_AUTOBOT_CLIENT_OPTIONS_INVALID");
    }
  }

  async fetch(command: CatalogMetadataFetchCommand): Promise<CatalogMetadataProviderResult> {
    if (command.game !== this.game || command.locale !== this.locale) {
      throw new Error("CATALOG_METADATA_PROVIDER_REQUEST_INVALID");
    }
    const targets = validateTargets(command.marketHashNames);
    const results: CatalogMetadataItemInput[] = [];
    for (const target of targets) {
      const item = await this.fetchOne(target);
      if (item !== null) results.push(item);
    }
    return createTf2AutobotSnapshot(targets, results, new Date());
  }

  private async fetchOne(targetMarketHashName: string): Promise<CatalogMetadataItemInput | null> {
    const url = new URL(`${TF2_AUTOBOT_SOURCE_URL}/${encodeURIComponent(targetMarketHashName)}`);
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(this.options.requestTimeoutMs),
      });
    } catch {
      throw unavailable();
    }
    if (response.status === 404) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    if (!response.ok || response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      throw unavailable();
    }
    const contentType = response.headers.get("content-type")?.trim() ?? "";
    if (!contentTypePattern.test(contentType)) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("CATALOG_METADATA_TF2_AUTOBOT_CONTENT_TYPE_INVALID");
    }
    return parseTf2AutobotItem(await boundedJson(response, this.options.maximumBodyBytes), targetMarketHashName);
  }
}
