WITH apple_gift_card_rates(currency, unit, rate_rub_scaled) AS (
  VALUES
    ('AED', 1, 228198),
    ('BRL', 1, 162303),
    ('CAD', 1, 601621),
    ('CNY', 1, 124175),
    ('EUR', 1, 967538),
    ('GBP', 1, 1132133),
    ('INR', 100, 878377),
    ('JPY', 100, 525956),
    ('KZT', 100, 180154),
    ('NZD', 1, 490725),
    ('PLN', 1, 224308),
    ('RUB', 1, 10000),
    ('TRY', 10, 175654),
    ('USD', 1, 838058)
),
apple_gift_card_prices AS (
  SELECT
    catalog_products.id,
    (
      (
        (
          (((catalog_products.details -> 'appleGiftCard' ->> 'nominalMinor')::bigint * apple_gift_card_rates.rate_rub_scaled::bigint)
            + (apple_gift_card_rates.unit::bigint * 10000) - 1
          )
          / (apple_gift_card_rates.unit::bigint * 10000)
        )
        * 150 + 99
      )
      / 100
    )::integer AS minimum_price_coin_minor
  FROM catalog_products
  JOIN apple_gift_card_rates
    ON apple_gift_card_rates.currency = upper(catalog_products.details -> 'appleGiftCard' ->> 'currency')
  WHERE catalog_products.kind = 'apple_gift_card'
    AND catalog_products.details ? 'appleGiftCard'
    AND coalesce(catalog_products.details -> 'appleGiftCard' ->> 'nominalMinor', '') <> ''
)
UPDATE catalog_products
SET price_coin_minor = GREATEST(catalog_products.price_coin_minor, apple_gift_card_prices.minimum_price_coin_minor),
    updated_at = clock_timestamp()
FROM apple_gift_card_prices
WHERE catalog_products.id = apple_gift_card_prices.id
  AND catalog_products.price_coin_minor < apple_gift_card_prices.minimum_price_coin_minor;
