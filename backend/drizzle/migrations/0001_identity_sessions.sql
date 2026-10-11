CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"request_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "steam_auth_attempts" (
	"state_digest" text PRIMARY KEY NOT NULL,
	"browser_token_digest" text NOT NULL,
	"return_to" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "steam_openid_assertions" (
	"response_nonce" text PRIMARY KEY NOT NULL,
	"steam_id64" text NOT NULL,
	"claimed_identifier" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "steam_trade_credentials" (
	"user_id" text PRIMARY KEY NOT NULL,
	"partner_account_id" text NOT NULL,
	"key_version" text NOT NULL,
	"cipher_version" text NOT NULL,
	"ciphertext" text NOT NULL,
	"nonce" text NOT NULL,
	"auth_tag" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"token_digest" text NOT NULL,
	"rotated_from_session_id" uuid,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"steam_id64" text NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"disabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_target_idx" ON "audit_events" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "steam_auth_attempts_expiry_idx" ON "steam_auth_attempts" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "steam_openid_assertions_steam_idx" ON "steam_openid_assertions" USING btree ("steam_id64");--> statement-breakpoint
CREATE UNIQUE INDEX "user_sessions_token_digest_uidx" ON "user_sessions" USING btree ("token_digest");--> statement-breakpoint
CREATE INDEX "user_sessions_user_active_idx" ON "user_sessions" USING btree ("user_id","revoked_at");--> statement-breakpoint
CREATE INDEX "user_sessions_cleanup_idx" ON "user_sessions" USING btree ("absolute_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_steam_id64_uidx" ON "users" USING btree ("steam_id64");--> statement-breakpoint
CREATE INDEX "users_disabled_idx" ON "users" USING btree ("disabled");