CREATE TABLE "fulfillment_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"command_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fulfillment_commands_order_line_uidx" ON "fulfillment_commands" USING btree ("order_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fulfillment_commands_provider_idempotency_uidx" ON "fulfillment_commands" USING btree ("provider","idempotency_key");--> statement-breakpoint
CREATE INDEX "fulfillment_commands_order_idx" ON "fulfillment_commands" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "fulfillment_commands_status_available_idx" ON "fulfillment_commands" USING btree ("status","available_at");
