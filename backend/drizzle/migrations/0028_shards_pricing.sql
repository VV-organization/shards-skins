-- Append a Shards setting without changing historical Frags rates or payment snapshots.
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
SELECT 'pricing-shards-v1', scope, source, supplier_currency, fiat_currency,
  supplier_to_fiat_rate_minor, 8, 5, 2500, 1, 1, clock_timestamp(),
  jsonb_build_object('replaces', id, 'reason', 'Shards 8/5 conversion, half-up, minor precision', 'fxVerified', false)
FROM active WHERE EXISTS (SELECT 1 FROM retired);
