CREATE TABLE "commerce_quote_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" text NOT NULL,
	"user_id" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_entity_id" uuid,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "commerce_quotes_expires_idx" ON "commerce_quotes" USING btree ("expires_at");