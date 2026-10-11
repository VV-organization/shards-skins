ALTER TABLE "fulfillment_commands" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "fulfillment_commands" ADD COLUMN "lease_owner" text;--> statement-breakpoint
ALTER TABLE "fulfillment_commands" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fulfillment_commands" ADD COLUMN "dispatched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fulfillment_commands" ADD COLUMN "request_snapshot_hash" text;