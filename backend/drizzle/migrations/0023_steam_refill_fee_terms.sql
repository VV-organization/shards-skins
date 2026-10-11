ALTER TABLE "steam_refill_payments" ADD COLUMN "fee_rub_minor" integer;--> statement-breakpoint
ALTER TABLE "steam_refill_payments" ADD COLUMN "fiat_amount_minor" integer;--> statement-breakpoint
UPDATE "steam_refill_payments"
SET
  "fee_rub_minor" = 0,
  "fiat_amount_minor" = "amount_rub_minor";--> statement-breakpoint
ALTER TABLE "steam_refill_payments" ALTER COLUMN "fee_rub_minor" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "steam_refill_payments" ALTER COLUMN "fiat_amount_minor" SET NOT NULL;
