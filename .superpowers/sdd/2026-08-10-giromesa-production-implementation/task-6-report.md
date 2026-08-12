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

## Fix round 3

Google can no longer turn an unverified local registration into a mixed-trust account. Registration and Google reconciliation now share an advisory lock keyed by the normalized e-mail. When a verified Google subject assumes an existing identity whose e-mail was still pending, one transaction deletes the untrusted password credential, revokes active e-mail-verification and password-reset tokens, revokes sessions, consumes MFA challenges, removes pending MFA factors, marks the identity verified, links Google and records `auth.google_pending_identity_recovered`. Only after that transaction commits may Google create a session. A local identity that had already verified its e-mail keeps its password credential.

The in-memory IP limiter now has independent, alias-stable buckets for registration, login, e-mail verification request/confirmation, password-reset request/confirmation, MFA challenge and MFA management. Exhausting ten verification-request attempts no longer rejects the first registration from the same IP and application instance. All `/api/v1`, `/v1` and `/public/v1` verification aliases retain the same 429 body, `Retry-After` and `Cache-Control: no-store` response.

Registration still has one PostgreSQL transaction and now serializes the normalized e-mail before insert. Duplicate e-mail conflicts map to 409 only when the nested PostgreSQL error is `23505` for the exact `identities_email_unique` constraint. Cause traversal is cycle-safe and bounded to eight links; `constraint` and the postgres.js `constraint_name` representation are accepted. Every other unique violation propagates as an internal failure so that it cannot be mistaken for an existing identity.

### RED

- The endpoint-class unit test received `{ bucket: "auth", max: 10 }` instead of the independent `auth:email-verification-request` bucket.
- A real Fastify application returned 429 for the first registration after ten verification requests from the same IP.
- A temporary PostgreSQL trigger raised `23505` with `task6_forced_non_identity_unique`; the broad mapper incorrectly returned 409.
- A pending local identity linked to verified Google retained one attacker-controlled `password_credentials` row.

### GREEN and regression evidence

| Gate | Exact result |
| --- | --- |
| focused rate-limit unit suite | PASS; 3 tests, 3 pass, 0 fail |
| complete API suite without PG variables | PASS; 103 tests, 85 pass, 18 expected skips, 0 fail |
| complete e-mail verification integration on PostgreSQL 16 | PASS; 9 tests, 9 pass, 0 fail |
| complete e-mail verification integration on PostgreSQL 17 | PASS; 9 tests, 9 pass, 0 fail |
| final focused Google recovery/audit on PostgreSQL 16 and 17 | PASS; 1 test on each version, 0 fail |
| Google auth integration on migrated PostgreSQL 16 and 17 | PASS; 1 test on each version, 0 fail; pending password removed and verified-local password preserved |
| site browser-boundary suite | PASS; 14 tests, 14 pass, 0 fail |
| contracts suite | PASS; 4 tests, 4 pass, 0 fail |
| repository typecheck | PASS; 12 tasks, 12 successful |
| repository build | PASS; 8 tasks, 8 successful |
| focused API Biome check and `git diff --check` | PASS |

The PostgreSQL checks used only `giromesa-task6-fix3-pg16` on port 55442 and `giromesa-task6-fix3-pg17` on port 55443. Both containers used `--rm`, were stopped, and their absence was verified. The rollback test used a temporary database trigger only inside its unique disposable test database; no production seam or schema change was introduced. No provider call, push, deployment or persistent migration was performed.

## Fix round 4

Every human-identity trust mutation now shares one namespaced PostgreSQL transaction advisory lock, `auth-trust:identity:<identityId>`, through `acquireIdentityTrustLock`. The documented global order is provider subject/e-mail lock, identity trust lock, identity revalidation, then credential/token/factor/challenge/session rows. No identity-first flow subsequently acquires an e-mail lock, and no bare UUID advisory lock remains in the auth service.

The boundary covers local registration, password login and final session issuance, Google link/recovery, e-mail verification and resend, MFA challenge/setup/confirmation/disable, password-reset request/confirmation and logout revocation. Password login compares the still-current Argon2 credential after acquiring the identity lock. MFA verification re-reads a verified, active identity, factor and challenge after that lock. Password reset now uses the same identity serialization and a password-before-reset row order, so it cannot deadlock with Google recovery or restore a credential after the recovery sweep.

Pending Google recovery now verifies the identity, removes the untrusted password/factor, revokes or consumes every active verification/reset/challenge credential, sweeps sessions, links Google and creates the legitimate Google session in the same transaction while the identity lock is still held. Already-verified identities preserve their password and MFA.

### RED

The first focused PostgreSQL 16 run completed 9 tests and failed the three new deterministic concurrency cases. Each failed after the explicit 15-second bound while waiting for a second `pg_stat_activity` advisory waiter: concurrent MFA, password-reset confirmation and stale password login were not waiting behind the Google recovery identity boundary. This failure was captured before production code changed.

### Deterministic concurrency coverage

- Temporary test-only triggers pause Google recovery after its session sweep on a separately held advisory gate. Tests observe one recovery wait, then two advisory waits after starting the competing operation before releasing the gate.
- Concurrent MFA cannot consume a recovery code or create an attacker session; final active state has no password, factor, challenge, verification token or reset token, and only the legitimate Google session remains.
- Concurrent reset and recovery both finish within the explicit bound without deadlock; the attacker password is never valid.
- A deliberately expensive real Argon2 credential lets `pg_stat_activity` prove the password read has completed. Recovery then changes the trust state and wins the identity lock; the already-started login waits and cannot create a stale session.
- Register versus Google has bounded, semantic outcomes only: Google succeeds; local registration either succeeds before recovery or returns the exact identity conflict; final state is one verified identity, one Google link, no password or active verification token and one active session.

### Final gates

| Gate | Exact result |
| --- | --- |
| complete e-mail/auth integration on disposable PostgreSQL 16 | PASS; 12 tests, 12 pass, 0 fail |
| complete e-mail/auth integration on disposable PostgreSQL 17 | PASS; 12 tests, 12 pass, 0 fail |
| complete API suite with PostgreSQL 16 e-mail and Google integration enabled | PASS; 106 tests, 98 pass, 8 expected skips, 0 fail |
| complete API suite without PostgreSQL variables | PASS; 106 tests, 85 pass, 21 expected skips, 0 fail |
| Google auth integration on migrated PostgreSQL 16 and 17 | PASS; 1 test on each version, 0 fail |
| repository typecheck | PASS; 12 tasks, 12 successful |
| repository build | PASS; 8 tasks, 8 successful |
| focused API Biome check and `git diff --check` | PASS |

The PostgreSQL gates used only `giromesa-task6-fix4-pg16` on port 55444 and `giromesa-task6-fix4-pg17` on port 55445. Both containers used `--rm`, were stopped, and their absence was verified. The concurrency controls are database triggers and advisory locks created only inside each disposable test database; no production pause seam was added. The existing least-privilege grants were preserved: verification/reset/challenge credentials are made unusable by revocation/consumption rather than expanding the identity role solely to erase history. No provider call, push, deployment or persistent migration was performed.
