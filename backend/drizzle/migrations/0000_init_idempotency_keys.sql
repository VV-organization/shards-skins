CREATE TABLE "idempotency_keys" (
	"id" text NOT NULL,
	"scope" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_hash" text,
	"status" text NOT NULL,
	"locked_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_scope_id_pk" PRIMARY KEY("scope","id")
);
--> statement-breakpoint
CREATE INDEX "idempotency_keys_status_idx" ON "idempotency_keys" USING btree ("status");