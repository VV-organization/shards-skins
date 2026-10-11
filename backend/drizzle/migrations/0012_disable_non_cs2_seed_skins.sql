UPDATE "catalog_products"
SET "public_enabled" = false,
    "updated_at" = now()
WHERE "kind" = 'skins'
  AND "supplier_provider" = 'seed'
  AND coalesce("game", '') <> 'CS2';
