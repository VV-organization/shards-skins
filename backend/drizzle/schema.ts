import { sql } from "drizzle-orm";
import { bigint as pgBigint, boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    steamId64: text("steam_id64"),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    disabled: boolean("disabled").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("users_steam_id64_uidx").on(table.steamId64),
    index("users_disabled_idx").on(table.disabled),
  ],
);

export const userSessions = pgTable(
  "user_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    tokenDigest: text("token_digest").notNull(),
    rotatedFromSessionId: uuid("rotated_from_session_id"),
    idleExpiresAt: timestamp("idle_expires_at", { withTimezone: true }).notNull(),
    absoluteExpiresAt: timestamp("absolute_expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("user_sessions_token_digest_uidx").on(table.tokenDigest),
    index("user_sessions_user_active_idx").on(table.userId, table.revokedAt),
    index("user_sessions_cleanup_idx").on(table.absoluteExpiresAt),
  ],
);

export const steamAuthAttempts = pgTable(
  "steam_auth_attempts",
  {
    stateDigest: text("state_digest").primaryKey(),
    browserTokenDigest: text("browser_token_digest").notNull(),
    returnTo: text("return_to").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("steam_auth_attempts_expiry_idx").on(table.expiresAt)],
);

export const steamOpenIdAssertions = pgTable(
  "steam_openid_assertions",
  {
    responseNonce: text("response_nonce").primaryKey(),
    steamId64: text("steam_id64").notNull(),
    claimedIdentifier: text("claimed_identifier").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("steam_openid_assertions_steam_idx").on(table.steamId64)],
);

export const steamTradeCredentials = pgTable("steam_trade_credentials", {
  userId: text("user_id").primaryKey(),
  partnerAccountId: text("partner_account_id").notNull(),
  keyVersion: text("key_version").notNull(),
  cipherVersion: text("cipher_version").notNull(),
  ciphertext: text("ciphertext").notNull(),
  nonce: text("nonce").notNull(),
  authTag: text("auth_tag").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: text("actor_user_id"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    requestId: text("request_id"),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("audit_events_actor_idx").on(table.actorUserId, table.createdAt),
    index("audit_events_target_idx").on(table.targetType, table.targetId, table.createdAt),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: text("id").notNull(),
    scope: text("scope").notNull(),
    requestHash: text("request_hash").notNull(),
    responseHash: text("response_hash"),
    status: text("status").notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scope, table.id] }),
    index("idempotency_keys_status_idx").on(table.status),
  ],
);

export const catalogProducts = pgTable(
  "catalog_products",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    kind: text("kind").notNull(),
    category: text("category").notNull(),
    game: text("game"),
    productType: text("product_type").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    priceCoinMinor: integer("price_coin_minor").notNull(),
    availability: text("availability").notNull(),
    fulfillmentMode: text("fulfillment_mode").notNull(),
    popularity: integer("popularity").notNull(),
    image: text("image"),
    imageAlt: text("image_alt"),
    meta: text("meta").array().notNull(),
    keywords: text("keywords").array().notNull(),
    details: jsonb("details").notNull(),
    supplierProvider: text("supplier_provider"),
    supplierItemId: text("supplier_item_id"),
    supplierSnapshot: jsonb("supplier_snapshot").default({}).notNull(),
    supplierFreshAt: timestamp("supplier_fresh_at", { withTimezone: true }),
    publicEnabled: boolean("public_enabled").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("catalog_products_slug_uidx").on(table.slug),
    index("catalog_products_kind_public_idx").on(table.kind, table.publicEnabled),
    index("catalog_products_game_idx").on(table.game),
    index("catalog_products_product_type_idx").on(table.productType),
    index("catalog_products_supplier_item_idx").on(table.supplierProvider, table.supplierItemId),
    uniqueIndex("catalog_products_apple_variant_uidx")
      .on(
        sql`upper(${table.details}->'appleGiftCard'->>'regionCode')`,
        sql`upper(${table.details}->'appleGiftCard'->>'currency')`,
        sql`${table.details}->'appleGiftCard'->>'nominalMinor'`,
      )
      .where(sql`${table.kind} = 'apple_gift_card'
        AND ${table.details} ? 'appleGiftCard'
        AND coalesce(${table.details}->'appleGiftCard'->>'regionCode', '') <> ''
        AND coalesce(${table.details}->'appleGiftCard'->>'currency', '') <> ''
        AND coalesce(${table.details}->'appleGiftCard'->>'nominalMinor', '') <> ''`),
  ],
);

export const catalogSyncRuns = pgTable(
  "catalog_sync_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: text("source").notNull(),
    game: text("game").notNull(),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    rowCount: integer("row_count").default(0).notNull(),
    errorCode: text("error_code"),
    metadata: jsonb("metadata").default({}).notNull(),
  },
  (table) => [
    index("catalog_sync_runs_source_game_idx").on(table.source, table.game, table.startedAt),
    index("catalog_sync_runs_status_idx").on(table.status),
  ],
);

export const supplierListings = pgTable(
  "supplier_listings",
  {
    supplier: text("supplier").notNull(),
    game: text("game").notNull(),
    marketHashName: text("market_hash_name").notNull(),
    active: boolean("active").default(true).notNull(),
    availableQuantity: integer("available_quantity").notNull(),
    priceMicrousd: pgBigint("price_microusd", { mode: "bigint" }).notNull(),
    imageUrl: text("image_url"),
    snapshot: jsonb("snapshot").default({}).notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastSyncRunId: uuid("last_sync_run_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.supplier, table.game, table.marketHashName] }),
    index("supplier_listings_active_idx").on(table.supplier, table.game, table.active),
    index("supplier_listings_last_seen_idx").on(table.lastSeenAt),
  ],
);

export const catalogMetadataSnapshots = pgTable(
  "catalog_metadata_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(),
    game: text("game").notNull(),
    locale: text("locale").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceHash: text("source_hash").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    itemCount: integer("item_count").notNull(),
    filteredCount: integer("filtered_count").default(0).notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("catalog_metadata_snapshots_source_uidx").on(table.provider, table.game, table.locale, table.sourceHash),
    index("catalog_metadata_snapshots_provider_game_idx").on(table.provider, table.game, table.locale, table.observedAt),
  ],
);

export const catalogMetadataItems = pgTable(
  "catalog_metadata_items",
  {
    provider: text("provider").notNull(),
    game: text("game").notNull(),
    locale: text("locale").notNull(),
    marketHashName: text("market_hash_name").notNull(),
    providerItemId: text("provider_item_id"),
    title: text("title").notNull(),
    description: text("description"),
    categoryName: text("category_name"),
    productType: text("product_type"),
    rarityName: text("rarity_name"),
    imageUrl: text("image_url"),
    tags: text("tags").array().default([]).notNull(),
    raw: jsonb("raw").default({}).notNull(),
    snapshotId: uuid("snapshot_id").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.game, table.locale, table.marketHashName] }),
    index("catalog_metadata_items_game_market_hash_idx").on(table.game, table.marketHashName),
    index("catalog_metadata_items_provider_game_idx").on(table.provider, table.game, table.locale),
    index("catalog_metadata_items_updated_at_idx").on(table.updatedAt),
  ],
);

export const pricingSettings = pgTable(
  "pricing_settings",
  {
    id: text("id").primaryKey(),
    scope: text("scope").notNull(),
    source: text("source").notNull(),
    supplierCurrency: text("supplier_currency").notNull(),
    fiatCurrency: text("fiat_currency").notNull(),
    supplierToFiatRateMinor: integer("supplier_to_fiat_rate_minor").notNull(),
    coinRateNumerator: integer("coin_rate_numerator").notNull(),
    coinRateDenominator: integer("coin_rate_denominator").notNull(),
    markupBps: integer("markup_bps").default(0).notNull(),
    minPriceCoinMinor: integer("min_price_coin_minor").default(100).notNull(),
    roundToCoinMinor: integer("round_to_coin_minor").default(100).notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("pricing_settings_scope_active_idx").on(table.scope, table.supersededAt, table.validFrom),
    index("pricing_settings_source_idx").on(table.source),
  ],
);

export const walletTransactions = pgTable(
  "wallet_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    type: text("type").notNull(),
    status: text("status").default("posted").notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("wallet_transactions_user_idempotency_uidx").on(table.userId, table.idempotencyKey),
    index("wallet_transactions_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const walletLedgerEntries = pgTable(
  "wallet_ledger_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    transactionId: uuid("transaction_id").notNull(),
    userId: text("user_id"),
    accountKey: text("account_key").notNull(),
    amountCoinMinor: integer("amount_coin_minor").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("wallet_ledger_entries_transaction_idx").on(table.transactionId),
    index("wallet_ledger_entries_account_idx").on(table.accountKey, table.createdAt),
    index("wallet_ledger_entries_user_idx").on(table.userId, table.createdAt),
  ],
);

export const topUpPayments = pgTable(
  "top_up_payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    provider: text("provider").notNull(),
    status: text("status").notNull(),
    coinAmountMinor: integer("coin_amount_minor").notNull(),
    fiatAmountMinor: integer("fiat_amount_minor").notNull(),
    fiatCurrency: text("fiat_currency").notNull(),
    rateFiatMinor: integer("rate_fiat_minor").notNull(),
    rateCoinMinor: integer("rate_coin_minor").notNull(),
    providerSessionId: text("provider_session_id"),
    providerCheckoutUrl: text("provider_checkout_url"),
    providerStatus: text("provider_status"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("top_up_payments_user_idempotency_uidx").on(table.userId, table.idempotencyKey),
    index("top_up_payments_user_created_idx").on(table.userId, table.createdAt),
    index("top_up_payments_status_idx").on(table.status),
    index("top_up_payments_provider_session_idx").on(table.provider, table.providerSessionId),
  ],
);

export const steamRefillPayments = pgTable(
  "steam_refill_payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    provider: text("provider").notNull(),
    status: text("status").notNull(),
    amountRubMinor: integer("amount_rub_minor").notNull(),
    feeRubMinor: integer("fee_rub_minor").notNull(),
    fiatAmountMinor: integer("fiat_amount_minor").notNull(),
    fiatCurrency: text("fiat_currency").notNull(),
    steamLogin: text("steam_login").notNull(),
    providerSessionId: text("provider_session_id"),
    providerCheckoutUrl: text("provider_checkout_url"),
    providerStatus: text("provider_status"),
    orderId: uuid("order_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("steam_refill_payments_user_idempotency_uidx").on(table.userId, table.idempotencyKey),
    index("steam_refill_payments_user_created_idx").on(table.userId, table.createdAt),
    index("steam_refill_payments_status_idx").on(table.status),
    index("steam_refill_payments_provider_session_idx").on(table.provider, table.providerSessionId),
  ],
);

export const paymentProviderAttempts = pgTable(
  "payment_provider_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    topUpPaymentId: uuid("top_up_payment_id"),
    steamRefillPaymentId: uuid("steam_refill_payment_id"),
    provider: text("provider").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull(),
    requestHash: text("request_hash").notNull(),
    requestSnapshot: jsonb("request_snapshot").default({}).notNull(),
    responseSnapshot: jsonb("response_snapshot").default({}).notNull(),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("payment_provider_attempts_provider_idempotency_uidx").on(table.provider, table.idempotencyKey),
    index("payment_provider_attempts_payment_idx").on(table.topUpPaymentId),
    index("payment_provider_attempts_steam_refill_payment_idx").on(table.steamRefillPaymentId),
    index("payment_provider_attempts_status_idx").on(table.status),
  ],
);

export const paymentWebhookEvents = pgTable(
  "payment_webhook_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    status: text("status").notNull(),
    signatureStatus: text("signature_status").notNull(),
    payloadSnapshot: jsonb("payload_snapshot").default({}).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("payment_webhook_events_provider_event_uidx").on(table.provider, table.providerEventId),
    index("payment_webhook_events_status_idx").on(table.status),
  ],
);

export const carts = pgTable(
  "carts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    status: text("status").default("active").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("carts_user_active_uidx").on(table.userId, table.status),
    index("carts_user_updated_idx").on(table.userId, table.updatedAt),
  ],
);

export const cartItems = pgTable(
  "cart_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cartId: uuid("cart_id").notNull(),
    productSlug: text("product_slug").notNull(),
    quantity: integer("quantity").notNull(),
    recipient: jsonb("recipient").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("cart_items_cart_product_uidx").on(table.cartId, table.productSlug),
    index("cart_items_cart_idx").on(table.cartId),
  ],
);

export const cartBundles = pgTable("cart_bundles", {
  cartId: uuid("cart_id").notNull(),
  bundleId: text("bundle_id").notNull(),
  productSlugs: jsonb("product_slugs").notNull(),
  quoteSnapshot: jsonb("quote_snapshot").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [uniqueIndex("cart_bundles_cart_bundle_uidx").on(table.cartId, table.bundleId)]);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status").notNull(),
    totalCoinMinor: integer("total_coin_minor").notNull(),
    recipientSnapshots: jsonb("recipient_snapshots").default([]).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("orders_user_idempotency_uidx").on(table.userId, table.idempotencyKey),
    index("orders_user_created_idx").on(table.userId, table.createdAt),
    index("orders_status_idx").on(table.status),
  ],
);

export const orderLines = pgTable(
  "order_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id").notNull(),
    lineIndex: integer("line_index").notNull(),
    productId: text("product_id").notNull(),
    productSlug: text("product_slug").notNull(),
    bundleId: text("bundle_id"),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    unitPriceCoinMinor: integer("unit_price_coin_minor").notNull(),
    quantity: integer("quantity").notNull(),
    recipientSnapshot: jsonb("recipient_snapshot").default({}).notNull(),
    status: text("status").default("held").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("order_lines_order_line_uidx").on(table.orderId, table.lineIndex),
    index("order_lines_product_idx").on(table.productId),
    index("order_lines_status_idx").on(table.status),
  ],
);

export const fulfillmentCommands = pgTable(
  "fulfillment_commands",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id").notNull(),
    orderLineId: uuid("order_line_id").notNull(),
    provider: text("provider").notNull(),
    commandType: text("command_type").notNull(),
    status: text("status").default("pending").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payloadSnapshot: jsonb("payload_snapshot").default({}).notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("fulfillment_commands_order_line_type_uidx").on(table.orderLineId, table.commandType),
    uniqueIndex("fulfillment_commands_provider_idempotency_uidx").on(table.provider, table.idempotencyKey),
    index("fulfillment_commands_order_idx").on(table.orderId),
    index("fulfillment_commands_status_available_idx").on(table.status, table.availableAt),
  ],
);

export const fulfillmentProviderAttempts = pgTable(
  "fulfillment_provider_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    commandId: uuid("command_id").notNull(),
    orderId: uuid("order_id").notNull(),
    orderLineId: uuid("order_line_id").notNull(),
    provider: text("provider").notNull(),
    operation: text("operation").notNull(),
    status: text("status").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    providerOrderId: text("provider_order_id"),
    requestSnapshot: jsonb("request_snapshot").default({}).notNull(),
    responseSnapshot: jsonb("response_snapshot").default({}).notNull(),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("fulfillment_provider_attempts_provider_idempotency_uidx").on(table.provider, table.idempotencyKey),
    index("fulfillment_provider_attempts_command_idx").on(table.commandId),
    index("fulfillment_provider_attempts_order_idx").on(table.orderId),
    index("fulfillment_provider_attempts_status_idx").on(table.status),
  ],
);

export const walletHolds = pgTable(
  "wallet_holds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    orderId: uuid("order_id").notNull(),
    amountCoinMinor: integer("amount_coin_minor").notNull(),
    status: text("status").default("active").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("wallet_holds_order_uidx").on(table.orderId),
    index("wallet_holds_user_status_idx").on(table.userId, table.status),
  ],
);

export const emailIdentities = pgTable(
  "email_identities",
  {
    email: text("email").primaryKey(),
    userId: text("user_id").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("email_identities_user_uidx").on(table.userId),
    index("email_identities_verified_idx").on(table.verifiedAt),
  ],
);

export const emailVerificationChallenges = pgTable(
  "email_verification_challenges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    purpose: text("purpose").notNull(),
    targetUserId: text("target_user_id"),
    targetSessionDigest: text("target_session_digest"),
    codeDigest: text("code_digest").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    resendAvailableAt: timestamp("resend_available_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("email_verification_challenges_email_idx").on(table.email, table.createdAt),
    index("email_verification_challenges_expiry_idx").on(table.expiresAt),
  ],
);

export const notificationOutbox = pgTable(
  "notification_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    channel: text("channel").notNull(),
    eventType: text("event_type").notNull(),
    entityId: text("entity_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonb("payload").default({}).notNull(),
    status: text("status").default("pending").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("notification_outbox_channel_idempotency_uidx").on(table.channel, table.idempotencyKey),
    index("notification_outbox_status_available_idx").on(table.status, table.availableAt),
    index("notification_outbox_entity_idx").on(table.entityId, table.eventType),
  ],
);

export const notificationAttempts = pgTable(
  "notification_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    notificationId: uuid("notification_id").notNull(),
    channel: text("channel").notNull(),
    status: text("status").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestSnapshot: jsonb("request_snapshot").default({}).notNull(),
    responseSnapshot: jsonb("response_snapshot").default({}).notNull(),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("notification_attempts_channel_idempotency_uidx").on(table.channel, table.idempotencyKey),
    index("notification_attempts_notification_idx").on(table.notificationId),
    index("notification_attempts_status_idx").on(table.status),
  ],
);

export const notificationWebhookEvents = pgTable(
  "notification_webhook_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    status: text("status").notNull(),
    signatureStatus: text("signature_status").notNull(),
    payloadSnapshot: jsonb("payload_snapshot").default({}).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("notification_webhook_events_provider_event_uidx").on(table.provider, table.providerEventId),
    index("notification_webhook_events_status_idx").on(table.status),
  ],
);

export const vvAdminIntegrationOutbox = pgTable(
  "vv_admin_integration_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectExternalId: text("subject_external_id").notNull(),
    payload: jsonb("payload").default({}).notNull(),
    status: text("status").default("pending").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("vv_admin_integration_outbox_event_uidx").on(table.eventId),
    index("vv_admin_integration_outbox_status_available_idx").on(table.status, table.availableAt),
    index("vv_admin_integration_outbox_subject_idx").on(table.subjectType, table.subjectExternalId),
  ],
);

export const vvAdminIntegrationAttempts = pgTable(
  "vv_admin_integration_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    outboxId: uuid("outbox_id").notNull(),
    status: text("status").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestSnapshot: jsonb("request_snapshot").default({}).notNull(),
    responseSnapshot: jsonb("response_snapshot").default({}).notNull(),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("vv_admin_integration_attempts_idempotency_uidx").on(table.idempotencyKey),
    index("vv_admin_integration_attempts_outbox_idx").on(table.outboxId),
  ],
);

export const appleGiftCardFulfillments = pgTable(
  "apple_gift_card_fulfillments",
  {
    orderLineId: uuid("order_line_id").primaryKey(),
    deliveryEmail: text("delivery_email").notNull(),
    regionCode: text("region_code").notNull(),
    currency: text("currency").notNull(),
    nominalMinor: integer("nominal_minor").notNull(),
    codeCiphertext: text("code_ciphertext"),
    codeNonce: text("code_nonce"),
    codeAuthTag: text("code_auth_tag"),
    codeVersion: text("code_version"),
    deliveryVersion: integer("delivery_version").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("apple_gift_card_fulfillments_delivery_email_idx").on(table.deliveryEmail),
    index("apple_gift_card_fulfillments_region_idx").on(table.regionCode, table.currency),
  ],
);

export const orderPublicNumbers = pgTable(
  "order_public_numbers",
  {
    orderId: uuid("order_id").primaryKey(),
    publicNumber: text("public_number").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("order_public_numbers_value_uidx").on(table.publicNumber)],
);
