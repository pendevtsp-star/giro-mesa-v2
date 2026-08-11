# Wave 2 privacy — Task 37 report

Date: 2026-08-11  
Branch: `codex/giromesa-wave2-privacy`  
Base: `c899c4805f999eda18b22cbb8f7d8ebe30603333`

## Outcome

Implemented a fail-closed, tenant-scoped privacy request lifecycle for access/export, correction, anonymization and deletion requests.

- Persistent states: `verification_pending`, `approval_pending`, `processing`, `partial`, `completed`, `rejected`, `failed`.
- Persistent per-domain steps with required-domain snapshot, attempts and safe reason codes.
- Idempotent create fingerprint, atomic approval/retry outbox and replay-safe worker attempts.
- Subject verification, approval/rejection/retry and export download require a session whose MFA was verified in the previous 10 minutes.
- PostgreSQL migration `0025_privacy_lifecycle.sql` adds storage, session step-up marker, RLS/FORCE RLS, narrow grants, transition/immutability trigger and a database guard that rejects `completed` while any mandatory processor is incomplete.
- Identity and organization-membership export processors produce an AES-256-GCM encrypted, 15-minute, one-time download package.
- Mutating requests perform preflight only while any mandatory adapter is missing. No correction, anonymization or deletion is partially applied.
- Worker failures persist `failed` with a redacted code and dead-letter the attempt; an owner with recent step-up can explicitly retry.
- Privacy HTTP responses are `Cache-Control: no-store`.
- Audit metadata is allowlisted and excludes payload, name, e-mail, credentials and export content.
- Platform/internal role receives no privacy-table content grant.
- The worker validates topic, aggregate, tenant and unit from the durable outbox envelope against the payload before opening any request state.
- Processing is serialized with a transaction-scoped advisory lock per organization/request, so concurrent deliveries converge to one effect and one replay.

The technical data inventory is in `docs/privacy/data-inventory.md`. It explicitly separates technical behavior from legal approval and records unresolved retention/base-legal decisions.

## API and generated clients

Routes exist under both `/api/v1/organizations/{organizationId}/privacy` and `/v1/organizations/{organizationId}/privacy`:

- create/list/get request;
- verify subject;
- approve, reject and retry;
- one-time export download.

OpenAPI now publishes explicit status, step and one-time export response schemas for every transition and both route aliases. TypeScript client types and both generated C# route trees were regenerated; the C# project builds with zero warnings/errors.

## TDD and gates

RED was first observed in `@giromesa/domain` for the missing privacy state/registry module. The following final gates passed:

- `rtk pnpm --filter @giromesa/domain test` — 36 passed.
- `rtk pnpm --filter @giromesa/api test` — 92 passed, 43 environment-gated skipped, 0 failed.
- `rtk pnpm --filter @giromesa/worker test` — 14 passed, 4 environment-gated skipped, 0 failed.
- `rtk pnpm --filter @giromesa/db test` — 3 passed, 2 environment-gated skipped, 0 failed.
- `rtk pnpm --filter @giromesa/contracts test` — 9 passed.
- PostgreSQL fresh migration on disposable `giromesa_privacy_task37` — all migrations through 0025 applied.
- Real PostgreSQL API lifecycle — step-up, create replay/conflict, approval replay/outbox uniqueness and RLS visibility passed.
- Real PostgreSQL worker lifecycle — FORCE RLS, cross-tenant denial, internal-role denial, encrypted TTL export, one-time download, replay, blocked mutation, failed state and database completed-guard passed.
- Real PostgreSQL worker hardening — forged tenant/aggregate envelopes fail before database access; two concurrent deliveries produce exactly one effect plus one replay.
- Real PostgreSQL API contract — lifecycle and generated response schemas passed on both route aliases.
- Real PostgreSQL upgrade — migrations through 0016 followed by 0025 preserved an existing session and installed all three FORCE-RLS tables.
- `rtk pnpm run typecheck` — 12/12 Turbo tasks passed.
- Focused Biome checks on every changed/new source file passed with formatter/assist disabled for pre-existing CRLF files; new privacy files pass the complete check. The repository-wide formatter gate remains red on pre-existing CRLF formatting outside this task.
- `rtk pnpm openapi:generate`, `rtk pnpm clients:generate:ts`, `rtk pnpm clients:generate:csharp` — passed.
- `.NET 10 build packages/api-client-csharp/GiroMesa.ApiClient.csproj` — succeeded, 0 warnings, 0 errors.
- `rtk git diff --check` — passed.

## Explicit partial/blocked coverage

The production registry currently implements only `identity` and `organization_membership` for export. The following mandatory domains remain `PROCESSOR_ABSENT` and therefore force `partial`, never fake `completed`:

- `operations`;
- `management_finance`;
- `growth_crm`;
- `objects_media`;
- `offline_edge`;
- `backups`.

`DoseClub` is outside this task and no adapter/provider behavior was simulated. No real storage, e-mail or external provider was configured or invoked.

## Follow-up concerns

- Legal owners must approve bases legais, retention periods, hard-delete exceptions and the human decision/SLA process before production policy is claimed.
- `PRIVACY_EXPORT_ENCRYPTION_KEY` must be supplied by a real secret manager and rotated under an approved runbook; no key material is committed.
- Each blocked domain needs a real, replay-safe adapter plus propagation/convergence evidence before mutating requests can execute or any request can reach `completed`.
- External export delivery remains intentionally absent; the only implemented delivery is authenticated, recent-step-up, one-time API download.
