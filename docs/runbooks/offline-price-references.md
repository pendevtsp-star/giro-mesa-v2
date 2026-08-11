# Offline price-reference lifecycle

Cloud issues price references as part of an operational snapshot. Edge never issues, extends, or rewrites them. Signed material binds the tenant, unit, entity, catalog price revision, integer price, key version, `issuedAt`, and `expiresAt`.

- Offline commands may be at most 30 days old.
- A price reference is valid for 35 days from its server-issued `issuedAt`: the 30-day command window plus 5 days of delivery grace.
- The command `occurredAt` must be within the signed validity interval, and Cloud must receive the reference before `expiresAt`.
- Signing keys must remain in the verification keyring for at least 40 days after their last issuance (35-day validity plus 5-day operational rotation/delivery overlap). Removing a key earlier makes still-valid offline orders unverifiable.

After expiry, Cloud rejects the create-order command with `PRICE_REFERENCE_EXPIRED`. Edge persists and surfaces that reconciliation outcome, does not retry the rejected row, and never substitutes the current catalog price. An operator must refresh the Cloud snapshot and re-enter the order under the current price reference.
