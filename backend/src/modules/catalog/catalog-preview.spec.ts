import { describe, expect, it } from "vitest";
import { CatalogService } from "./catalog.service";

describe("storefront catalog preview", () => {
  it("loads only cards without running whole-catalog facet or count queries", async () => {
    const statements: string[] = [];
    const service = new CatalogService({ query: (sql: string) => {
      statements.push(sql);
      if (sql.includes("SELECT DISTINCT") || sql.includes("AS total")) {
        throw new Error("The storefront shell must not scan catalog facets or counts");
      }
      return Promise.resolve({ rows: [] });
    } } as never);
    expect(await service.preview("60")).toEqual({ items: [] });
    expect(statements).toHaveLength(1);
    // Supplier enrichment must happen after the bounded, ordered card selection.
    expect(statements[0]).toMatch(/FROM \(SELECT \* FROM catalog_products WHERE[\s\S]*ORDER BY[\s\S]*LIMIT \$1\) AS catalog_products/);
  });

  it("bounds the public preview size", async () => {
    const limits: unknown[] = [];
    const service = new CatalogService({ query: (_sql: string, params: unknown[]) => {
      limits.push(params[0]);
      return Promise.resolve({ rows: [] });
    } } as never);
    for (const limit of ["60", "999999", "-1", "invalid"]) await service.preview(limit);
    expect(limits).toEqual([60, 240, 120, 120]);
  });
});
