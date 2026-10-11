CREATE TABLE "apple_gift_card_fulfillments" (
	"order_line_id" uuid PRIMARY KEY NOT NULL,
	"delivery_email" text NOT NULL,
	"region_code" text NOT NULL,
	"currency" text NOT NULL,
	"nominal_minor" integer NOT NULL,
	"code_ciphertext" text,
	"code_nonce" text,
	"code_auth_tag" text,
	"code_version" text,
	"delivery_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_identities" (
	"email" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_verification_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"purpose" text NOT NULL,
	"code_digest" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"resend_available_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"event_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
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
CREATE TABLE "notification_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"status" text NOT NULL,
	"signature_status" text NOT NULL,
	"payload_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "order_public_numbers" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"public_number" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "steam_id64" DROP NOT NULL;
--> statement-breakpoint
CREATE INDEX "apple_gift_card_fulfillments_delivery_email_idx" ON "apple_gift_card_fulfillments" USING btree ("delivery_email");
--> statement-breakpoint
CREATE INDEX "apple_gift_card_fulfillments_region_idx" ON "apple_gift_card_fulfillments" USING btree ("region_code","currency");
--> statement-breakpoint
CREATE UNIQUE INDEX "email_identities_user_uidx" ON "email_identities" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "email_identities_verified_idx" ON "email_identities" USING btree ("verified_at");
--> statement-breakpoint
CREATE INDEX "email_verification_challenges_email_idx" ON "email_verification_challenges" USING btree ("email","created_at");
--> statement-breakpoint
CREATE INDEX "email_verification_challenges_expiry_idx" ON "email_verification_challenges" USING btree ("expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_attempts_channel_idempotency_uidx" ON "notification_attempts" USING btree ("channel","idempotency_key");
--> statement-breakpoint
CREATE INDEX "notification_attempts_notification_idx" ON "notification_attempts" USING btree ("notification_id");
--> statement-breakpoint
CREATE INDEX "notification_attempts_status_idx" ON "notification_attempts" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_outbox_channel_idempotency_uidx" ON "notification_outbox" USING btree ("channel","idempotency_key");
--> statement-breakpoint
CREATE INDEX "notification_outbox_status_available_idx" ON "notification_outbox" USING btree ("status","available_at");
--> statement-breakpoint
CREATE INDEX "notification_outbox_entity_idx" ON "notification_outbox" USING btree ("entity_id","event_type");
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_webhook_events_provider_event_uidx" ON "notification_webhook_events" USING btree ("provider","provider_event_id");
--> statement-breakpoint
CREATE INDEX "notification_webhook_events_status_idx" ON "notification_webhook_events" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX "order_public_numbers_value_uidx" ON "order_public_numbers" USING btree ("public_number");
