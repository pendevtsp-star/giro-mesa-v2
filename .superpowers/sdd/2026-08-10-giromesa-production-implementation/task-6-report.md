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

## Fix round 1

This section supersedes the original statements that confirmation always creates a session and that Task 5 client files were regenerated. The independent review found four load-bearing gaps; all four were reproduced or covered by a new failing test before the corrected behavior was accepted.

### RED

`rtk pnpm --filter @giromesa/site test` failed with `ERR_MODULE_NOT_FOUND` for `apps/site/lib/email-verification.ts`. The new browser-boundary test established that the client had no implementation capable of consuming a fragment token, removing it from browser-visible state, or proving that fetch URLs and referrers omit the bearer token. The GREEN suite includes a focused HTTP transport test that sends a document URL containing a fragment to a real loopback server and proves the received request URL and referrer contain no token.

### GREEN

- Verification messages now link to `/verificar-email#token=...`; no path or query contains the bearer token. The client consumes and removes the fragment immediately, also strips a legacy `token` query parameter without accepting it, uses `Referrer-Policy: no-referrer`, rejects non-HTTPS remote API endpoints, and sends the token only in the HTTPS API JSON body. No token is logged.
- E-mail confirmation now reuses `beginIdentitySession`. A verified MFA factor returns the typed in-memory challenge with no session and no cookie; the existing MFA state machine creates the session only after the second factor and retains attempt limits, one-time recovery codes and replay protection. Concurrent confirmation of a legacy identity yields one MFA challenge and one `already_verified` result.
- Resend is enumeration-safe for pending, verified, nonexistent and quota-exhausted addresses. Durable one-minute/five-hour/ten-day limits silently suppress delivery and create no outbox row. Every public 202 has the same `{ "accepted": true }`, `Retry-After: 60` and `Cache-Control: no-store`; the independent IP limiter uses the shared `auth` bucket and returns 429 with `Retry-After` regardless of the e-mail.
- Named OpenAPI schemas define the exact 202 response and the discriminated 200 union for `verified`, `mfa_required` and `already_verified`. TypeScript and C# clients were regenerated. Kiota now creates a discriminator-aware composed response, and neither generated request method returns `void` or `Stream`.
- The PostgreSQL integration applies migrations through `0012`, inserts a surviving identity, then applies `0013` before running the suite. Worker negative cases cover invalid context, expired events, tampered AAD and already-verified identities.

### Exact verification results

| Gate | Result |
| --- | --- |
| browser-boundary site suite | PASS; 14 tests, 14 pass, 0 fail |
| API suite without PG variables | PASS; 98 tests, 84 pass, 14 expected skips, 0 fail; OpenAPI/C# contract tests 2/2 |
| focused API integration on disposable PostgreSQL 16 | PASS; 5 tests, 5 pass, 0 fail; includes real `0012 -> 0013`, MFA concurrency/replay, HTTP cookie/header behavior, uniform resend history/quota/concurrency and independent IP 429 |
| focused worker integration on an isolated disposable database | PASS; 1 test, 1 pass, 0 fail; positive delivery plus all required negative events |
| `pnpm openapi:generate`, `pnpm clients:generate:ts`, `pnpm clients:generate:csharp` | PASS; no polymorphism warning; remaining Kiota warnings are pre-existing unsupported `email`/`uri` formats and pre-existing Task 5 sync error-shape warnings |
| C# Release build | PASS; 0 warnings, 0 errors |
| repository `pnpm typecheck` | PASS; 12 tasks, 12 successful |
| repository `pnpm build` | PASS; 8 tasks, 8 successful |
| focused Biome checks and `git diff --check` | PASS |
| Task 5 regression check | PASS; no changed sync path and no changed sync line in the generated TypeScript client |

The tests used only `giromesa-task6-fix1` on host port 55440 with separate API and worker databases; the `--rm` container was stopped and its absence verified after the gates. No real Resend request, persistent migration, push or deployment was performed.

## Fix round 2

The durable resend history no longer prevents the unique creation of a local identity from receiving its mandatory first verification. The initial issuance now runs inside the same registration transaction that inserted the identity. Only that private initial path may bypass pre-existing anonymous request history, it fails if a token already exists, and it always records the initial issuance before creating exactly one hash-only token and one encrypted outbox event. Ordinary resends and duplicate registrations have no bypass.

### RED

- `rtk pnpm --filter @giromesa/api test`: FAIL; 83 pass, 15 skip, 1 fail because the generated OpenAPI lacked the required `Cache-Control: no-store` response header schemas.
- Focused real PostgreSQL/HTTP suite against `giromesa-task6-fix2`: FAIL; 4 pass, 2 fail. A first registration after ten anonymous durable request records returned 429 instead of 201, and an auth-bucket 429 response omitted `Cache-Control: no-store`.
- After the first-send correction, the same focused suite exposed a second RED: 5 pass, 1 fail because Drizzle wrapped PostgreSQL `23505` in `cause`, so the required second registration returned 500 rather than the existing 409 conflict contract.

### GREEN

- The first real HTTP registration after ten anonymous requests returns 201/pending with `emailVerifiedAt = null`, exactly one verification token and exactly one verification outbox event. The request ledger contains eleven entries, proving the initial issuance still contributes to future limits.
- A duplicate registration returns 409. Subsequent real HTTP resends at the one-minute, five-per-hour and ten-per-day boundaries return the uniform 202 response and create no additional token or outbox event.
- Sensitive auth responses receive `Cache-Control: no-store` before the IP rate-limit hook can terminate a request. The `/v1` and `/public/v1` 429 aliases have the same body, `Retry-After` and `Cache-Control` headers.
- OpenAPI documents `Cache-Control: no-store` on all three aliases for both the 202 request response and the 200 confirmation response. TypeScript and C# clients were regenerated.

### Exact verification results

| Gate | Result |
| --- | --- |
| focused compiled API integration on disposable PostgreSQL 16 | PASS; 6 tests, 6 pass, 0 fail |
| API suite without PG variables | PASS; 99 tests, 84 pass, 15 expected skips, 0 fail |
| site browser-boundary suite | PASS; 14 tests, 14 pass, 0 fail |
| contracts suite | PASS; 4 tests, 4 pass, 0 fail |
| `pnpm openapi:generate`, `pnpm clients:generate:ts`, `pnpm clients:generate:csharp` | PASS; only the pre-existing Kiota format and Task 5 sync error-shape warnings remain |
| C# Release build | PASS; 0 warnings, 0 errors |
| repository typecheck | PASS; 12 tasks, 12 successful |
| focused Biome lint/format checks and `git diff --check` | PASS; the pre-existing mixed CRLF/LF formatter baseline in `app-factory.ts` was not bulk-rewritten |

The PostgreSQL gate used only the disposable `giromesa-task6-fix2` container on host port 55441. It was stopped with `--rm`, and absence was verified. No provider call, persistent migration, push or deployment was performed.
