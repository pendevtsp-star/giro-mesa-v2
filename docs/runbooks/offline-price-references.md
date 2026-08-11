# Offline price-reference lifecycle

Cloud issues price references as part of an operational snapshot. Edge never issues, extends, or rewrites them. Signed material binds the tenant, unit, entity, catalog price revision, integer price, key version, `issuedAt`, and `expiresAt`.

- Offline commands may be at most 30 days old.
- A price reference is valid for 35 days from its server-issued `issuedAt`: the 30-day command window plus 5 days of delivery grace.
- The command `occurredAt` must be within the signed validity interval, and Cloud must receive the reference before `expiresAt`.
- All timestamps are UTC. `occurredAt` may be up to five minutes before the server-issued `issuedAt` to tolerate a bounded Edge clock lag. This tolerance never moves `expiresAt`, never permits a future server-issued token, and does not relax the normal 30-day command-age check.
- Signing keys must remain in the verification keyring for at least 40 days after their last issuance (35-day validity plus 5-day operational rotation/delivery overlap). Removing a key earlier makes still-valid offline orders unverifiable.

After expiry, Cloud rejects the create-order command with `PRICE_REFERENCE_EXPIRED`. Edge persists and surfaces that reconciliation outcome, does not retry the rejected row, and never substitutes the current catalog price. An operator must refresh the Cloud snapshot and re-enter the order under the current price reference.

## Envelope sizing trade-off

The 64 KiB command payload permits the valid 16-item × 100-modifier case (1,616 distinct price references). The shared envelope contract therefore allows a 1,750,000-byte event, a 2,000,000-byte sync batch, and a 2,100,000-byte HTTP parser body. Edge still reads at most 100 pending rows, splits batches by serialized size, and bisects schema-rejected batches so one event cannot poison siblings. The higher bounds trade a bounded ~2.1 MB peak request allocation and network transfer for complete support of every currently valid single order; they do not permit unbounded payloads or batches.
