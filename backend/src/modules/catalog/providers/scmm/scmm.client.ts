import { CatalogMetadataProviderUnavailableError, type CatalogMetadataFetchCommand, type CatalogMetadataProvider, type CatalogMetadataProviderResult } from "../metadata/catalog-metadata-provider";
import { createScmmSnapshot, parseScmmPage, SCMM_SOURCE_URL, type ScmmPage } from "./scmm.contract";

const contentTypePattern = /^(?:application\/json|text\/json|text\/plain)(?:\s*;\s*charset=utf-8)?$/i;
const maximumMetadataTargets = 100_000;

export type ScmmClientOptions = {
  maximumBodyBytesPerPage: number;
  pageConcurrency: number;
  pageSize: number;
  requestTimeoutMs: number;
};

function unavailable(): CatalogMetadataProviderUnavailableError {
  return new CatalogMetadataProviderUnavailableError();
}

function validateTargets(targets: readonly string[]): ReadonlySet<string> {
  if (
    !Array.isArray(targets) ||
    targets.length === 0 ||
    targets.length > maximumMetadataTargets ||
    targets.some((target) => typeof target !== "string" || target.length === 0 || target.length > 512 || target.trim() !== target)
  ) {
    throw new Error("CATALOG_METADATA_PROVIDER_REQUEST_INVALID");
  }
  return new Set(targets);
}

async function boundedJson(response: Response, maximumBodyBytes: number): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && (!/^(?:0|[1-9][0-9]*)$/.test(declaredLength) || BigInt(declaredLength) > maximumBodyBytes)) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("CATALOG_METADATA_SCMM_BODY_INVALID");
  }
  const body = await response.arrayBuffer();
  if (body.byteLength > maximumBodyBytes) throw new Error("CATALOG_METADATA_SCMM_BODY_INVALID");
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
  } catch {
    throw new Error("CATALOG_METADATA_SCMM_BODY_INVALID");
  }
}

export class ScmmClient implements CatalogMetadataProvider {
  readonly game = "rust" as const;
  readonly locale = "en" as const;
  readonly provider = "scmm" as const;

  constructor(private readonly options: ScmmClientOptions) {
    if (
      !Number.isSafeInteger(options.maximumBodyBytesPerPage) ||
      options.maximumBodyBytesPerPage < 1_024 ||
      options.maximumBodyBytesPerPage > 33_554_432 ||
      !Number.isSafeInteger(options.pageConcurrency) ||
      options.pageConcurrency < 1 ||
      options.pageConcurrency > 8 ||
      !Number.isSafeInteger(options.pageSize) ||
      options.pageSize < 1 ||
      options.pageSize > 1_000 ||
      !Number.isSafeInteger(options.requestTimeoutMs) ||
      options.requestTimeoutMs < 500 ||
      options.requestTimeoutMs > 120_000
    ) {
      throw new Error("SCMM_CLIENT_OPTIONS_INVALID");
    }
  }

  async fetch(command: CatalogMetadataFetchCommand): Promise<CatalogMetadataProviderResult> {
    if (command.game !== this.game || command.locale !== this.locale) {
      throw new Error("CATALOG_METADATA_PROVIDER_REQUEST_INVALID");
    }
    const targets = validateTargets(command.marketHashNames);
    const firstPage = await this.fetchPage(0);
    const pages: ScmmPage[] = [firstPage];
    for (let start = this.options.pageSize; start < firstPage.total; start += this.options.pageSize) {
      pages.push(await this.fetchPage(start, firstPage.total));
    }
    return createScmmSnapshot(pages, targets, new Date());
  }

  private async fetchPage(start: number, expectedTotal?: number): Promise<ScmmPage> {
    const url = new URL(SCMM_SOURCE_URL);
    url.searchParams.set("detailed", "true");
    url.searchParams.set("page", String(start / this.options.pageSize + 1));
    url.searchParams.set("pageSize", String(this.options.pageSize));
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { accept: "application/json", language: "English" },
        redirect: "error",
        signal: AbortSignal.timeout(this.options.requestTimeoutMs),
      });
    } catch {
      throw unavailable();
    }
    if (!response.ok || response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      throw unavailable();
    }
    const contentType = response.headers.get("content-type")?.trim() ?? "";
    if (!contentTypePattern.test(contentType)) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("CATALOG_METADATA_SCMM_CONTENT_TYPE_INVALID");
    }
    return parseScmmPage(
      await boundedJson(response, this.options.maximumBodyBytesPerPage),
      expectedTotal === undefined
        ? { pageSize: this.options.pageSize, requestedStart: start }
        : { expectedTotal, pageSize: this.options.pageSize, requestedStart: start },
    );
  }
}
