CREATE TABLE cart_bundles (
  cart_id uuid NOT NULL,
  bundle_id text NOT NULL CHECK (bundle_id IN ('mono', 'chroma', 'metal')),
  product_slugs jsonb NOT NULL CHECK (jsonb_typeof(product_slugs) = 'array' AND jsonb_array_length(product_slugs) = 3),
  quote_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cart_bundles_cart_bundle_uidx UNIQUE (cart_id, bundle_id)
);
--> statement-breakpoint
ALTER TABLE order_lines ADD COLUMN bundle_id text CHECK (bundle_id IS NULL OR bundle_id IN ('mono', 'chroma', 'metal'));
--> statement-breakpoint
-- Version the active supplier setting; never multiply stored catalog prices.
WITH active AS (
  SELECT * FROM pricing_settings WHERE scope = 'sih-skins' AND source = 'sih' AND superseded_at IS NULL
  ORDER BY valid_from DESC, created_at DESC, id DESC LIMIT 1
), retired AS (
  UPDATE pricing_settings SET superseded_at = clock_timestamp()
  WHERE scope = 'sih-skins' AND source = 'sih' AND superseded_at IS NULL RETURNING id
)
INSERT INTO pricing_settings (id, scope, source, supplier_currency, fiat_currency,
  supplier_to_fiat_rate_minor, coin_rate_numerator, coin_rate_denominator, markup_bps,
  min_price_coin_minor, round_to_coin_minor, valid_from, metadata)
SELECT 'pricing-frags-sih-30pct-2026-10-01', scope, source, supplier_currency, fiat_currency,
  supplier_to_fiat_rate_minor, coin_rate_numerator, coin_rate_denominator, 3000,
  min_price_coin_minor, round_to_coin_minor, clock_timestamp(),
  jsonb_build_object('replaces', id, 'reason', 'Frags SIH 30 percent markup')
FROM active WHERE EXISTS (SELECT 1 FROM retired);
