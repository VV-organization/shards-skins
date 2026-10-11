CREATE TABLE "catalog_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"game" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"observed_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"row_count" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_listings" (
	"supplier" text NOT NULL,
	"game" text NOT NULL,
	"market_hash_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"available_quantity" integer NOT NULL,
	"price_microusd" bigint NOT NULL,
	"image_url" text,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_run_id" uuid NOT NULL,
	CONSTRAINT "supplier_listings_supplier_game_market_hash_name_pk" PRIMARY KEY("supplier","game","market_hash_name")
);
--> statement-breakpoint
CREATE INDEX "catalog_sync_runs_source_game_idx" ON "catalog_sync_runs" USING btree ("source","game","started_at");--> statement-breakpoint
CREATE INDEX "catalog_sync_runs_status_idx" ON "catalog_sync_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "supplier_listings_active_idx" ON "supplier_listings" USING btree ("supplier","game","active");--> statement-breakpoint
CREATE INDEX "supplier_listings_last_seen_idx" ON "supplier_listings" USING btree ("last_seen_at");