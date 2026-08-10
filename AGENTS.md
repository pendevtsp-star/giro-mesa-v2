# GiroMesa V2 agent guide

## Boundaries

- This repository is the clean V2. Do not edit `../giro_mesa`.
- Keep one operational truth for salon, counter, QR and delivery.
- Resolve organization and unit scope on the backend; never trust tenant identifiers from user input without membership validation.
- State transitions, approvals, billing access and audit rules are backend-owned.
- Do not claim external integrations are ready without provider credentials and homologation evidence.
- Preserve accessibility, input validation, idempotency and financial/fiscal auditability.

## Workflow

- Prefix every shell command with `rtk`.
- Use `pnpm` and Turborepo for TypeScript workspaces.
- Use `apply_patch` for hand-authored file changes.
- Keep agents in non-overlapping directories and do not edit the root lockfile concurrently.
- Run the narrowest relevant check before handing work back.
