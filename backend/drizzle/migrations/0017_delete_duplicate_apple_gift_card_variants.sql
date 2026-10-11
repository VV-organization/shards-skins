DROP INDEX IF EXISTS "catalog_products_public_apple_variant_uidx";
--> statement-breakpoint
WITH duplicate_apple_variants AS (
  SELECT
    id,
    slug,
    first_value(id) OVER variant_window AS canonical_id,
    first_value(slug) OVER variant_window AS canonical_slug,
    row_number() OVER variant_window AS duplicate_rank
  FROM catalog_products
  WHERE kind = 'apple_gift_card'
    AND details ? 'appleGiftCard'
    AND coalesce(details -> 'appleGiftCard' ->> 'regionCode', '') <> ''
    AND coalesce(details -> 'appleGiftCard' ->> 'currency', '') <> ''
    AND coalesce(details -> 'appleGiftCard' ->> 'nominalMinor', '') <> ''
  WINDOW variant_window AS (
    PARTITION BY
      upper(details -> 'appleGiftCard' ->> 'regionCode'),
      upper(details -> 'appleGiftCard' ->> 'currency'),
      details -> 'appleGiftCard' ->> 'nominalMinor'
    ORDER BY public_enabled DESC, created_at ASC, id ASC
  )
),
duplicate_cart_items AS (
  SELECT
    cart_items.cart_id,
    duplicate_apple_variants.canonical_slug AS product_slug,
    LEAST(50, sum(cart_items.quantity))::integer AS quantity,
    (array_agg(cart_items.recipient ORDER BY cart_items.created_at ASC, cart_items.id ASC))[1] AS recipient,
    min(cart_items.created_at) AS created_at,
    clock_timestamp() AS updated_at
  FROM cart_items
  JOIN duplicate_apple_variants ON duplicate_apple_variants.slug = cart_items.product_slug
  WHERE duplicate_apple_variants.duplicate_rank > 1
  GROUP BY cart_items.cart_id, duplicate_apple_variants.canonical_slug
)
INSERT INTO cart_items (cart_id, product_slug, quantity, recipient, created_at, updated_at)
SELECT cart_id, product_slug, quantity, recipient, created_at, updated_at
FROM duplicate_cart_items
ON CONFLICT (cart_id, product_slug) DO UPDATE
SET quantity = LEAST(50, cart_items.quantity + EXCLUDED.quantity),
    recipient = cart_items.recipient,
    updated_at = clock_timestamp();
--> statement-breakpoint
WITH duplicate_apple_variants AS (
  SELECT
    slug,
    row_number() OVER (
      PARTITION BY
        upper(details -> 'appleGiftCard' ->> 'regionCode'),
        upper(details -> 'appleGiftCard' ->> 'currency'),
        details -> 'appleGiftCard' ->> 'nominalMinor'
      ORDER BY public_enabled DESC, created_at ASC, id ASC
    ) AS duplicate_rank
  FROM catalog_products
  WHERE kind = 'apple_gift_card'
    AND details ? 'appleGiftCard'
    AND coalesce(details -> 'appleGiftCard' ->> 'regionCode', '') <> ''
    AND coalesce(details -> 'appleGiftCard' ->> 'currency', '') <> ''
    AND coalesce(details -> 'appleGiftCard' ->> 'nominalMinor', '') <> ''
)
DELETE FROM cart_items
USING duplicate_apple_variants
WHERE cart_items.product_slug = duplicate_apple_variants.slug
  AND duplicate_apple_variants.duplicate_rank > 1;
--> statement-breakpoint
WITH duplicate_apple_variants AS (
  SELECT
    id,
    slug,
    first_value(id) OVER variant_window AS canonical_id,
    first_value(slug) OVER variant_window AS canonical_slug,
    row_number() OVER variant_window AS duplicate_rank
  FROM catalog_products
  WHERE kind = 'apple_gift_card'
    AND details ? 'appleGiftCard'
    AND coalesce(details -> 'appleGiftCard' ->> 'regionCode', '') <> ''
    AND coalesce(details -> 'appleGiftCard' ->> 'currency', '') <> ''
    AND coalesce(details -> 'appleGiftCard' ->> 'nominalMinor', '') <> ''
  WINDOW variant_window AS (
    PARTITION BY
      upper(details -> 'appleGiftCard' ->> 'regionCode'),
      upper(details -> 'appleGiftCard' ->> 'currency'),
      details -> 'appleGiftCard' ->> 'nominalMinor'
    ORDER BY public_enabled DESC, created_at ASC, id ASC
  )
)
UPDATE order_lines
SET product_id = duplicate_apple_variants.canonical_id,
    product_slug = duplicate_apple_variants.canonical_slug
FROM duplicate_apple_variants
WHERE duplicate_apple_variants.duplicate_rank > 1
  AND (
    order_lines.product_id = duplicate_apple_variants.id
    OR order_lines.product_slug = duplicate_apple_variants.slug
  );
--> statement-breakpoint
WITH duplicate_apple_variants AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY
        upper(details -> 'appleGiftCard' ->> 'regionCode'),
        upper(details -> 'appleGiftCard' ->> 'currency'),
        details -> 'appleGiftCard' ->> 'nominalMinor'
      ORDER BY public_enabled DESC, created_at ASC, id ASC
    ) AS duplicate_rank
  FROM catalog_products
  WHERE kind = 'apple_gift_card'
    AND details ? 'appleGiftCard'
    AND coalesce(details -> 'appleGiftCard' ->> 'regionCode', '') <> ''
    AND coalesce(details -> 'appleGiftCard' ->> 'currency', '') <> ''
    AND coalesce(details -> 'appleGiftCard' ->> 'nominalMinor', '') <> ''
)
DELETE FROM catalog_products
USING duplicate_apple_variants
WHERE catalog_products.id = duplicate_apple_variants.id
  AND duplicate_apple_variants.duplicate_rank > 1;
--> statement-breakpoint
UPDATE catalog_products
SET details = jsonb_set(
    details,
    '{appleGiftCard}',
    (((details -> 'appleGiftCard') - 'selectorCountryCode') - 'selectorCountryLabel' - 'selectorRegionCode' - 'selectorRegionLabel'),
    false
  ),
  updated_at = clock_timestamp()
WHERE kind = 'apple_gift_card'
  AND details ? 'appleGiftCard'
  AND (
    details -> 'appleGiftCard' ? 'selectorCountryCode'
    OR details -> 'appleGiftCard' ? 'selectorCountryLabel'
    OR details -> 'appleGiftCard' ? 'selectorRegionCode'
    OR details -> 'appleGiftCard' ? 'selectorRegionLabel'
  );
--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_products_apple_variant_uidx"
ON "catalog_products" USING btree (
  upper(details -> 'appleGiftCard' ->> 'regionCode'),
  upper(details -> 'appleGiftCard' ->> 'currency'),
  (details -> 'appleGiftCard' ->> 'nominalMinor')
)
WHERE kind = 'apple_gift_card'
  AND details ? 'appleGiftCard'
  AND coalesce(details -> 'appleGiftCard' ->> 'regionCode', '') <> ''
  AND coalesce(details -> 'appleGiftCard' ->> 'currency', '') <> ''
  AND coalesce(details -> 'appleGiftCard' ->> 'nominalMinor', '') <> '';
