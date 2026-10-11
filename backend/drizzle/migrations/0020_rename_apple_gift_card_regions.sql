WITH apple_region_labels(region_code, region_label) AS (
  VALUES
    ('AE', 'ОАЭ'),
    ('BR', 'Бразилия'),
    ('CA', 'Канада'),
    ('CN', 'Китай'),
    ('EU', 'Европа'),
    ('IN', 'Индия'),
    ('JP', 'Япония'),
    ('KZ', 'Казахстан'),
    ('NZ', 'Новая Зеландия'),
    ('PL', 'Польша'),
    ('RU', 'Россия'),
    ('TR', 'Турция'),
    ('UK', 'Великобритания'),
    ('US', 'США')
)
UPDATE catalog_products
SET
  meta = ARRAY[labels.region_label, catalog_products.details -> 'specifications' -> 1 ->> 'value'],
  keywords = ARRAY[
    'apple',
    'app store',
    'itunes',
    'подарочная карта',
    labels.region_label,
    catalog_products.details -> 'appleGiftCard' ->> 'currency'
  ],
  details = jsonb_set(
    jsonb_set(
      jsonb_set(
        catalog_products.details,
        '{appleGiftCard,regionLabel}',
        to_jsonb(labels.region_label)
      ),
      '{specifications,0,value}',
      to_jsonb(labels.region_label)
    ),
    '{specifications,1,value}',
    to_jsonb(catalog_products.details -> 'specifications' -> 1 ->> 'value')
  ),
  updated_at = clock_timestamp()
FROM apple_region_labels AS labels
WHERE catalog_products.kind = 'apple_gift_card'
  AND catalog_products.details -> 'appleGiftCard' ->> 'regionCode' = labels.region_code;
