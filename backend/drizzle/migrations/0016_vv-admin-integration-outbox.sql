CREATE TABLE "vv_admin_integration_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_external_id" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vv_admin_integration_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outbox_id" uuid NOT NULL,
	"status" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "vv_admin_integration_outbox_event_uidx" ON "vv_admin_integration_outbox" USING btree ("event_id");
--> statement-breakpoint
CREATE INDEX "vv_admin_integration_outbox_status_available_idx" ON "vv_admin_integration_outbox" USING btree ("status","available_at");
--> statement-breakpoint
CREATE INDEX "vv_admin_integration_outbox_subject_idx" ON "vv_admin_integration_outbox" USING btree ("subject_type","subject_external_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "vv_admin_integration_attempts_idempotency_uidx" ON "vv_admin_integration_attempts" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE INDEX "vv_admin_integration_attempts_outbox_idx" ON "vv_admin_integration_attempts" USING btree ("outbox_id");
