# Shardsmarket connection to VV Admin

User requested research, implementation, deployment and full verification on
2026-11-07. Work stays in existing checkouts. No storefront redesign, real charge,
refill or supplier purchase is part of acceptance.

## Research and design

Production Shardsmarket was absent from VV Admin. Its existing manifest used
shards.example defaults; integration runtime credentials were absent. Fourteen
pending customer top-up events already exist in the durable site outbox.
The existing synthetic endpoint inferred success from a constructed payment URL
and fabricated local expiry; it must be corrected before activation.

Use the existing manifest, health-check, commerce-webhook and worker synthetic
contracts. Register the site through authenticated audited APIs, configure its
own credentials in protected runtime configuration and VV Admin encrypted env,
and preserve original event IDs/history. No new site-specific admin connector
or direct database projection writes. Supplier catalog editing and generic
recovery actions have no existing interoperable endpoint and are not advertised.

## Implementation and acceptance

1. Correct public/API origin defaults and manifest; disable incompatible legacy
   browser scenarios, use worker execution for the hosted-payment scenario.
2. Validate signed public paths and timestamp freshness. Return a native hosted
   form handoff; only the VV browser worker may confirm a loaded provider page.
   Retain pending invoices/reconciliation, bound concurrent synthetic attempts,
   and label all synthetic events so customer projections remain clean.
3. Extend the existing VV hosted-form verifier to the exact Paidlayer origin
   used by Shards. Keep same-origin return URLs and navigation restrictions.
4. Run unit, isolated PostgreSQL integration, type/lint/build/API checks and
   controlled browser fixtures. Independently review changes before release.
5. Provision inactive site and secrets without logging plaintext; deploy both
   repositories, refresh/validate manifest, activate only intended checks.
6. Verify every health check, delivery/projection of existing real events,
   signed duplicate rejection and synthetic isolation, one real browser path to
   payment without charge, runtime stability and audit evidence.

Report separately code/tests, deployment, successful operational checks, payment
page reachability, event projection and notification delivery. Missing evidence
must remain explicit rather than reported as successful.
