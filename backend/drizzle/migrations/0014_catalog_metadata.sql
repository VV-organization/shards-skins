CREATE TABLE "catalog_metadata_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider" text NOT NULL,
  "game" text NOT NULL,
  "locale" text NOT NULL,
  "source_url" text NOT NULL,
  "source_hash" text NOT NULL,
  "observed_at" timestamp with time zone NOT NULL,
  "item_count" integer NOT NULL,
  "filtered_count" integer DEFAULT 0 NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "catalog_metadata_snapshots_source_uidx" ON "catalog_metadata_snapshots" USING btree ("provider","game","locale","source_hash");
CREATE INDEX "catalog_metadata_snapshots_provider_game_idx" ON "catalog_metadata_snapshots" USING btree ("provider","game","locale","observed_at");

CREATE TABLE "catalog_metadata_items" (
  "provider" text NOT NULL,
  "game" text NOT NULL,
  "locale" text NOT NULL,
  "market_hash_name" text NOT NULL,
  "provider_item_id" text,
  "title" text NOT NULL,
  "description" text,
  "category_name" text,
  "product_type" text,
  "rarity_name" text,
  "image_url" text,
  "tags" text[] DEFAULT '{}'::text[] NOT NULL,
  "raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "snapshot_id" uuid NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "catalog_metadata_items_pk" PRIMARY KEY("provider","game","locale","market_hash_name"),
  CONSTRAINT "catalog_metadata_items_snapshot_fk" FOREIGN KEY ("snapshot_id") REFERENCES "catalog_metadata_snapshots"("id")
);
CREATE INDEX "catalog_metadata_items_game_market_hash_idx" ON "catalog_metadata_items" USING btree ("game","market_hash_name");
CREATE INDEX "catalog_metadata_items_provider_game_idx" ON "catalog_metadata_items" USING btree ("provider","game","locale");
CREATE INDEX "catalog_metadata_items_updated_at_idx" ON "catalog_metadata_items" USING btree ("updated_at");
