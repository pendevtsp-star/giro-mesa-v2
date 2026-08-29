import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import {
  accountantRequests,
  identities,
  memberships,
  mfaFactors,
  organizations,
  outboxEvents,
  roleBindings,
  units,
} from "@giromesa/db";
import { and, eq, inArray } from "drizzle-orm";
import { createApplication } from "../app-factory.js";
import { DatabaseService } from "../database/database.module.js";

async function jsonRequest(
  baseUrl: string,
  path: string,
  options: {
    method?: string;
    cookie?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

it("executes the accountant request journey through authenticated HTTP routes", async (context) => {
  const databaseUrl = process.env.FISCAL_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("FISCAL_DATABASE_URL not configured");
    return;
  }
  const previous = {
    databaseUrl: process.env.DATABASE_URL,
    mediaRoot: process.env.MEDIA_ROOT,
    nodeEnv: process.env.NODE_ENV,
    scanMode: process.env.ACCOUNTANT_ATTACHMENT_SCAN_MODE,
    retentionDays: process.env.ACCOUNTANT_ATTACHMENT_RETENTION_DAYS,
    platformAdminEmails: process.env.PLATFORM_ADMIN_EMAILS,
  };
  const mediaRoot = await mkdtemp(join(tmpdir(), "giromesa-fiscal-http-"));
  process.env.DATABASE_URL = databaseUrl;
  process.env.MEDIA_ROOT = mediaRoot;
  process.env.NODE_ENV = "test";
  process.env.ACCOUNTANT_ATTACHMENT_SCAN_MODE = "disabled";
  process.env.ACCOUNTANT_ATTACHMENT_RETENTION_DAYS = "30";
  const { app } = await createApplication();
  let organizationId: string | undefined;
  const identityIds: string[] = [];
  try {
    await app.listen(0, "127.0.0.1");
    const baseUrl = await app.getUrl();
    const database = app.get(DatabaseService);
    const register = async (name: string) => {
      const email = `fiscal-http-${randomUUID()}@example.test`;
      const result = await jsonRequest(baseUrl, "/api/v1/auth/register", {
        method: "POST",
        body: {
          email,
          password: "a-secure-passphrase",
          name,
          termsAccepted: true,
        },
      });
      assert.equal(result.response.status, 201, JSON.stringify(result.body));
      const cookie = result.response.headers.get("set-cookie")?.split(";", 1)[0];
      assert.ok(cookie);
      identityIds.push(result.body.identity.id);
      return { cookie, email, identityId: result.body.identity.id as string };
    };
    const owner = await register("Owner HTTP");
    const accountant = await register("Accountant HTTP");
    const outsider = await register("Outsider HTTP");
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: "Fiscal HTTP Ltda",
        tradeName: "Fiscal HTTP",
        document: String(randomInt(10_000_000_000_000, 99_999_999_999_999)),
      })
      .returning();
    assert.ok(organization);
    organizationId = organization.id;
    const [unit] = await database.db
      .insert(units)
      .values({ organizationId, name: "Fiscal HTTP", timezone: "America/Sao_Paulo" })
      .returning();
    assert.ok(unit);
    const [ownerMembership, accountantMembership] = await database.db
      .insert(memberships)
      .values([
        { identityId: owner.identityId, organizationId, status: "active" },
        { identityId: accountant.identityId, organizationId, status: "active" },
      ])
      .returning();
    assert.ok(ownerMembership && accountantMembership);
    await database.db.insert(roleBindings).values([
      { membershipId: ownerMembership.id, role: "owner" },
      { membershipId: accountantMembership.id, role: "accountant" },
    ]);
    const prefix = `/api/v1/organizations/${organizationId}/units/${unit.id}/fiscal/accountant`;
    const created = await jsonRequest(baseUrl, `${prefix}/requests`, {
      method: "POST",
      cookie: owner.cookie,
      headers: { "idempotency-key": `http-${randomUUID()}` },
      body: {
        competence: "2026-08",
        title: "Enviar relatório",
        description: "Precisamos do relatório mensal.",
        dueDate: "2026-08-31",
      },
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.request.targetAudience, "accountant");
    const requestId = created.body.request.id as string;

    const denied = await jsonRequest(baseUrl, `${prefix}/requests`, { cookie: outsider.cookie });
    assert.equal(denied.response.status, 403);
    const listed = await jsonRequest(
      baseUrl,
      `${prefix}/requests?status=open&targetAudience=accountant&page=1&pageSize=25`,
      { cookie: accountant.cookie },
    );
    assert.equal(listed.response.status, 200);
    assert.deepEqual(
      listed.body.items.map((item: { id: string }) => item.id),
      [requestId],
    );

    const uploaded = await jsonRequest(baseUrl, `${prefix}/requests/${requestId}/attachments`, {
      method: "POST",
      cookie: owner.cookie,
      body: {
        fileName: "documento.csv",
        contentType: "text/csv",
        contentBase64: Buffer.from("campo;valor\ncompetencia;2026-08").toString("base64"),
      },
    });
    assert.equal(uploaded.response.status, 201);
    const attachmentId = uploaded.body.attachment.id as string;
    process.env.PLATFORM_ADMIN_EMAILS = owner.email;
    await database.db
      .update(identities)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(identities.id, owner.identityId));
    await database.db.insert(mfaFactors).values({
      identityId: owner.identityId,
      encryptedSecret: "test-only",
      iv: "0".repeat(24),
      authTag: "0".repeat(32),
      verifiedAt: new Date(),
    });
    const legalHoldPath = `/api/v1/platform/fiscal/organizations/${organizationId}/units/${unit.id}/accountant/requests/${requestId}/attachments/${attachmentId}/legal-hold`;
    const held = await jsonRequest(baseUrl, legalHoldPath, {
      method: "PATCH",
      cookie: owner.cookie,
      body: { active: true },
    });
    assert.equal(held.response.status, 200);
    assert.equal(held.body.legalHold, true);
    const released = await jsonRequest(baseUrl, legalHoldPath, {
      method: "PATCH",
      cookie: owner.cookie,
      body: { active: false },
    });
    assert.equal(released.response.status, 200);
    assert.equal(released.body.legalHold, false);
    const downloaded = await jsonRequest(
      baseUrl,
      `${prefix}/requests/${requestId}/attachments/${attachmentId}/content`,
      { cookie: accountant.cookie },
    );
    assert.equal(downloaded.response.status, 200);
    assert.equal(
      Buffer.from(downloaded.body.content, "base64").toString(),
      "campo;valor\ncompetencia;2026-08",
    );

    const oversized = await jsonRequest(baseUrl, `${prefix}/requests/${requestId}/attachments`, {
      method: "POST",
      cookie: owner.cookie,
      body: {
        fileName: "grande.csv",
        contentType: "text/csv",
        contentBase64: Buffer.alloc(3 * 1024 * 1024 + 1, 65).toString("base64"),
      },
    });
    assert.equal(oversized.response.status, 400);
    const selfResolution = await jsonRequest(baseUrl, `${prefix}/requests/${requestId}/resolve`, {
      method: "POST",
      cookie: owner.cookie,
      body: { resolution: "Tentativa do autor" },
    });
    assert.equal(selfResolution.response.status, 403);
    const resolved = await jsonRequest(baseUrl, `${prefix}/requests/${requestId}/resolve`, {
      method: "POST",
      cookie: accountant.cookie,
      body: { resolution: "Relatório recebido e conferido." },
    });
    assert.equal(resolved.response.status, 201);
    assert.equal(resolved.body.request.status, "resolved");
    const [event] = await database.db
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.topic, "accounting.request.resolved"),
          eq(outboxEvents.aggregateId, requestId),
        ),
      )
      .limit(1);
    assert.ok(event);
  } finally {
    const database = app.get(DatabaseService);
    if (organizationId) {
      await database.db
        .delete(accountantRequests)
        .where(eq(accountantRequests.organizationId, organizationId));
      await database.db.delete(organizations).where(eq(organizations.id, organizationId));
    }
    if (identityIds.length)
      await database.db.delete(identities).where(inArray(identities.id, identityIds));
    await app.close();
    await rm(mediaRoot, { recursive: true, force: true });
    const restore = (key: keyof typeof previous, environmentKey: string) => {
      const value = previous[key];
      if (value === undefined) delete process.env[environmentKey];
      else process.env[environmentKey] = value;
    };
    restore("databaseUrl", "DATABASE_URL");
    restore("mediaRoot", "MEDIA_ROOT");
    restore("nodeEnv", "NODE_ENV");
    restore("scanMode", "ACCOUNTANT_ATTACHMENT_SCAN_MODE");
    restore("retentionDays", "ACCOUNTANT_ATTACHMENT_RETENTION_DAYS");
    restore("platformAdminEmails", "PLATFORM_ADMIN_EMAILS");
  }
});
