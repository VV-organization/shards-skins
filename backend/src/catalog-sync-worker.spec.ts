import { describe, expect, it } from "vitest";

import {
  parseCatalogSyncWorkerOptions,
  runCatalogSyncWorkerCycle,
} from "./catalog-sync-worker";

describe("catalog sync worker", () => {
  it("parses bounded watch options", () => {
    expect(parseCatalogSyncWorkerOptions(["--watch"], {
      CATALOG_SYNC_WORKER_INTERVAL_MS: "60000",
    })).toEqual({ help: false, intervalMs: 60_000, once: false });
  });

  it("runs supplier and metadata sync for every configured public game", async () => {
    const calls: string[] = [];
    const providers = new Map([
      ["cs2", { provider: "csgo_api" }],
      ["rust", { provider: "scmm" }],
      ["tf2", { provider: "tf2_autobot" }],
    ]);

    const result = await runCatalogSyncWorkerCycle({
      games: ["cs2", "rust", "tf2"],
      metadataProviders: {
        require(game) {
          return providers.get(game) as never;
        },
      },
      sihClient: {
        getItems() {
          return Promise.resolve([]);
        },
      },
      supplierSync: {
        syncSihGame({ game }) {
          calls.push(`sih:${game}`);
          return Promise.resolve({
            game,
            promotedProductCount: game === "rust" ? 2 : 1,
            rowCount: game === "rust" ? 20 : 10,
            runId: `${game}-run`,
            source: "sih",
            status: "promoted",
          });
        },
      },
      metadataSync: {
        syncGame({ game }) {
          calls.push(`metadata:${game}`);
          return Promise.resolve({
            activeSihListingCount: game === "rust" ? 20 : 10,
            collapsedDuplicateCount: 0,
            filteredOutCount: 0,
            game,
            metadataItemCount: game === "rust" ? 18 : 8,
            promotedProductCount: game === "rust" ? 18 : 8,
            provider: game === "rust" ? "scmm" : game === "tf2" ? "tf2_autobot" : "csgo_api",
            snapshotId: `${game}-snapshot`,
            sourceHash: `${game}-hash`,
            sourceItemCount: game === "rust" ? 21 : 11,
            sourceUrl: `https://example.test/${game}`,
            status: "ok",
          });
        },
      },
    });

    expect(calls).toEqual([
      "sih:cs2",
      "metadata:cs2",
      "sih:rust",
      "metadata:rust",
      "sih:tf2",
      "metadata:tf2",
    ]);
    expect(result).toEqual({
      games: [
        {
          activeSihListingCount: 10,
          game: "cs2",
          metadataItemCount: 8,
          promotedProductCount: 8,
          provider: "csgo_api",
          sihPromotedProductCount: 1,
          sihRowCount: 10,
          sihRunId: "cs2-run",
          snapshotId: "cs2-snapshot",
        },
        {
          activeSihListingCount: 20,
          game: "rust",
          metadataItemCount: 18,
          promotedProductCount: 18,
          provider: "scmm",
          sihPromotedProductCount: 2,
          sihRowCount: 20,
          sihRunId: "rust-run",
          snapshotId: "rust-snapshot",
        },
        {
          activeSihListingCount: 10,
          game: "tf2",
          metadataItemCount: 8,
          promotedProductCount: 8,
          provider: "tf2_autobot",
          sihPromotedProductCount: 1,
          sihRowCount: 10,
          sihRunId: "tf2-run",
          snapshotId: "tf2-snapshot",
        },
      ],
      failures: [],
      status: "completed",
    });
  });

  it("continues syncing later games when one game fails", async () => {
    const calls: string[] = [];

    const result = await runCatalogSyncWorkerCycle({
      games: ["cs2", "rust", "tf2"],
      metadataProviders: {
        require(game) {
          return { provider: game } as never;
        },
      },
      sihClient: {
        getItems() {
          return Promise.resolve([]);
        },
      },
      supplierSync: {
        syncSihGame({ game }) {
          calls.push(`sih:${game}`);
          if (game === "rust") return Promise.reject(new Error("SCMM_UNAVAILABLE"));
          return Promise.resolve({
            game,
            promotedProductCount: 1,
            rowCount: 10,
            runId: `${game}-run`,
            source: "sih",
            status: "promoted",
          });
        },
      },
      metadataSync: {
        syncGame({ game }) {
          calls.push(`metadata:${game}`);
          return Promise.resolve({
            activeSihListingCount: 10,
            collapsedDuplicateCount: 0,
            filteredOutCount: 0,
            game,
            metadataItemCount: 8,
            promotedProductCount: 8,
            provider: game,
            snapshotId: `${game}-snapshot`,
            sourceHash: `${game}-hash`,
            sourceItemCount: 11,
            sourceUrl: `https://example.test/${game}`,
            status: "ok",
          });
        },
      },
    });

    expect(calls).toEqual([
      "sih:cs2",
      "metadata:cs2",
      "sih:rust",
      "sih:tf2",
      "metadata:tf2",
    ]);
    expect(result.status).toBe("partial");
    expect(result.games.map((game) => game.game)).toEqual(["cs2", "tf2"]);
    expect(result.failures).toEqual([{ error: "SCMM_UNAVAILABLE", game: "rust" }]);
  });
});
