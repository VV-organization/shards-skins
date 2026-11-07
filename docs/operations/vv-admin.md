# VV Admin connection

The storefront is authoritative for catalog, checkout, wallet and fulfillment.
VV Admin receives signed commerce projections, monitors declared dependencies and
runs the controlled payment-page scenario. The manifest does not expose catalog
editing or standard-store order mutation: Shards has no such Admin API.

## Configuration and discovery

The public manifest is `/api/.well-known/vv-admin/manifest.json`. Register this
explicit manifest URL in VV Admin; the storefront root `/.well-known` path is not
proxied. The backend itself mounts `/.well-known/vv-admin/manifest.json`.
`VV_ADMIN_PUBLIC_ORIGIN` and `VV_ADMIN_API_ORIGIN` override the deployment's
`PUBLIC_FRONTEND_ORIGIN` and `PUBLIC_BASE_URL`. For the current same-host proxy,
these are respectively `https://shardsmarket.com` and
`https://shardsmarket.com/api`. API origin must belong to the public host or its
subdomain. Do not publish example hosts or credentials in the manifest.

Configure a dedicated VV webhook credential using `VV_ADMIN_WEBHOOK_SITE_KEY`,
`VV_ADMIN_WEBHOOK_URL` and `VV_ADMIN_WEBHOOK_SECRET`. The site-to-admin dispatcher
runs with `--watch`, signs the exact durable payload and retries with the same
event ID. Before activating a previously unconfigured outbox, inspect pending
event domain/source and historical provider IDs. Accepted event history is not a
configuration migration. Preserve attempts and audit any explicit repair.

`VV_ADMIN_INTEGRATION_SECRET` is a separate server-to-server scenario secret.
Install its matching value in the encrypted VV Admin site environment. Runtime
entrypoint converts secret environment values to private temporary files. Never
print/copy credentials into Git or browser artifacts.

## Scenario authentication

VV signs `POST`, the public path, timestamp and SHA-256 body digest, separated by
newlines, with HMAC-SHA256. Shards restores the configured public API prefix before
verifying the route: `/api/admin/integration/scenarios/checkout-payment-reached/run`
is signed even though the reverse proxy removes `/api` before Nest receives it.
Timestamps must be canonical ISO UTC with milliseconds and within five minutes.
Missing, altered, expired or future signatures fail authentication. The run ID is
restricted to 1–100 ASCII letters/digits, underscore or hyphen.

## Synthetic payment lifecycle

The manifest requests durable worker execution and disables incompatible legacy
browser scenarios. The signed endpoint uses only reserved technical identity
`synthetic:vv-admin`; it requires enabled real payments and never activates flags.
It requests the normal minimum top-up (100.00 Shards, 62.50 RUB under the existing
1 RUB = 1.6 Shards rule). It does not charge a card or place a supplier order.

The existing per-user transaction lock serializes invoice admission. Repeating
the same run replays its existing payment. A different run is refused with
`SCENARIO_ATTEMPT_REQUIRES_REVIEW` while any technical invoice remains pending,
being created, or under manual review. Local time passage alone never grants a
new provider invoice. Ordinary customer admission rules are unchanged.

The site returns `BROWSER_PAYMENT_REQUIRED`, `payment.reached=false` and a
transient native POST handoff to the exact `https://payment.paidlayer.com` origin.
VV's worker verifies the actual hosted main document before reporting healthy.
The full checkout URL is transient and excluded from persisted result metadata.
Receiving an invoice ID or constructed URL is not successful page verification.

Synthetic entities are retained (`requiresCleanup=false`). The endpoint never
calls local synthetic expiry, changes pending to failed, cancels a provider
invoice, or deletes evidence. Normal provider callbacks/reconciliation continue.
Only authoritative terminal provider results resolve the financial record.
A late capture is accounted exactly once in the isolated technical wallet with
balanced ledger entries; it cannot credit a customer wallet.

All events for the exact technical identity carry `source:scenario`. They must be
excluded from customer commerce projections and customer/paid-order notifications
by the receiver. The sender does not create a direct top-up notification. Current
customer IDs retain `source:customer`.

## Verification

Backend unit tests cover fresh/stale/tampered signatures, public path binding,
refusal when payments are disabled/fake, handoff allowlisting and honest pending
results. `synthetic-payment.integration.spec.ts` runs only on the isolated local
`shards_test` database and checks concurrent admission, idempotent replay,
manual-review blocking, source isolation, late settlement and notification absence.

After deployment record the active manifest, exact persisted health/scenario run
IDs and final payment document evidence. Check original invoice state and source,
webhook acceptance/deduplication, real projection exclusion and delivery attempts
separately. Healthy monitoring, delivered Slack recovery and settled payment are
different claims. No charge or supplier fulfillment is required for connection
acceptance; any real payment/refund/fulfillment needs its own explicit scope.
