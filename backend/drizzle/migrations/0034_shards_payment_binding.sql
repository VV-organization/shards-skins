ALTER TABLE "steam_refill_payments" ADD COLUMN "provider_payment_id" text;--> statement-breakpoint
ALTER TABLE "top_up_payments" ADD COLUMN "provider_payment_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "steam_refill_payments_provider_payment_uidx" ON "steam_refill_payments" USING btree ("provider","provider_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "top_up_payments_provider_payment_uidx" ON "top_up_payments" USING btree ("provider","provider_payment_id");