-- Retain historical references, but never list the four bootstrap demo cards
-- whose /products artwork is not shipped by this storefront. A provider-enriched
-- row (category assigned) is left intact.
UPDATE catalog_products
SET public_enabled=false,updated_at=clock_timestamp()
WHERE id IN ('ak-redline','awp-asiimov','m4-printstream','deagle-printstream')
  AND category_id IS NULL
  AND image LIKE '/products/%';
