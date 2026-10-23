# Payment lifecycle Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Execution stays in the supplied checkout.

**Goal:** Independent new payments, verified continuation of existing payments, and bounded unpaid waiting.

**Architecture:** Extend the current reconciliation service with an optional payment ID and reuse its verified settlement path. Add ownership/CSRF protected check endpoints and one frontend action shared by history and return page.

**Tech Stack:** Node 24, NestJS, PostgreSQL, Next.js, React, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-23-payment-lifecycle-design.md`

## Global Constraints

- Preserve designer composition, typography, colors and responsive behavior.
- 1 RUB = 1.6 Shards; Steam never credits wallet.
- No production changes, real payments, push or deployment.
- Destructive integration tests only through SHARDS_TEST_DATABASE_URL to local shards_test owned by shards_test.

## Review Focus

- A stale/failed status check must never open an old checkout URL.
- A callback racing a user/background check must never reverse paid or duplicate settlement.
- Guest refresh after reload must acquire CSRF without creating a new guest owner.
- Local expiry and provider transport errors must not discard late success.
- Repeated same-amount new payments need fresh quotes and keys, while unknown requests retain theirs.

## Task 1: Backend payment lifecycle

Files: payment service, quote/history DTO/services/controllers, guest service/controller, Arco client, migration 0040, integration health, Arco/guest integration tests.

Interfaces: POST `/payments/sessions/:id/check` and guest `/payments/guest/steam-refill/sessions/:id/check` return the session schema plus `expiresAt`, `failureReason`, `canPay`. GET guest context restores existing CSRF only. `reconcilePendingTopUps({limit?,paymentId?})` targets one payment when requested.

- [x] Add integration tests for fresh verification, expiry, permission boundaries, failures, late settlement and independent creation; observe RED.
- [x] Persist lifetime, expose actionable status, implement targeted checks and overdue review/recovery; observe GREEN.
- [x] Run relevant integration tests and backend unit/typecheck/lint/build/OpenAPI checks.

## Task 2: Frontend new/continue flows

Files: topups, payment-status, account-view, guest-payment, shared payment-action, commerce-status, generated API, frontend unit and E2E tests.

- [x] Replace the E2E expectation that a new form reopens the old payment; add history/return verification scenarios and guest CSRF reload; observe RED.
- [x] Remove lastSession takeover, keep unknown-command journal, add shared verified pay action and honest expiry labels; poll unfinished history from DB.
- [x] Run frontend unit, E2E desktop/mobile, typecheck, lint, build, API and visual-source checks.

## Task 3: Review and acceptance

- [x] Run full repository verification and local integration suite.
- [x] Fresh independent review of the uncommitted diff; fix substantive findings with tests.
- [x] Record results here and report local completion and deployment boundary.

## Execution evidence

Implementation authorized by the user's follow-up to the research. No additional design approval is required. Changes remain uncommitted for review.

- Backend lifecycle regression tests were observed failing before implementation, then passing. Full local integration suite: 161 passed, 1 external SIH sandbox test skipped. Database identity and owner were verified as local `shards_test`; migration 0040 was exercised there.
- Final `npm run verify`: passed, including 224 backend unit tests, 47 frontend tests, lint/typecheck/build, OpenAPI and generated API checks, and 79 original designer assets/fonts/animation sources.
- Final full Playwright suite: 40 passed, including new-payment independence, exact unknown-command recovery, checked continuation, guest CSRF restoration, retained-form quote refresh, payment identity changes and uninterrupted checks during history/return polling. Provider requests were intercepted by fixtures; no real payment was created.
- Independent read-only review found consumed-quote reuse on a retained form and stale busy state after payment identity changes. Both received failing browser regressions and fixes. Additional regressions reproduced automatic polling aborting an in-flight checkout verification on the return page and in history; revalidation now retains data only within the same path/owner scope.
- Desktop 1440px and mobile 390px history screenshots were inspected for pending, expired and failed-check states; no horizontal overflow. Existing composition and assets are preserved.
- No production mutations, real provider payments, commit, push or deployment were performed.

## Release authorization

After local acceptance, the user explicitly requested commit, push and deployment monitoring on 2026-10-23. Release proceeds through the existing main-branch CI/deploy workflows, followed by migration, runtime health and public endpoint verification. Real payment creation is outside release verification.
