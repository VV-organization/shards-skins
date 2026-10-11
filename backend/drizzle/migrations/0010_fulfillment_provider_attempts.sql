CREATE TABLE "fulfillment_provider_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"command_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"operation" text NOT NULL,
	"status" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"provider_order_id" text,
	"request_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fulfillment_provider_attempts_provider_idempotency_uidx" ON "fulfillment_provider_attempts" USING btree ("provider","idempotency_key");--> statement-breakpoint
CREATE INDEX "fulfillment_provider_attempts_command_idx" ON "fulfillment_provider_attempts" USING btree ("command_id");--> statement-breakpoint
CREATE INDEX "fulfillment_provider_attempts_order_idx" ON "fulfillment_provider_attempts" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "fulfillment_provider_attempts_status_idx" ON "fulfillment_provider_attempts" USING btree ("status");
