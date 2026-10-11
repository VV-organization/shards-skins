CREATE TABLE "payment_provider_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"top_up_payment_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text NOT NULL,
	"request_hash" text NOT NULL,
	"request_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"status" text NOT NULL,
	"signature_status" text NOT NULL,
	"payload_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "top_up_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"coin_amount_minor" integer NOT NULL,
	"fiat_amount_minor" integer NOT NULL,
	"fiat_currency" text NOT NULL,
	"rate_fiat_minor" integer NOT NULL,
	"rate_coin_minor" integer NOT NULL,
	"provider_session_id" text,
	"provider_checkout_url" text,
	"provider_status" text,
	"expires_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_provider_attempts_provider_idempotency_uidx" ON "payment_provider_attempts" USING btree ("provider","idempotency_key");--> statement-breakpoint
CREATE INDEX "payment_provider_attempts_payment_idx" ON "payment_provider_attempts" USING btree ("top_up_payment_id");--> statement-breakpoint
CREATE INDEX "payment_provider_attempts_status_idx" ON "payment_provider_attempts" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_webhook_events_provider_event_uidx" ON "payment_webhook_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "payment_webhook_events_status_idx" ON "payment_webhook_events" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "top_up_payments_user_idempotency_uidx" ON "top_up_payments" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "top_up_payments_user_created_idx" ON "top_up_payments" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "top_up_payments_status_idx" ON "top_up_payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "top_up_payments_provider_session_idx" ON "top_up_payments" USING btree ("provider","provider_session_id");
