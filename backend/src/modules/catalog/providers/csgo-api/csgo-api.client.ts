import { CatalogMetadataProviderUnavailableError, type CatalogMetadataFetchCommand, type CatalogMetadataProvider, type CatalogMetadataProviderResult } from "../metadata/catalog-metadata-provider";
import { hashCsgoApiPayload, parseCsgoApiDocument } from "./csgo-api.contract";

const metadataCommit = "5e01f938a115de71a5be644c5b198d93abc6a3cf";
const metadataUrlPrefix = `https://raw.githubusercontent.com/TorentoFlag/CSGO-API/${metadataCommit}/public/api`;

export type CsgoApiClientOptions = {
  maximumBodyBytes: number;
  requestTimeoutMs: number;
};

function sourceUrl(locale: string): string {
  return `${metadataUrlPrefix}/${locale}/all.json`;
}

function unavailable(): CatalogMetadataProviderUnavailableError {
  return new CatalogMetadataProviderUnavailableError();
}

async function boundedText(response: Response, maximumBodyBytes: number): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && (!/^(?:0|[1-9][0-9]*)$/.test(declaredLength) || BigInt(declaredLength) > maximumBodyBytes)) {
    await response.body?.cancel().catch(() => undefined);
    throw unavailable();
  }
  const body = await response.arrayBuffer();
  if (body.byteLength > maximumBodyBytes) throw unavailable();
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

export class CsgoApiClient implements CatalogMetadataProvider {
  readonly game = "cs2" as const;
  readonly locale = "ru" as const;
  readonly provider = "csgo_api" as const;

  constructor(private readonly options: CsgoApiClientOptions) {
    if (
      !Number.isSafeInteger(options.maximumBodyBytes) ||
      options.maximumBodyBytes < 1_024 ||
      options.maximumBodyBytes > 268_435_456 ||
      !Number.isSafeInteger(options.requestTimeoutMs) ||
      options.requestTimeoutMs < 500 ||
      options.requestTimeoutMs > 120_000
    ) {
      throw new Error("CSGO_API_CLIENT_OPTIONS_INVALID");
    }
  }

  async fetch(command: CatalogMetadataFetchCommand): Promise<CatalogMetadataProviderResult> {
    if (command.game !== this.game || command.locale !== this.locale || !Array.isArray(command.marketHashNames)) {
      throw new Error("CATALOG_METADATA_PROVIDER_REQUEST_INVALID");
    }
    const url = sourceUrl(command.locale);
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
    if (!response.ok || response.status !== 200) throw unavailable();
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("text/plain") && !contentType.startsWith("application/json")) {
      await response.body?.cancel().catch(() => undefined);
      throw unavailable();
    }
    const payload = await boundedText(response, this.options.maximumBodyBytes);
    const items = parseCsgoApiDocument(payload, command.locale);
    const targetSet = new Set(command.marketHashNames);
    const sourceEtag = response.headers.get("etag");
    return {
      provider: this.provider,
      game: this.game,
      locale: this.locale,
      sourceUrl: url,
      sourceHash: hashCsgoApiPayload(payload),
      observedAt: new Date(),
      sourceItemCount: items.length,
      filteredOutCount: 0,
      collapsedDuplicateCount: 0,
      metadata: {
        sourceCommit: metadataCommit,
        ...(sourceEtag === null ? {} : { sourceEtag }),
      },
      items: command.marketHashNames.length === 0
        ? items
        : items.filter((item) => targetSet.has(item.marketHashName)),
    };
  }
}
