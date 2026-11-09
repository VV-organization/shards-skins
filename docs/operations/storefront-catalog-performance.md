# Storefront catalog loading

The root layout and home page share a request-scoped React `cache(getCatalog)`.
They fetch `GET /catalog/preview?limit=60` and the presentation lookup in parallel.
The preview returns only `{ items }`; `/catalog` retains filters, facets, counts,
pagination and price sorting for the interactive catalog.

Preview selects public CS2 products in the same popularity/created-at/id order
as the default catalog. Selection is limited before supplier and pricing joins.
The supplier join is unique on supplier/game/market_hash_name. Price and stock
are evaluated on every request, using the same DTO and availability rules as
the full catalog. No persistent response cache or monitoring exception is used.

## Incident and diagnosis, 2026-11-09

VV Admin aborted two frontend requests after 5,002 ms. Nginx recorded both as
499. A later request returned 200 after 4,548 ms. The previous root layout loaded
the full catalog endpoint, including unused whole-catalog facets and counts.
Live tracing measured 1.5 seconds for facets alone; the card query enriched
26,542 rows before taking 60. A read-only bounded-selection experiment returned
the same 60 IDs in 126 ms. These measurements establish the expensive request
path; they do not establish continuous downtime between six-hour checks.

## Regression verification

- Unit test: one bounded card query, no full-catalog facets/counts, capped limit.
- PostgreSQL/HTTP test: exact equality with default catalog items, ordering,
  hidden-product exclusion, live supplier repricing and stock changes.
- Existing catalog, invoice projection, quote/cart and browser suites cover
  callers of the shared product loader.
- After deployment, compare preview with full-catalog items and measure home
  responses from the VV Admin worker network with its original five-second limit.
