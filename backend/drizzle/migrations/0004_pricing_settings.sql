CREATE TABLE "pricing_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"source" text NOT NULL,
	"supplier_currency" text NOT NULL,
	"fiat_currency" text NOT NULL,
	"supplier_to_fiat_rate_minor" integer NOT NULL,
	"coin_rate_numerator" integer NOT NULL,
	"coin_rate_denominator" integer NOT NULL,
	"markup_bps" integer DEFAULT 0 NOT NULL,
	"min_price_coin_minor" integer DEFAULT 100 NOT NULL,
	"round_to_coin_minor" integer DEFAULT 100 NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "pricing_settings_scope_active_idx" ON "pricing_settings" USING btree ("scope","superseded_at","valid_from");--> statement-breakpoint
CREATE INDEX "pricing_settings_source_idx" ON "pricing_settings" USING btree ("source");--> statement-breakpoint
INSERT INTO "pricing_settings" (
  "id",
  "scope",
  "source",
  "supplier_currency",
  "fiat_currency",
  "supplier_to_fiat_rate_minor",
  "coin_rate_numerator",
  "coin_rate_denominator",
  "markup_bps",
  "min_price_coin_minor",
  "round_to_coin_minor",
  "valid_from",
  "metadata"
) VALUES
(
  'pricing-sih-skins-2026-07-27',
  'sih-skins',
  'sih',
  'USD',
  'RUB',
  9500,
  3,
  2,
  2500,
  100,
  100,
  '2026-07-27T00:00:00.000Z',
  '{"note":"Initial development setting. Replace through an append-only superseding row before production launch."}'::jsonb
),
(
  'pricing-steam-refill-2026-07-27',
  'steam-refill',
  'sih',
  'RUB',
  'RUB',
  100,
  3,
  2,
  0,
  100,
  100,
  '2026-07-27T00:00:00.000Z',
  '{"note":"Initial development setting. Replace through an append-only superseding row before production launch."}'::jsonb
);
