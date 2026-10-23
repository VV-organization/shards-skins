-- Hosted Arco Pay checkout uses LifeTime=900. Time alone is not evidence of failure.
ALTER TABLE top_up_payments ALTER COLUMN expires_at SET DEFAULT (now() + interval '15 minutes');
--> statement-breakpoint
ALTER TABLE steam_refill_payments ALTER COLUMN expires_at SET DEFAULT (now() + interval '15 minutes');
--> statement-breakpoint
UPDATE top_up_payments SET expires_at = created_at + interval '15 minutes' WHERE provider = 'arco_pay' AND expires_at IS NULL;
--> statement-breakpoint
UPDATE steam_refill_payments SET expires_at = created_at + interval '15 minutes' WHERE provider = 'arco_pay' AND expires_at IS NULL;
