ALTER TABLE "catalog_products" ADD COLUMN "category_id" text;--> statement-breakpoint
ALTER TABLE "catalog_products" ADD COLUMN "condition_code" text;--> statement-breakpoint
ALTER TABLE "catalog_products" ADD COLUMN "weapon" text;--> statement-breakpoint
ALTER TABLE "catalog_products" ADD COLUMN "stattrak" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_products" ADD COLUMN "ever_published" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE catalog_products SET ever_published=true WHERE supplier_provider='sih' AND public_enabled=true;
