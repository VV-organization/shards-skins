-- Historical seed descriptions described a particular asset float, but SIH purchases by market name.
UPDATE catalog_products SET
  description = regexp_replace(regexp_replace(replace(description, 'Vault', 'Frags'), ', Float [0-9]+\.[0-9]+', '', 'g'), 'Float [0-9]+\.[0-9]+ и ', '', 'g'),
  details = replace(details::text, 'Vault', 'Frags')::jsonb
WHERE kind = 'skins' AND lower(game) = 'cs2';
