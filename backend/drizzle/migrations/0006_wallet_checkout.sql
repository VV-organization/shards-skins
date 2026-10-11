CREATE TABLE "wallet_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_transactions_user_idempotency_uidx" ON "wallet_transactions" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "wallet_transactions_user_created_idx" ON "wallet_transactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE TABLE "wallet_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"user_id" text,
	"account_key" text NOT NULL,
	"amount_coin_minor" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "wallet_ledger_entries_transaction_idx" ON "wallet_ledger_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "wallet_ledger_entries_account_idx" ON "wallet_ledger_entries" USING btree ("account_key","created_at");--> statement-breakpoint
CREATE INDEX "wallet_ledger_entries_user_idx" ON "wallet_ledger_entries" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text NOT NULL,
	"total_coin_minor" integer NOT NULL,
	"recipient_snapshots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "orders_user_idempotency_uidx" ON "orders" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "orders_user_created_idx" ON "orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"line_index" integer NOT NULL,
	"product_id" text NOT NULL,
	"product_slug" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"unit_price_coin_minor" integer NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"recipient_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'held' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "order_lines_order_line_uidx" ON "order_lines" USING btree ("order_id","line_index");--> statement-breakpoint
CREATE INDEX "order_lines_product_idx" ON "order_lines" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "order_lines_status_idx" ON "order_lines" USING btree ("status");--> statement-breakpoint
CREATE TABLE "wallet_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"order_id" uuid NOT NULL,
	"amount_coin_minor" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"captured_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_holds_order_uidx" ON "wallet_holds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "wallet_holds_user_status_idx" ON "wallet_holds" USING btree ("user_id","status");
