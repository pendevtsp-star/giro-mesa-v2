# Task 6 report - verified identity activation

## Scope delivered

- Local password registration is pending until the e-mail address is verified; it creates no authenticated session or cookie.
- Google identities remain immediately verified only after the existing OAuth boundary validates `email_verified=true`, nonce, state and PKCE.
- Verification links use 256-bit opaque tokens, store SHA-256 hashes only, expire after 24 hours, rotate on resend and are single-use under concurrent requests.
- Verification requests are enumeration-safe and durably rate-limited by a hash of the normalized e-mail: one/minute, five/hour and ten/24 hours. PostgreSQL advisory locks serialize concurrent requests for the same address.
- Verification revokes every pre-existing session before issuing exactly one new session. `authenticate()` also rejects any legacy session whose identity is not verified.
- The API, public site, Resend worker, OpenAPI, TypeScript client, C# client, database schema/migration/meta and operational runbook were updated together.
- The new global identity tables are fail-closed: only `giromesa_identity` has the minimum grants; application, worker, public, internal and legacy roles have no access.

## RED captured before implementation

Command:

```text
rtk pnpm --filter @giromesa/api test
```

Result: failed at TypeScript compilation with `TS2305` for missing exports `emailVerificationRequests` and `emailVerificationTokens`, and `TS2339` for missing `AuthService.requestEmailVerification` and `AuthService.verifyEmail`. This established the missing schema and service contract before production code was added.

## Main changes

- `packages/db/src/schema.ts` and migration `0013_email_verification.sql`: verification token/request tables, indexes, grants and the identity outbox topic policy.
- `apps/api/src/auth/auth.service.ts`: pending registration, login/session verification gate, rate limiting, rotation, atomic single use, Google reconciliation, encrypted outbox event and audit trail.
- `apps/api/src/auth/auth.controller.ts`: enumeration-safe request endpoint and confirmation endpoint; only a successful first confirmation sets the HttpOnly session cookie.
- `apps/api/src/auth/email-verification.integration.test.ts`: migrations from zero in a unique disposable database; hash-only persistence, no pre-verification session, old-session rejection, concurrency, single-use, expiry, enumeration safety, rate limits and role privileges.
- `apps/worker/src/outbox.ts`: Resend HTML/text delivery with event-specific AES-GCM AAD and stable idempotency key; skips identities already verified.
- `apps/site/app/verificar-email/page.tsx`: pending, checking, invalid/expired, already verified and success states plus resend, safe navigation and immediate removal of the opaque token from the address bar/referrer source.
- `docs/runbooks/email-verification.md`: configuration, secret handling, incident response and resend operation.

## Verification evidence

All PostgreSQL commands used only the disposable Docker container `giromesa-task6-pg` (PostgreSQL 16, host port 55439) and unique test databases. No persistent local database or real provider credential was used.
The container was started with `--rm` and stopped after the gates, so no Task 6 PostgreSQL container remains.

| Command | Exact result |
| --- | --- |
| `rtk pnpm db:migrate` with disposable owner URL | PASS; migrations `0000` through `0013` applied from an empty database |
| focused compiled API PG integration (`node --test apps/api/dist/auth/email-verification.integration.test.js`) | PASS; 3 tests, 3 pass, 0 fail |
| full API suite with `EMAIL_VERIFICATION_DATABASE_URL` | PASS; 94 tests, 85 pass, 9 skip, 0 fail |
| focused compiled worker Resend integration (`node --test apps/worker/dist/email.integration.test.js`) | PASS; 1 test, 1 pass, 0 fail; reset and verification delivery/idempotency exercised |
| `rtk pnpm --filter @giromesa/worker test` without PG URL | PASS; 17 tests, 14 pass, 3 expected skips, 0 fail |
| `rtk pnpm --filter @giromesa/db test` | PASS; 2 tests, 1 pass, 1 expected skip, 0 fail |
| `rtk pnpm --filter @giromesa/contracts test` | PASS; 4 tests, 4 pass, 0 fail |
| `rtk pnpm openapi:generate` | PASS |
| `rtk pnpm clients:generate:ts` | PASS |
| `rtk pnpm clients:generate:csharp` | PASS; Kiota warnings only |
| `rtk C:\\Users\\maxue\\.dotnet\\dotnet.exe build packages/api-client-csharp/GiroMesa.ApiClient.csproj -c Release --nologo` | PASS; 0 warnings, 0 errors |
| focused Biome checks for all changed API/worker/site/contracts/db source files | PASS; no fixes required |
| `rtk powershell -NoProfile -Command "pnpm typecheck; exit $LASTEXITCODE"` | PASS; 12 tasks, 12 successful |
| `rtk powershell -NoProfile -Command "pnpm build; exit $LASTEXITCODE"` | PASS; 8 tasks, 8 successful; `/verificar-email` prerendered |

The repository-wide API lint command is not a valid green baseline in this Windows checkout: it reports 72 formatter errors caused by pre-existing CRLF/LF differences across unrelated API files. Every Task 6 source file was checked explicitly with the package's Biome configuration and passed.

## Proportional-regression concern

Running every worker PG integration against one shared database, first in parallel and then sequentially, is not isolated: worker instances claim each other's generic outbox rows. The Task 6 email integration passed, while the pre-existing inventory integration later observed its fixture with `processedAt` still null. The normal worker suite is green and the focused real-PG Resend gate is green; the inventory harness should receive a separate database or topic-scoped worker in its own task. No production behavior was relaxed to make that unrelated fixture pass.

Regenerating the C# client also materialized the current Task 5 sync schemas already present in the canonical OpenAPI. These generated files are retained so the checked-in client is coherent with that OpenAPI; the complete generated client compiles with zero warnings and zero errors.

## External validation deliberately not performed

- No real Resend message was sent and no production DNS/provider secret was used.
- No browser E2E against a deployed API was run. The production Next.js build and static route generation passed.
- No push, deployment, migration of a persistent environment or provider mutation was performed.

## Security decisions

Ambiguity was resolved fail-closed: local registration returns 503 unless both the provider flag and a valid outbox encryption key are configured; unverified identities cannot log in or authenticate with old sessions; invalid, expired, revoked and replayed tokens share the same rejection; plaintext verification tokens are never persisted.
