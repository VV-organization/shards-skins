-- Frags publishes only CS2 skins. Steam refill uses a separate payment flow.
UPDATE catalog_products SET public_enabled = false WHERE kind <> 'skins' OR lower(coalesce(game, '')) <> 'cs2';
--> statement-breakpoint
ALTER TABLE catalog_products ADD CONSTRAINT frags_public_catalog_scope CHECK (NOT public_enabled OR (kind = 'skins' AND lower(coalesce(game, '')) = 'cs2'));
