import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import {
  createDatabase,
  privacyExports,
  privacyRequestSteps,
  privacyRequests,
  withDatabaseRoleContext,
  withTenantContext,
  withWorkerContext,
} from "@giromesa/db";
import { decryptSecret, encryptionKey, PRIVACY_REQUIRED_DOMAINS } from "@giromesa/domain";
import { and, eq, isNull } from "drizzle-orm";
import { failPrivacyRequest, processPrivacyRequest } from "./privacy.js";

const integrationUrl = process.env.TENANT_ISOLATION_DATABASE_URL;
const database = integrationUrl ? createDatabase(integrationUrl, { max: 4 }) : undefined;

after(async () => {
  await database?.client.end();
});

describe("privacy lifecycle on real PostgreSQL", () => {
  it("enforces RLS, partial domains, encrypted one-time export and replay", async (context) => {
    if (!database) {
      context.skip("TENANT_ISOLATION_DATABASE_URL not configured");
      return;
    }
    const suffix = randomUUID().replaceAll("-", "");
    const organizationA = randomUUID();
    const organizationB = randomUUID();
    const identityA = randomUUID();
    const identityB = randomUUID();
    const requestA = randomUUID();
    const requestB = randomUUID();
    const correctionRequest = randomUUID();
    const failedRequest = randomUUID();
    const encryptionSecret = randomBytes(32).toString("base64");
    process.env.PRIVACY_EXPORT_ENCRYPTION_KEY = encryptionSecret;
    const processingEvent = (organizationId: string, requestId: string, attempt = 1) => ({
      topic: "privacy.request.processing",
      aggregate_type: "privacy_request",
      aggregate_id: requestId,
      organization_id: organizationId,
      unit_id: null,
      payload: { organizationId, requestId, attempt },
    });

    await database.client`
      insert into organizations (id, legal_name, trade_name, document)
      values
        (${organizationA}, 'Privacy A Ltda', 'Privacy A', ${suffix.slice(0, 14)}),
        (${organizationB}, 'Privacy B Ltda', 'Privacy B', ${suffix.slice(14, 28)})
    `;
    await database.client`
      insert into identities (id, email, display_name, email_verified_at)
      values
        (${identityA}, ${`privacy-a-${suffix}@example.test`}, 'Privacy Subject A', now()),
        (${identityB}, ${`privacy-b-${suffix}@example.test`}, 'Privacy Subject B', now())
    `;
    await database.client`
      insert into memberships (id, identity_id, organization_id, status)
      values
        (${randomUUID()}, ${identityA}, ${organizationA}, 'active'),
        (${randomUUID()}, ${identityB}, ${organizationB}, 'active')
      returning id
    `.then(async (memberships) => {
      await database.client`
        insert into role_bindings (membership_id, role)
        values (${memberships[0]?.id}, 'owner'), (${memberships[1]?.id}, 'owner')
      `;
    });

    const seedRequest = async (organizationId: string, identityId: string, requestId: string) =>
      withTenantContext(
        database,
        { source: "http", organizationId, actorIdentityId: identityId },
        async (tx) => {
          await tx.insert(privacyRequests).values({
            id: requestId,
            organizationId,
            subjectIdentityId: identityId,
            requesterIdentityId: identityId,
            type: "access_export",
            state: "processing",
            idempotencyKey: `privacy-${requestId}`,
            requestFingerprint: "a".repeat(64),
            requiredDomains: [...PRIVACY_REQUIRED_DOMAINS],
            attempts: 1,
          });
          await tx.insert(privacyRequestSteps).values(
            PRIVACY_REQUIRED_DOMAINS.map((domain) => ({
              organizationId,
              requestId,
              domain,
              status: ["identity", "organization_membership"].includes(domain)
                ? ("pending" as const)
                : ("blocked" as const),
              reasonCode: ["identity", "organization_membership"].includes(domain)
                ? undefined
                : "PROCESSOR_ABSENT",
            })),
          );
        },
      );
    await seedRequest(organizationA, identityA, requestA);
    await seedRequest(organizationB, identityB, requestB);

    const visibleFromA = await withTenantContext(
      database,
      { source: "http", organizationId: organizationA, actorIdentityId: identityA },
      (tx) => tx.select({ id: privacyRequests.id }).from(privacyRequests),
    );
    assert.deepEqual(visibleFromA, [{ id: requestA }]);
    await assert.rejects(
      () =>
        withDatabaseRoleContext(database, "internal", identityA, (tx) =>
          tx.select({ id: privacyRequests.id }).from(privacyRequests),
        ),
      (error: unknown) => {
        const candidate = error as { cause?: { message?: string } };
        return candidate.cause?.message?.includes("permission denied") === true;
      },
    );

    const event = processingEvent(organizationA, requestA);
    const processed = await withWorkerContext(database, (tx) =>
      processPrivacyRequest(tx as never, event),
    );
    assert.deepEqual(processed, { replayed: false, state: "partial" });
    const replayed = await withWorkerContext(database, (tx) =>
      processPrivacyRequest(tx as never, event),
    );
    assert.deepEqual(replayed, { replayed: true });

    await assert.rejects(
      () =>
        withWorkerContext(database, (tx) =>
          processPrivacyRequest(tx as never, {
            ...processingEvent(organizationB, requestB),
            organization_id: organizationA,
          }),
        ),
      (error: unknown) =>
        error instanceof Error && error.message === "PRIVACY_EVENT_CONTEXT_INVALID",
    );
    const concurrentResults = await Promise.all([
      withWorkerContext(database, (tx) =>
        processPrivacyRequest(tx as never, processingEvent(organizationB, requestB)),
      ),
      withWorkerContext(database, (tx) =>
        processPrivacyRequest(tx as never, processingEvent(organizationB, requestB)),
      ),
    ]);
    assert.equal(
      concurrentResults.filter((result) => result.replayed === false).length,
      1,
    );
    assert.equal(
      concurrentResults.filter((result) => result.replayed === true).length,
      1,
    );
    const [requestBAudit] = await database.client<{ count: number }[]>`
      select count(*)::int as count from audit_events
      where organization_id = ${organizationB}
        and entity_id = ${requestB}
        and action = 'privacy.processing_partial'
    `;
    assert.equal(requestBAudit?.count, 1);

    const [persisted] = await database.client<
      { state: string; last_error_code: string | null; display_name: string }[]
    >`
      select request.state, request.last_error_code, identity.display_name
      from privacy_requests request
      join identities identity on identity.id = request.subject_identity_id
      where request.id = ${requestA}
    `;
    assert.deepEqual(persisted, {
      state: "partial",
      last_error_code: "MANDATORY_PROCESSORS_BLOCKED",
      display_name: "Privacy Subject A",
    });
    const steps = await database.client<
      { domain: string; status: string; reason_code: string | null }[]
    >`
      select domain, status, reason_code from privacy_request_steps
      where request_id = ${requestA} order by domain
    `;
    assert.deepEqual(
      steps.filter((step) => step.status === "completed").map((step) => step.domain),
      ["identity", "organization_membership"],
    );
    assert.deepEqual(
      steps.filter((step) => step.status === "blocked").map((step) => step.domain),
      [
        "backups",
        "growth_crm",
        "management_finance",
        "objects_media",
        "offline_edge",
        "operations",
      ],
    );

    const [storedExport] = await database.client<
      {
        encrypted_payload: string;
        iv: string;
        auth_tag: string;
        expires_at: Date;
        count: number;
      }[]
    >`
      select encrypted_payload, iv, auth_tag, expires_at,
        count(*) over ()::int as count
      from privacy_exports where request_id = ${requestA}
    `;
    assert.equal(storedExport?.count, 1);
    assert.ok(
      storedExport &&
        new Date(storedExport.expires_at).valueOf() <= Date.now() + 15 * 60_000 + 1_000,
    );
    assert.ok(!storedExport?.encrypted_payload.includes("privacy-a-"));
    const decrypted = JSON.parse(
      decryptSecret(
        {
          encryptedSecret: storedExport?.encrypted_payload ?? "",
          iv: storedExport?.iv ?? "",
          authTag: storedExport?.auth_tag ?? "",
        },
        encryptionKey(encryptionSecret, "PRIVACY_EXPORT_ENCRYPTION_KEY"),
        `privacy-export:${organizationA}:${requestA}:${identityA}`,
      ),
    ) as { partial: boolean; blockedDomains: string[] };
    assert.equal(decrypted.partial, true);
    assert.deepEqual(decrypted.blockedDomains.sort(), [
      "backups",
      "growth_crm",
      "management_finance",
      "objects_media",
      "offline_edge",
      "operations",
    ]);

    const firstDownload = await withTenantContext(
      database,
      { source: "http", organizationId: organizationA, actorIdentityId: identityA },
      (tx) =>
        tx
          .update(privacyExports)
          .set({ downloadedAt: new Date() })
          .where(
            and(
              eq(privacyExports.organizationId, organizationA),
              eq(privacyExports.requestId, requestA),
              isNull(privacyExports.downloadedAt),
            ),
          )
          .returning({ id: privacyExports.id }),
    );
    const secondDownload = await withTenantContext(
      database,
      { source: "http", organizationId: organizationA, actorIdentityId: identityA },
      (tx) =>
        tx
          .update(privacyExports)
          .set({ downloadedAt: new Date() })
          .where(
            and(
              eq(privacyExports.organizationId, organizationA),
              eq(privacyExports.requestId, requestA),
              isNull(privacyExports.downloadedAt),
            ),
          )
          .returning({ id: privacyExports.id }),
    );
    assert.equal(firstDownload.length, 1);
    assert.equal(secondDownload.length, 0);

    await withTenantContext(
      database,
      { source: "http", organizationId: organizationA, actorIdentityId: identityA },
      async (tx) => {
        await tx.insert(privacyRequests).values({
          id: correctionRequest,
          organizationId: organizationA,
          subjectIdentityId: identityA,
          requesterIdentityId: identityA,
          type: "correction",
          state: "processing",
          idempotencyKey: `privacy-${correctionRequest}`,
          requestFingerprint: "b".repeat(64),
          requestPayload: {
            type: "correction",
            corrections: { displayName: "Must not apply yet" },
            reason: "Correction requested by data subject",
          },
          requiredDomains: [...PRIVACY_REQUIRED_DOMAINS],
          attempts: 1,
        });
        await tx.insert(privacyRequestSteps).values(
          PRIVACY_REQUIRED_DOMAINS.map((domain) => ({
            organizationId: organizationA,
            requestId: correctionRequest,
            domain,
            status: ["identity", "organization_membership"].includes(domain)
              ? ("pending" as const)
              : ("blocked" as const),
            reasonCode: ["identity", "organization_membership"].includes(domain)
              ? undefined
              : "PROCESSOR_ABSENT",
          })),
        );
      },
    );
    await withWorkerContext(database, (tx) =>
      processPrivacyRequest(tx as never, processingEvent(organizationA, correctionRequest)),
    );
    const [unchanged] = await database.client<{ display_name: string; state: string }[]>`
      select identity.display_name, request.state
      from identities identity join privacy_requests request
        on request.subject_identity_id = identity.id
      where request.id = ${correctionRequest}
    `;
    assert.deepEqual(unchanged, { display_name: "Privacy Subject A", state: "partial" });

    await seedRequest(organizationA, identityA, failedRequest);
    process.env.PRIVACY_EXPORT_ENCRYPTION_KEY = "invalid";
    const failedEvent = processingEvent(organizationA, failedRequest);
    await assert.rejects(() =>
      withWorkerContext(database, (tx) => processPrivacyRequest(tx as never, failedEvent)),
    );
    assert.equal(
      await withWorkerContext(database, (tx) => failPrivacyRequest(tx as never, failedEvent)),
      true,
    );
    process.env.PRIVACY_EXPORT_ENCRYPTION_KEY = encryptionSecret;
    const [failedState] = await database.client<{ state: string; last_error_code: string }[]>`
      select state, last_error_code from privacy_requests where id = ${failedRequest}
    `;
    assert.deepEqual(failedState, {
      state: "failed",
      last_error_code: "PRIVACY_PROCESSING_FAILED",
    });

    const [privileges] = await database.client<
      { force_rls: boolean; app_delete: boolean; internal_select: boolean }[]
    >`
      select
        (select bool_and(relrowsecurity and relforcerowsecurity)
         from pg_class where oid in (
           'privacy_requests'::regclass, 'privacy_request_steps'::regclass,
           'privacy_exports'::regclass
         )) as force_rls,
        has_table_privilege('giromesa_app', 'privacy_requests', 'delete') as app_delete,
        has_table_privilege('giromesa_internal', 'privacy_exports', 'select') as internal_select
    `;
    assert.deepEqual(privileges, { force_rls: true, app_delete: false, internal_select: false });

    await database.client`
      update privacy_requests set state = 'processing', updated_at = now()
      where id = ${requestA}
    `;
    await assert.rejects(
      () => database.client`
        update privacy_requests set state = 'completed', updated_at = now()
        where id = ${requestA}
      `,
      (error: unknown) =>
        (error as { message?: string }).message?.includes(
          "PRIVACY_MANDATORY_PROCESSORS_INCOMPLETE",
        ) === true,
    );
    await database.client`
      update privacy_requests set state = 'partial', updated_at = now()
      where id = ${requestA}
    `;

    await database.client`delete from organizations where id in (${organizationA}, ${organizationB})`;
    await database.client`delete from identities where id in (${identityA}, ${identityB})`;
  });
});
