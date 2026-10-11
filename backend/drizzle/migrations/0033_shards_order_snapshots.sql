ALTER TABLE "fulfillment_commands" ADD COLUMN "provider_operation_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN "commerce_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "checkout_quote_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "response_snapshot" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "fulfillment_commands_operation_uidx" ON "fulfillment_commands" USING btree ("provider_operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_checkout_quote_uidx" ON "orders" USING btree ("checkout_quote_id");