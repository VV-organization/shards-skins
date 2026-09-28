import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const catalog = JSON.parse(readFileSync(new URL("../src/data/catalog.json", import.meta.url), "utf8")) as {
  mode: string;
  products: Array<{
    id: string;
    name: string;
    description: string;
    imageUrl: string;
    categoryId: string;
    condition: string;
    float: number | null;
    priceMinor: number;
    source: { name: string; currency: string; rublesPerUnit: number };
  }>;
  categories: Array<{ id: string }>;
};

test("catalog products contain the fields required by the storefront", () => {
  assert.equal(catalog.mode, "preview");
  assert.ok(catalog.products.length > 0);
  const categoryIds = new Set(catalog.categories.map((category) => category.id));

  for (const product of catalog.products) {
    assert.ok(product.id);
    assert.ok(product.name);
    assert.ok(product.description);
    assert.ok(product.imageUrl.startsWith("/"));
    assert.ok(categoryIds.has(product.categoryId));
    assert.ok(product.condition);
    assert.ok(Number.isFinite(product.priceMinor) && product.priceMinor > 0);
    assert.ok(product.float === null || (product.float >= 0 && product.float <= 1));
    assert.ok(product.source.name);
    assert.ok(product.source.currency);
    assert.ok(Number.isFinite(product.source.rublesPerUnit) && product.source.rublesPerUnit > 0);
  }
});
