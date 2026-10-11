-- Bundle tables/columns already exist from donor migration 0026 (custom SQL).
ALTER TABLE "email_verification_challenges" ADD COLUMN "target_user_id" text;
--> statement-breakpoint
ALTER TABLE "email_verification_challenges" ADD COLUMN "target_session_digest" text;
