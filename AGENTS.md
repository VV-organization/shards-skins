# Shards commerce

- Preserve the designer frontend composition, typography, colors, assets, animation and responsive behavior. Approved changes: remove skin float, real authentication, wallet-only skin checkout, direct Steam payment and honest operation states.
- Follow docs/superpowers/specs/2026-10-11-shards-commerce-design.md and the corresponding implementation plan. User authorized implementation on 2026-10-11.
- Skin purchases use internal Shards only. Direct Steam refill never changes the Shards wallet. Rate: 1 RUB = 1.6 Shards, integer minor units.
- Read adjacent repositories only. Never copy secrets, .env files, production data, Git metadata or deployment configuration.
- Real provider payments, fulfillment, production changes and deployment require separate authorization. New money-moving features default disabled.
- Node 24. Run relevant unit/integration tests, typecheck, lint, build and API contract checks. Destructive DB tests use SHARDS_TEST_DATABASE_URL and only isolated local shards_test owned by shards_test.
- frontend/AGENTS.md applies to visual and Next.js work. Current user-approved commerce spec supersedes historical prototype instructions.
