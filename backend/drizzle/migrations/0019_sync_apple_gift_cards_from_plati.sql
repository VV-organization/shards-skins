WITH apple_gift_card_source(region_code, region_label, currency, nominal_minors, displays) AS (
  VALUES
    ('US', 'US', 'USD', ARRAY[200,300,400,500,600,700,800,900,1000,1500,2000,2500,3000,3500,4000,4500,5000,6000,7000,7500,8000,9000,10000,15000,20000,25000,30000,40000,50000], ARRAY['2 USD','3 USD','4 USD','5 USD','6 USD','7 USD','8 USD','9 USD','10 USD','15 USD','20 USD','25 USD','30 USD','35 USD','40 USD','45 USD','50 USD','60 USD','70 USD','75 USD','80 USD','90 USD','100 USD','150 USD','200 USD','250 USD','300 USD','400 USD','500 USD']),
    ('TR', 'TRY', 'TRY', ARRAY[1000,1500,2000,2500,3000,4000,4500,5000,6000,7500,10000,12500,15000,17500,20000,25000,30000,35000,40000,50000,60000,70000,75000,80000,90000,100000,125000,150000,175000,200000,250000,300000,400000,500000,700000,1000000], ARRAY['10 TRY','15 TRY','20 TRY','25 TRY','30 TRY','40 TRY','45 TRY','50 TRY','60 TRY','75 TRY','100 TRY','125 TRY','150 TRY','175 TRY','200 TRY','250 TRY','300 TRY','350 TRY','400 TRY','500 TRY','600 TRY','700 TRY','750 TRY','800 TRY','900 TRY','1000 TRY','1250 TRY','1500 TRY','1750 TRY','2000 TRY','2500 TRY','3000 TRY','4000 TRY','5000 TRY','7000 TRY','10000 TRY']),
    ('RU', 'RU', 'RUB', ARRAY[50000,60000,70000,80000,90000,100000,150000,200000,250000,300000,350000,400000,450000,500000,600000,700000,800000,850000,900000,1000000,1200000,1500000], ARRAY['500 RUB','600 RUB','700 RUB','800 RUB','900 RUB','1000 RUB','1500 RUB','2000 RUB','2500 RUB','3000 RUB','3500 RUB','4000 RUB','4500 RUB','5000 RUB','6000 RUB','7000 RUB','8000 RUB','8500 RUB','9000 RUB','10000 RUB','12000 RUB','15000 RUB']),
    ('KZ', 'KZ', 'KZT', ARRAY[200000,300000,400000,500000,1000000,1500000,2000000,3000000,4500000], ARRAY['2000 KZT','3000 KZT','4000 KZT','5000 KZT','10000 KZT','15000 KZT','20000 KZT','30000 KZT','45000 KZT']),
    ('IN', 'INR', 'INR', ARRAY[10000,15000,20000,25000,30000,40000,50000,60000,70000,75000,80000,100000,150000,200000,250000,300000,400000,500000,750000,800000,1000000,1500000,2000000,3000000], ARRAY['100 INR','150 INR','200 INR','250 INR','300 INR','400 INR','500 INR','600 INR','700 INR','750 INR','800 INR','1000 INR','1500 INR','2000 INR','2500 INR','3000 INR','4000 INR','5000 INR','7500 INR','8000 INR','10000 INR','15000 INR','20000 INR','30000 INR']),
    ('PL', 'PL', 'PLN', ARRAY[2000,2500,5000,10000,15000,20000], ARRAY['20 PLN','25 PLN','50 PLN','100 PLN','150 PLN','200 PLN']),
    ('JP', 'JPY', 'JPY', ARRAY[50000,100000,200000,300000,500000,800000,1000000,2000000,3000000,5000000,7000000], ARRAY['500 JPY','1000 JPY','2000 JPY','3000 JPY','5000 JPY','8000 JPY','10000 JPY','20000 JPY','30000 JPY','50000 JPY','70000 JPY']),
    ('CA', 'CAN', 'CAD', ARRAY[500,600,700,800,900,1000,1500,2000,2500,3000,4000,5000,6000,7000,7500,8000,9000,10000,15000,20000,25000,30000,40000,50000], ARRAY['5 CAD','6 CAD','7 CAD','8 CAD','9 CAD','10 CAD','15 CAD','20 CAD','25 CAD','30 CAD','40 CAD','50 CAD','60 CAD','70 CAD','75 CAD','80 CAD','90 CAD','100 CAD','150 CAD','200 CAD','250 CAD','300 CAD','400 CAD','500 CAD']),
    ('UK', 'UK', 'GBP', ARRAY[200,300,400,500,1000,1500,2000,2500,3000,4000,5000,7500,10000,15000,20000,25000,30000,40000,50000], ARRAY['2 GBP','3 GBP','4 GBP','5 GBP','10 GBP','15 GBP','20 GBP','25 GBP','30 GBP','40 GBP','50 GBP','75 GBP','100 GBP','150 GBP','200 GBP','250 GBP','300 GBP','400 GBP','500 GBP']),
    ('EU', 'EU', 'CHF', ARRAY[200,300,400,500,1000,1500,2500,5000,10000], ARRAY['2 CHF','3 CHF','4 CHF','5 CHF','10 CHF','15 CHF','25 CHF','50 CHF','100 CHF']),
    ('EU', 'EU', 'EUR', ARRAY[200,300,400,500,1000,1500,2000,2500,3000,3500,4000,4500,5000,6000,7000,7500,8000,9000,10000,15000,20000,25000,30000], ARRAY['2 EUR','3 EUR','4 EUR','5 EUR','10 EUR','15 EUR','20 EUR','25 EUR','30 EUR','35 EUR','40 EUR','45 EUR','50 EUR','60 EUR','70 EUR','75 EUR','80 EUR','90 EUR','100 EUR','150 EUR','200 EUR','250 EUR','300 EUR']),
    ('EU', 'EU', 'PLN', ARRAY[2000,2500,5000,10000,15000,20000], ARRAY['20 PLN','25 PLN','50 PLN','100 PLN','150 PLN','200 PLN']),
    ('EU', 'EU', 'NOK', ARRAY[2000,3000,4000,5000,10000,15000,25000,50000,100000], ARRAY['20 NOK','30 NOK','40 NOK','50 NOK','100 NOK','150 NOK','250 NOK','500 NOK','1000 NOK']),
    ('BR', 'BRL', 'BRL', ARRAY[2000,3000,4000,5000,7500,10000,15000,20000], ARRAY['20 BRL','30 BRL','40 BRL','50 BRL','75 BRL','100 BRL','150 BRL','200 BRL']),
    ('AE', 'AED', 'AED', ARRAY[5000,7500,10000,15000,20000,25000,30000,40000,50000,75000,100000,150000,200000,250000,300000,400000,500000], ARRAY['50 AED','75 AED','100 AED','150 AED','200 AED','250 AED','300 AED','400 AED','500 AED','750 AED','1000 AED','1500 AED','2000 AED','2500 AED','3000 AED','4000 AED','5000 AED']),
    ('NZ', 'NZD', 'NZD', ARRAY[500,1000,1500,2000,2500,3000,4000,5000,7500,10000,15000,20000,25000,30000,40000,50000], ARRAY['5 NZD','10 NZD','15 NZD','20 NZD','25 NZD','30 NZD','40 NZD','50 NZD','75 NZD','100 NZD','150 NZD','200 NZD','250 NZD','300 NZD','400 NZD','500 NZD']),
    ('CN', 'CNY', 'CNY', ARRAY[600,1000,2000,3000,5000,6800,10000,20000,30000,50000,100000], ARRAY['6 CNY','10 CNY','20 CNY','30 CNY','50 CNY','68 CNY','100 CNY','200 CNY','300 CNY','500 CNY','1000 CNY'])
),
apple_gift_card_cards AS (
  SELECT
    source.region_code,
    source.region_label,
    source.currency,
    card.nominal_minor,
    card.display,
    row_number() OVER (ORDER BY source.region_code, source.currency, card.nominal_minor) AS sort_order
  FROM apple_gift_card_source AS source
  CROSS JOIN LATERAL unnest(source.nominal_minors, source.displays) AS card(nominal_minor, display)
),
apple_gift_card_rates(currency, unit, rate_rub_scaled) AS (
  VALUES
    ('AED', 1, 230211),
    ('BRL', 1, 163038),
    ('CAD', 1, 606578),
    ('CHF', 1, 1039146),
    ('CNY', 1, 124789),
    ('EUR', 1, 975141),
    ('GBP', 1, 1141948),
    ('INR', 100, 885971),
    ('JPY', 100, 530461),
    ('KZT', 100, 181743),
    ('NOK', 10, 887620),
    ('NZD', 1, 495137),
    ('PLN', 1, 226662),
    ('RUB', 1, 10000),
    ('TRY', 10, 177136),
    ('USD', 1, 845449)
),
priced_apple_gift_cards AS (
  SELECT
    cards.region_code,
    cards.region_label,
    cards.currency,
    cards.nominal_minor,
    cards.display,
    ('apple-' || lower(cards.region_code) || '-' || lower(cards.currency) || '-' || (cards.nominal_minor / 100)::text) AS generated_slug,
    (
      (
        (
          ((cards.nominal_minor::bigint * rates.rate_rub_scaled::bigint) + (rates.unit::bigint * 10000) - 1)
          / (rates.unit::bigint * 10000)
        )
        * 150 + 99
      )
      / 100
    )::integer AS price_coin_minor,
    (1000 - cards.sort_order)::integer AS popularity
  FROM apple_gift_card_cards AS cards
  JOIN apple_gift_card_rates AS rates ON rates.currency = cards.currency
)
UPDATE catalog_products
SET
  category = 'Подарочная карта Apple',
  game = NULL,
  product_type = 'Подарочная карта App Store & iTunes',
  title = 'Подарочная карта Apple',
  description = 'Пополняйте баланс Apple ID подарочной картой App Store & iTunes. Код вручную отправит команда Vault после оплаты.',
  price_coin_minor = priced.price_coin_minor,
  availability = 'available',
  fulfillment_mode = 'manual',
  popularity = priced.popularity,
  image = NULL,
  image_alt = NULL,
  meta = ARRAY[priced.region_label, priced.display],
  keywords = ARRAY['apple', 'app store', 'itunes', 'подарочная карта', priced.region_label, priced.currency],
  details = jsonb_build_object(
    'specifications', jsonb_build_array(
      jsonb_build_object('label', 'Регион', 'value', priced.region_label),
      jsonb_build_object('label', 'Номинал', 'value', priced.display)
    ),
    'fulfillment', jsonb_build_object(
      'title', 'Ручная выдача',
      'description', 'Код вручную отправит команда Vault после оплаты.',
      'requirements', jsonb_build_array('Регион Apple ID должен соответствовать выбранной карте.')
    ),
    'appleGiftCard', jsonb_build_object(
      'currency', priced.currency,
      'nominalMinor', priced.nominal_minor,
      'regionCode', priced.region_code,
      'regionLabel', priced.region_label
    )
  ),
  supplier_provider = 'manual',
  supplier_snapshot = jsonb_build_object('source', 'plati.market', 'sourceUrl', 'https://plati.market/games/app-store-itunes/90/', 'observedAt', '2026-08-14'),
  public_enabled = true,
  updated_at = clock_timestamp()
FROM priced_apple_gift_cards AS priced
WHERE catalog_products.kind = 'apple_gift_card'
  AND upper(catalog_products.details -> 'appleGiftCard' ->> 'regionCode') = priced.region_code
  AND upper(catalog_products.details -> 'appleGiftCard' ->> 'currency') = priced.currency
  AND CASE WHEN (catalog_products.details -> 'appleGiftCard' ->> 'nominalMinor') ~ '^[0-9]+$' THEN (catalog_products.details -> 'appleGiftCard' ->> 'nominalMinor')::integer ELSE NULL END = priced.nominal_minor;
--> statement-breakpoint
WITH apple_gift_card_source(region_code, region_label, currency, nominal_minors, displays) AS (
  VALUES
    ('US', 'US', 'USD', ARRAY[200,300,400,500,600,700,800,900,1000,1500,2000,2500,3000,3500,4000,4500,5000,6000,7000,7500,8000,9000,10000,15000,20000,25000,30000,40000,50000], ARRAY['2 USD','3 USD','4 USD','5 USD','6 USD','7 USD','8 USD','9 USD','10 USD','15 USD','20 USD','25 USD','30 USD','35 USD','40 USD','45 USD','50 USD','60 USD','70 USD','75 USD','80 USD','90 USD','100 USD','150 USD','200 USD','250 USD','300 USD','400 USD','500 USD']),
    ('TR', 'TRY', 'TRY', ARRAY[1000,1500,2000,2500,3000,4000,4500,5000,6000,7500,10000,12500,15000,17500,20000,25000,30000,35000,40000,50000,60000,70000,75000,80000,90000,100000,125000,150000,175000,200000,250000,300000,400000,500000,700000,1000000], ARRAY['10 TRY','15 TRY','20 TRY','25 TRY','30 TRY','40 TRY','45 TRY','50 TRY','60 TRY','75 TRY','100 TRY','125 TRY','150 TRY','175 TRY','200 TRY','250 TRY','300 TRY','350 TRY','400 TRY','500 TRY','600 TRY','700 TRY','750 TRY','800 TRY','900 TRY','1000 TRY','1250 TRY','1500 TRY','1750 TRY','2000 TRY','2500 TRY','3000 TRY','4000 TRY','5000 TRY','7000 TRY','10000 TRY']),
    ('RU', 'RU', 'RUB', ARRAY[50000,60000,70000,80000,90000,100000,150000,200000,250000,300000,350000,400000,450000,500000,600000,700000,800000,850000,900000,1000000,1200000,1500000], ARRAY['500 RUB','600 RUB','700 RUB','800 RUB','900 RUB','1000 RUB','1500 RUB','2000 RUB','2500 RUB','3000 RUB','3500 RUB','4000 RUB','4500 RUB','5000 RUB','6000 RUB','7000 RUB','8000 RUB','8500 RUB','9000 RUB','10000 RUB','12000 RUB','15000 RUB']),
    ('KZ', 'KZ', 'KZT', ARRAY[200000,300000,400000,500000,1000000,1500000,2000000,3000000,4500000], ARRAY['2000 KZT','3000 KZT','4000 KZT','5000 KZT','10000 KZT','15000 KZT','20000 KZT','30000 KZT','45000 KZT']),
    ('IN', 'INR', 'INR', ARRAY[10000,15000,20000,25000,30000,40000,50000,60000,70000,75000,80000,100000,150000,200000,250000,300000,400000,500000,750000,800000,1000000,1500000,2000000,3000000], ARRAY['100 INR','150 INR','200 INR','250 INR','300 INR','400 INR','500 INR','600 INR','700 INR','750 INR','800 INR','1000 INR','1500 INR','2000 INR','2500 INR','3000 INR','4000 INR','5000 INR','7500 INR','8000 INR','10000 INR','15000 INR','20000 INR','30000 INR']),
    ('PL', 'PL', 'PLN', ARRAY[2000,2500,5000,10000,15000,20000], ARRAY['20 PLN','25 PLN','50 PLN','100 PLN','150 PLN','200 PLN']),
    ('JP', 'JPY', 'JPY', ARRAY[50000,100000,200000,300000,500000,800000,1000000,2000000,3000000,5000000,7000000], ARRAY['500 JPY','1000 JPY','2000 JPY','3000 JPY','5000 JPY','8000 JPY','10000 JPY','20000 JPY','30000 JPY','50000 JPY','70000 JPY']),
    ('CA', 'CAN', 'CAD', ARRAY[500,600,700,800,900,1000,1500,2000,2500,3000,4000,5000,6000,7000,7500,8000,9000,10000,15000,20000,25000,30000,40000,50000], ARRAY['5 CAD','6 CAD','7 CAD','8 CAD','9 CAD','10 CAD','15 CAD','20 CAD','25 CAD','30 CAD','40 CAD','50 CAD','60 CAD','70 CAD','75 CAD','80 CAD','90 CAD','100 CAD','150 CAD','200 CAD','250 CAD','300 CAD','400 CAD','500 CAD']),
    ('UK', 'UK', 'GBP', ARRAY[200,300,400,500,1000,1500,2000,2500,3000,4000,5000,7500,10000,15000,20000,25000,30000,40000,50000], ARRAY['2 GBP','3 GBP','4 GBP','5 GBP','10 GBP','15 GBP','20 GBP','25 GBP','30 GBP','40 GBP','50 GBP','75 GBP','100 GBP','150 GBP','200 GBP','250 GBP','300 GBP','400 GBP','500 GBP']),
    ('EU', 'EU', 'CHF', ARRAY[200,300,400,500,1000,1500,2500,5000,10000], ARRAY['2 CHF','3 CHF','4 CHF','5 CHF','10 CHF','15 CHF','25 CHF','50 CHF','100 CHF']),
    ('EU', 'EU', 'EUR', ARRAY[200,300,400,500,1000,1500,2000,2500,3000,3500,4000,4500,5000,6000,7000,7500,8000,9000,10000,15000,20000,25000,30000], ARRAY['2 EUR','3 EUR','4 EUR','5 EUR','10 EUR','15 EUR','20 EUR','25 EUR','30 EUR','35 EUR','40 EUR','45 EUR','50 EUR','60 EUR','70 EUR','75 EUR','80 EUR','90 EUR','100 EUR','150 EUR','200 EUR','250 EUR','300 EUR']),
    ('EU', 'EU', 'PLN', ARRAY[2000,2500,5000,10000,15000,20000], ARRAY['20 PLN','25 PLN','50 PLN','100 PLN','150 PLN','200 PLN']),
    ('EU', 'EU', 'NOK', ARRAY[2000,3000,4000,5000,10000,15000,25000,50000,100000], ARRAY['20 NOK','30 NOK','40 NOK','50 NOK','100 NOK','150 NOK','250 NOK','500 NOK','1000 NOK']),
    ('BR', 'BRL', 'BRL', ARRAY[2000,3000,4000,5000,7500,10000,15000,20000], ARRAY['20 BRL','30 BRL','40 BRL','50 BRL','75 BRL','100 BRL','150 BRL','200 BRL']),
    ('AE', 'AED', 'AED', ARRAY[5000,7500,10000,15000,20000,25000,30000,40000,50000,75000,100000,150000,200000,250000,300000,400000,500000], ARRAY['50 AED','75 AED','100 AED','150 AED','200 AED','250 AED','300 AED','400 AED','500 AED','750 AED','1000 AED','1500 AED','2000 AED','2500 AED','3000 AED','4000 AED','5000 AED']),
    ('NZ', 'NZD', 'NZD', ARRAY[500,1000,1500,2000,2500,3000,4000,5000,7500,10000,15000,20000,25000,30000,40000,50000], ARRAY['5 NZD','10 NZD','15 NZD','20 NZD','25 NZD','30 NZD','40 NZD','50 NZD','75 NZD','100 NZD','150 NZD','200 NZD','250 NZD','300 NZD','400 NZD','500 NZD']),
    ('CN', 'CNY', 'CNY', ARRAY[600,1000,2000,3000,5000,6800,10000,20000,30000,50000,100000], ARRAY['6 CNY','10 CNY','20 CNY','30 CNY','50 CNY','68 CNY','100 CNY','200 CNY','300 CNY','500 CNY','1000 CNY'])
),
apple_gift_card_cards AS (
  SELECT
    source.region_code,
    source.region_label,
    source.currency,
    card.nominal_minor,
    card.display,
    row_number() OVER (ORDER BY source.region_code, source.currency, card.nominal_minor) AS sort_order
  FROM apple_gift_card_source AS source
  CROSS JOIN LATERAL unnest(source.nominal_minors, source.displays) AS card(nominal_minor, display)
),
apple_gift_card_rates(currency, unit, rate_rub_scaled) AS (
  VALUES
    ('AED', 1, 230211),
    ('BRL', 1, 163038),
    ('CAD', 1, 606578),
    ('CHF', 1, 1039146),
    ('CNY', 1, 124789),
    ('EUR', 1, 975141),
    ('GBP', 1, 1141948),
    ('INR', 100, 885971),
    ('JPY', 100, 530461),
    ('KZT', 100, 181743),
    ('NOK', 10, 887620),
    ('NZD', 1, 495137),
    ('PLN', 1, 226662),
    ('RUB', 1, 10000),
    ('TRY', 10, 177136),
    ('USD', 1, 845449)
),
priced_apple_gift_cards AS (
  SELECT
    cards.region_code,
    cards.region_label,
    cards.currency,
    cards.nominal_minor,
    cards.display,
    ('apple-' || lower(cards.region_code) || '-' || lower(cards.currency) || '-' || (cards.nominal_minor / 100)::text) AS generated_slug,
    (
      (
        (
          ((cards.nominal_minor::bigint * rates.rate_rub_scaled::bigint) + (rates.unit::bigint * 10000) - 1)
          / (rates.unit::bigint * 10000)
        )
        * 150 + 99
      )
      / 100
    )::integer AS price_coin_minor,
    (1000 - cards.sort_order)::integer AS popularity
  FROM apple_gift_card_cards AS cards
  JOIN apple_gift_card_rates AS rates ON rates.currency = cards.currency
)
INSERT INTO catalog_products (
  id,
  slug,
  kind,
  category,
  game,
  product_type,
  title,
  description,
  price_coin_minor,
  availability,
  fulfillment_mode,
  popularity,
  image,
  image_alt,
  meta,
  keywords,
  details,
  supplier_provider,
  supplier_snapshot,
  public_enabled,
  created_at,
  updated_at
)
SELECT
  priced.generated_slug,
  priced.generated_slug,
  'apple_gift_card',
  'Подарочная карта Apple',
  NULL,
  'Подарочная карта App Store & iTunes',
  'Подарочная карта Apple',
  'Пополняйте баланс Apple ID подарочной картой App Store & iTunes. Код вручную отправит команда Vault после оплаты.',
  priced.price_coin_minor,
  'available',
  'manual',
  priced.popularity,
  NULL,
  NULL,
  ARRAY[priced.region_label, priced.display],
  ARRAY['apple', 'app store', 'itunes', 'подарочная карта', priced.region_label, priced.currency],
  jsonb_build_object(
    'specifications', jsonb_build_array(
      jsonb_build_object('label', 'Регион', 'value', priced.region_label),
      jsonb_build_object('label', 'Номинал', 'value', priced.display)
    ),
    'fulfillment', jsonb_build_object(
      'title', 'Ручная выдача',
      'description', 'Код вручную отправит команда Vault после оплаты.',
      'requirements', jsonb_build_array('Регион Apple ID должен соответствовать выбранной карте.')
    ),
    'appleGiftCard', jsonb_build_object(
      'currency', priced.currency,
      'nominalMinor', priced.nominal_minor,
      'regionCode', priced.region_code,
      'regionLabel', priced.region_label
    )
  ),
  'manual',
  jsonb_build_object('source', 'plati.market', 'sourceUrl', 'https://plati.market/games/app-store-itunes/90/', 'observedAt', '2026-08-14'),
  true,
  clock_timestamp(),
  clock_timestamp()
FROM priced_apple_gift_cards AS priced
WHERE NOT EXISTS (
  SELECT 1
  FROM catalog_products
  WHERE catalog_products.kind = 'apple_gift_card'
    AND upper(catalog_products.details -> 'appleGiftCard' ->> 'regionCode') = priced.region_code
    AND upper(catalog_products.details -> 'appleGiftCard' ->> 'currency') = priced.currency
    AND CASE WHEN (catalog_products.details -> 'appleGiftCard' ->> 'nominalMinor') ~ '^[0-9]+$' THEN (catalog_products.details -> 'appleGiftCard' ->> 'nominalMinor')::integer ELSE NULL END = priced.nominal_minor
);
--> statement-breakpoint
WITH apple_gift_card_source(region_code, currency, nominal_minors) AS (
  VALUES
    ('US', 'USD', ARRAY[200,300,400,500,600,700,800,900,1000,1500,2000,2500,3000,3500,4000,4500,5000,6000,7000,7500,8000,9000,10000,15000,20000,25000,30000,40000,50000]),
    ('TR', 'TRY', ARRAY[1000,1500,2000,2500,3000,4000,4500,5000,6000,7500,10000,12500,15000,17500,20000,25000,30000,35000,40000,50000,60000,70000,75000,80000,90000,100000,125000,150000,175000,200000,250000,300000,400000,500000,700000,1000000]),
    ('RU', 'RUB', ARRAY[50000,60000,70000,80000,90000,100000,150000,200000,250000,300000,350000,400000,450000,500000,600000,700000,800000,850000,900000,1000000,1200000,1500000]),
    ('KZ', 'KZT', ARRAY[200000,300000,400000,500000,1000000,1500000,2000000,3000000,4500000]),
    ('IN', 'INR', ARRAY[10000,15000,20000,25000,30000,40000,50000,60000,70000,75000,80000,100000,150000,200000,250000,300000,400000,500000,750000,800000,1000000,1500000,2000000,3000000]),
    ('PL', 'PLN', ARRAY[2000,2500,5000,10000,15000,20000]),
    ('JP', 'JPY', ARRAY[50000,100000,200000,300000,500000,800000,1000000,2000000,3000000,5000000,7000000]),
    ('CA', 'CAD', ARRAY[500,600,700,800,900,1000,1500,2000,2500,3000,4000,5000,6000,7000,7500,8000,9000,10000,15000,20000,25000,30000,40000,50000]),
    ('UK', 'GBP', ARRAY[200,300,400,500,1000,1500,2000,2500,3000,4000,5000,7500,10000,15000,20000,25000,30000,40000,50000]),
    ('EU', 'CHF', ARRAY[200,300,400,500,1000,1500,2500,5000,10000]),
    ('EU', 'EUR', ARRAY[200,300,400,500,1000,1500,2000,2500,3000,3500,4000,4500,5000,6000,7000,7500,8000,9000,10000,15000,20000,25000,30000]),
    ('EU', 'PLN', ARRAY[2000,2500,5000,10000,15000,20000]),
    ('EU', 'NOK', ARRAY[2000,3000,4000,5000,10000,15000,25000,50000,100000]),
    ('BR', 'BRL', ARRAY[2000,3000,4000,5000,7500,10000,15000,20000]),
    ('AE', 'AED', ARRAY[5000,7500,10000,15000,20000,25000,30000,40000,50000,75000,100000,150000,200000,250000,300000,400000,500000]),
    ('NZ', 'NZD', ARRAY[500,1000,1500,2000,2500,3000,4000,5000,7500,10000,15000,20000,25000,30000,40000,50000]),
    ('CN', 'CNY', ARRAY[600,1000,2000,3000,5000,6800,10000,20000,30000,50000,100000])
),
apple_gift_card_cards AS (
  SELECT source.region_code, source.currency, nominal.nominal_minor
  FROM apple_gift_card_source AS source
  CROSS JOIN LATERAL unnest(source.nominal_minors) AS nominal(nominal_minor)
),
obsolete_apple_gift_cards AS (
  SELECT catalog_products.id, catalog_products.slug
  FROM catalog_products
  WHERE catalog_products.kind = 'apple_gift_card'
    AND catalog_products.details ? 'appleGiftCard'
    AND NOT EXISTS (
      SELECT 1
      FROM apple_gift_card_cards AS cards
      WHERE cards.region_code = upper(catalog_products.details -> 'appleGiftCard' ->> 'regionCode')
        AND cards.currency = upper(catalog_products.details -> 'appleGiftCard' ->> 'currency')
        AND cards.nominal_minor = CASE WHEN (catalog_products.details -> 'appleGiftCard' ->> 'nominalMinor') ~ '^[0-9]+$' THEN (catalog_products.details -> 'appleGiftCard' ->> 'nominalMinor')::integer ELSE NULL END
    )
)
DELETE FROM cart_items
USING obsolete_apple_gift_cards
WHERE cart_items.product_slug = obsolete_apple_gift_cards.slug;
--> statement-breakpoint
WITH apple_gift_card_source(region_code, currency, nominal_minors) AS (
  VALUES
    ('US', 'USD', ARRAY[200,300,400,500,600,700,800,900,1000,1500,2000,2500,3000,3500,4000,4500,5000,6000,7000,7500,8000,9000,10000,15000,20000,25000,30000,40000,50000]),
    ('TR', 'TRY', ARRAY[1000,1500,2000,2500,3000,4000,4500,5000,6000,7500,10000,12500,15000,17500,20000,25000,30000,35000,40000,50000,60000,70000,75000,80000,90000,100000,125000,150000,175000,200000,250000,300000,400000,500000,700000,1000000]),
    ('RU', 'RUB', ARRAY[50000,60000,70000,80000,90000,100000,150000,200000,250000,300000,350000,400000,450000,500000,600000,700000,800000,850000,900000,1000000,1200000,1500000]),
    ('KZ', 'KZT', ARRAY[200000,300000,400000,500000,1000000,1500000,2000000,3000000,4500000]),
    ('IN', 'INR', ARRAY[10000,15000,20000,25000,30000,40000,50000,60000,70000,75000,80000,100000,150000,200000,250000,300000,400000,500000,750000,800000,1000000,1500000,2000000,3000000]),
    ('PL', 'PLN', ARRAY[2000,2500,5000,10000,15000,20000]),
    ('JP', 'JPY', ARRAY[50000,100000,200000,300000,500000,800000,1000000,2000000,3000000,5000000,7000000]),
    ('CA', 'CAD', ARRAY[500,600,700,800,900,1000,1500,2000,2500,3000,4000,5000,6000,7000,7500,8000,9000,10000,15000,20000,25000,30000,40000,50000]),
    ('UK', 'GBP', ARRAY[200,300,400,500,1000,1500,2000,2500,3000,4000,5000,7500,10000,15000,20000,25000,30000,40000,50000]),
    ('EU', 'CHF', ARRAY[200,300,400,500,1000,1500,2500,5000,10000]),
    ('EU', 'EUR', ARRAY[200,300,400,500,1000,1500,2000,2500,3000,3500,4000,4500,5000,6000,7000,7500,8000,9000,10000,15000,20000,25000,30000]),
    ('EU', 'PLN', ARRAY[2000,2500,5000,10000,15000,20000]),
    ('EU', 'NOK', ARRAY[2000,3000,4000,5000,10000,15000,25000,50000,100000]),
    ('BR', 'BRL', ARRAY[2000,3000,4000,5000,7500,10000,15000,20000]),
    ('AE', 'AED', ARRAY[5000,7500,10000,15000,20000,25000,30000,40000,50000,75000,100000,150000,200000,250000,300000,400000,500000]),
    ('NZ', 'NZD', ARRAY[500,1000,1500,2000,2500,3000,4000,5000,7500,10000,15000,20000,25000,30000,40000,50000]),
    ('CN', 'CNY', ARRAY[600,1000,2000,3000,5000,6800,10000,20000,30000,50000,100000])
),
apple_gift_card_cards AS (
  SELECT source.region_code, source.currency, nominal.nominal_minor
  FROM apple_gift_card_source AS source
  CROSS JOIN LATERAL unnest(source.nominal_minors) AS nominal(nominal_minor)
),
obsolete_apple_gift_cards AS (
  SELECT catalog_products.id
  FROM catalog_products
  WHERE catalog_products.kind = 'apple_gift_card'
    AND catalog_products.details ? 'appleGiftCard'
    AND NOT EXISTS (
      SELECT 1
      FROM apple_gift_card_cards AS cards
      WHERE cards.region_code = upper(catalog_products.details -> 'appleGiftCard' ->> 'regionCode')
        AND cards.currency = upper(catalog_products.details -> 'appleGiftCard' ->> 'currency')
        AND cards.nominal_minor = CASE WHEN (catalog_products.details -> 'appleGiftCard' ->> 'nominalMinor') ~ '^[0-9]+$' THEN (catalog_products.details -> 'appleGiftCard' ->> 'nominalMinor')::integer ELSE NULL END
    )
    AND NOT EXISTS (
      SELECT 1
      FROM order_lines
      WHERE order_lines.product_id = catalog_products.id
        OR order_lines.product_slug = catalog_products.slug
    )
)
DELETE FROM catalog_products
USING obsolete_apple_gift_cards
WHERE catalog_products.id = obsolete_apple_gift_cards.id;
--> statement-breakpoint
WITH apple_gift_card_source(region_code, currency, nominal_minors) AS (
  VALUES
    ('US', 'USD', ARRAY[200,300,400,500,600,700,800,900,1000,1500,2000,2500,3000,3500,4000,4500,5000,6000,7000,7500,8000,9000,10000,15000,20000,25000,30000,40000,50000]),
    ('TR', 'TRY', ARRAY[1000,1500,2000,2500,3000,4000,4500,5000,6000,7500,10000,12500,15000,17500,20000,25000,30000,35000,40000,50000,60000,70000,75000,80000,90000,100000,125000,150000,175000,200000,250000,300000,400000,500000,700000,1000000]),
    ('RU', 'RUB', ARRAY[50000,60000,70000,80000,90000,100000,150000,200000,250000,300000,350000,400000,450000,500000,600000,700000,800000,850000,900000,1000000,1200000,1500000]),
    ('KZ', 'KZT', ARRAY[200000,300000,400000,500000,1000000,1500000,2000000,3000000,4500000]),
    ('IN', 'INR', ARRAY[10000,15000,20000,25000,30000,40000,50000,60000,70000,75000,80000,100000,150000,200000,250000,300000,400000,500000,750000,800000,1000000,1500000,2000000,3000000]),
    ('PL', 'PLN', ARRAY[2000,2500,5000,10000,15000,20000]),
    ('JP', 'JPY', ARRAY[50000,100000,200000,300000,500000,800000,1000000,2000000,3000000,5000000,7000000]),
    ('CA', 'CAD', ARRAY[500,600,700,800,900,1000,1500,2000,2500,3000,4000,5000,6000,7000,7500,8000,9000,10000,15000,20000,25000,30000,40000,50000]),
    ('UK', 'GBP', ARRAY[200,300,400,500,1000,1500,2000,2500,3000,4000,5000,7500,10000,15000,20000,25000,30000,40000,50000]),
    ('EU', 'CHF', ARRAY[200,300,400,500,1000,1500,2500,5000,10000]),
    ('EU', 'EUR', ARRAY[200,300,400,500,1000,1500,2000,2500,3000,3500,4000,4500,5000,6000,7000,7500,8000,9000,10000,15000,20000,25000,30000]),
    ('EU', 'PLN', ARRAY[2000,2500,5000,10000,15000,20000]),
    ('EU', 'NOK', ARRAY[2000,3000,4000,5000,10000,15000,25000,50000,100000]),
    ('BR', 'BRL', ARRAY[2000,3000,4000,5000,7500,10000,15000,20000]),
    ('AE', 'AED', ARRAY[5000,7500,10000,15000,20000,25000,30000,40000,50000,75000,100000,150000,200000,250000,300000,400000,500000]),
    ('NZ', 'NZD', ARRAY[500,1000,1500,2000,2500,3000,4000,5000,7500,10000,15000,20000,25000,30000,40000,50000]),
    ('CN', 'CNY', ARRAY[600,1000,2000,3000,5000,6800,10000,20000,30000,50000,100000])
),
apple_gift_card_cards AS (
  SELECT source.region_code, source.currency, nominal.nominal_minor
  FROM apple_gift_card_source AS source
  CROSS JOIN LATERAL unnest(source.nominal_minors) AS nominal(nominal_minor)
),
obsolete_apple_gift_cards AS (
  SELECT catalog_products.id
  FROM catalog_products
  WHERE catalog_products.kind = 'apple_gift_card'
    AND catalog_products.details ? 'appleGiftCard'
    AND NOT EXISTS (
      SELECT 1
      FROM apple_gift_card_cards AS cards
      WHERE cards.region_code = upper(catalog_products.details -> 'appleGiftCard' ->> 'regionCode')
        AND cards.currency = upper(catalog_products.details -> 'appleGiftCard' ->> 'currency')
        AND cards.nominal_minor = CASE WHEN (catalog_products.details -> 'appleGiftCard' ->> 'nominalMinor') ~ '^[0-9]+$' THEN (catalog_products.details -> 'appleGiftCard' ->> 'nominalMinor')::integer ELSE NULL END
    )
)
UPDATE catalog_products
SET public_enabled = false,
    availability = 'unavailable',
    updated_at = clock_timestamp()
FROM obsolete_apple_gift_cards
WHERE catalog_products.id = obsolete_apple_gift_cards.id;
