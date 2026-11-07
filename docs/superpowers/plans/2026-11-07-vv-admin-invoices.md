# Shardsmarket invoice connection

User requested Shardsmarket in VV Admin invoices on 2026-11-07. Work remains in
the current checkout; no storefront, money-moving or catalog editing behavior is
changed. Existing dedicated integration credentials are reused.

## Research and implementation

- Public catalog is CS2 skins only, native COINS displayed as Shards. Its approved
  rate is 1 RUB = 1.6 Shards; invoice protocol retains exact native amountMinor.
- Add signed read-only products/offers and explicit catalog resource schemas.
  Set managementEnabled=false; no mutation capability or routes.
- Add a bounded ID-keyset publication branch that reuses the current SQL price,
  half-up rounding and dynamic supplier availability. Existing storefront paths
  retain their filters, ordering and detail access to formerly public SKUs.
- Register the capability in the existing manifest/module and regenerate API
  contracts. No DB migration or new runtime credential is needed.
- GitNexus query and impact were attempted, but Shardsmarket is not indexed.
  Manual callers of CatalogService.loadProducts: list/getBySlug/lookup/duoOptions,
  used by catalog, cart and duo. Changes are confined to the new publication
  branch; IntegrationService.manifest is read by IntegrationController.manifest.

## Acceptance

1. HTTP tests: all pages, exact price scale, image/public URLs, missing/stale/
   tampered/wrong-site signatures, invalid cursors/limits, absent writes.
2. Isolated shards_test DB: read-only application connection; full pagination;
   hidden/non-CS2/formerly-public exclusion; live price and pricing-version
   changes; Shards half-up rounding; freshness/quantity/category availability;
   stable continuation when an earlier row is inserted. Run existing DB suites
   to protect storefront, cart, quotes and checkout behavior.
3. Run npm run verify (backend tests/types/lint/build/OpenAPI; frontend generated
   types/visual source/tests/types/lint/build) and independent manifest validation
   through VV Admin's current parser.
4. After review, deploy through existing main workflow, refresh the manifest,
   configure the Shards invoice profile and verify full public signed pagination,
   unchanged financial entity counts, browser draft creation and test PDF.

Deployment, runtime configuration and browser acceptance are recorded separately
from local implementation/tests. No historical invoice recovery is in scope.
