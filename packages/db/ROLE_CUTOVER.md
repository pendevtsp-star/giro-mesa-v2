# PostgreSQL runtime role cutover

The login roles are provisioned outside the application migrations so their passwords remain in
the platform secret store. They must be `NOINHERIT`, `NOSUPERUSER`, and `NOBYPASSRLS`.

## Role matrix

| Group role | Login | Scope |
| --- | --- | --- |
| `giromesa_app` | no | Tenant DML under transaction-local organization/unit context; outbox is insert-only. |
| `giromesa_identity` | no | Authentication tables, actor-scoped membership discovery, and new-organization bootstrap. |
| `giromesa_public` | no | Published commercial catalog, lead forms, approved global outbox topics, and public-menu scope resolution. |
| `giromesa_internal` | no | Authorizes an internal-key request; tenant DML still runs as `giromesa_app` with the route organization. |
| `giromesa_worker` | no | Outbox claim/ack and maintenance candidate discovery; tenant work returns to `giromesa_app`. |
| `giromesa_legacy_transition` | no | Temporary N/N-1 policy only. It has no members by default and is removed after the cutover gate. |
| `giromesa_migrator` | no | Migration/function owner. `BYPASSRLS`; never granted to a runtime login. |

No default table or sequence privileges are granted. A new table is inaccessible to every runtime
role until a migration explicitly grants privileges and installs its policy.

## Provisioning

Run as the database administrator, replacing the two login names and supplying passwords through
the provider secret mechanism (not in SQL history):

```sql
create role giromesa_api_runtime login noinherit nosuperuser nocreatedb nocreaterole
  noreplication nobypassrls password '<from-secret-store>';
grant giromesa_app, giromesa_identity, giromesa_public, giromesa_internal
  to giromesa_api_runtime;

create role giromesa_worker_runtime login noinherit nosuperuser nocreatedb nocreaterole
  noreplication nobypassrls password '<from-secret-store>';
grant giromesa_app, giromesa_worker to giromesa_worker_runtime;
```

The API and worker use separate database URLs. The API may not be a member of `giromesa_worker`;
the worker may not be a member of identity/public/internal roles.

## N/N-1 deployment sequence

1. Quiesce the old API/worker so no transaction straddles the policy installation.
2. Apply migration `0009` with the administrator/migrator connection.
3. If release N-1 must be resumed temporarily, deliberately grant
   `giromesa_legacy_transition` to its exact login before resuming it. Arbitrary roles remain
   fail-closed. Record the grant as a time-bounded operational exception.
4. Deploy release N with the API/worker logins above. Tenant HTTP routes, internal routes, public
   catalog/slug routes, identity routes, and jobs all select an explicit transaction-local role.
5. Pass the A -> B -> A reused-connection test, real Nest HTTP test, and real outbox-worker test.
6. Revoke the transition membership and restart/drain the old release:

```sql
revoke giromesa_legacy_transition from <exact_n_minus_1_login>;
```

7. Verify `pg_auth_members` has no members for `giromesa_legacy_transition`. Do not drop the group
   in the same release; retaining the empty `NOLOGIN` role keeps rollback of policy metadata
   predictable without granting access.

The migration deliberately does not auto-enrol an existing login. A deploy that cannot quiesce and
perform the explicit grant in this order must not apply the RLS migration.
