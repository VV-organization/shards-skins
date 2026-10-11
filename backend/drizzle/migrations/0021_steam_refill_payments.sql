CREATE TABLE "steam_refill_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"amount_rub_minor" integer NOT NULL,
	"fiat_currency" text NOT NULL,
	"steam_login" text NOT NULL,
	"provider_session_id" text,
	"provider_checkout_url" text,
	"provider_status" text,
	"order_id" uuid,
	"expires_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_provider_attempts" ALTER COLUMN "top_up_payment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_provider_attempts" ADD COLUMN "steam_refill_payment_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "steam_refill_payments_user_idempotency_uidx" ON "steam_refill_payments" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "steam_refill_payments_user_created_idx" ON "steam_refill_payments" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "steam_refill_payments_status_idx" ON "steam_refill_payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "steam_refill_payments_provider_session_idx" ON "steam_refill_payments" USING btree ("provider","provider_session_id");--> statement-breakpoint
CREATE INDEX "payment_provider_attempts_steam_refill_payment_idx" ON "payment_provider_attempts" USING btree ("steam_refill_payment_id");
