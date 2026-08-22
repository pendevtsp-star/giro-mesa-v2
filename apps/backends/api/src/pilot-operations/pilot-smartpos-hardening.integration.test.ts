import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { it } from "node:test";
import {
  auditEvents,
  deviceEnrollments,
  identities,
  organizations,
  outboxEvents,
  posPaymentAttemptResults,
  posPaymentAttempts,
  posPaymentDeviceCredentials,
  posPaymentDeviceDiagnostics,
  posPaymentReversalResults,
  posPaymentReversals,
  posPaymentTerminalCertifications,
  posTabPayments,
  posTabs,
  posTerminalProfiles,
  units,
} from "@giromesa/db";
import { and, eq, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { PilotPosService } from "./pilot-pos.service.js";
import { smartPosCanonicalRequest } from "./pilot-rules.js";
import type { PaymentTerminalConfigurationInput } from "./pilot-schemas.js";
import { PilotSmartPosService } from "./pilot-smartpos.service.js";

function paymentDeviceRequest(
  credentialId: string,
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
  path: string,
  body: unknown,
) {
  const timestamp = Math.floor(Date.now() / 1_000).toString();
  const nonce = randomUUID();
  const signature = sign(
    "sha256",
    Buffer.from(smartPosCanonicalRequest("POST", path, timestamp, nonce, body)),
    { key: privateKey, dsaEncoding: "ieee-p1363" },
  ).toString("base64url");
  return { credentialId, timestamp, nonce, signature, method: "POST", path, body };
}

async function advisoryWaiterCount(database: DatabaseService) {
  const rows = await database.db.execute(sql<{ waiting: number }>`
    select count(*)::int as waiting
    from pg_locks
    where locktype = 'advisory' and not granted
  `);
  return Number(rows[0]?.waiting ?? 0);
}

async function waitForAdditionalAdvisoryWaiter(database: DatabaseService, baseline: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if ((await advisoryWaiterCount(database)) > baseline) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for terminal configuration to acquire the installation lock");
}

it("hardens terminal release, credential replay and conflicting terminal callbacks", async (context) => {
  const databaseUrl = process.env.PILOT_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("PILOT_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  try {
    const runId = randomUUID();
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: "SmartPOS Hardening Ltda",
        tradeName: "SmartPOS Hardening",
        document: `${runId.replaceAll("-", "").slice(0, 12)}91`,
        billingState: "active",
      })
      .returning();
    assert.ok(organization);
    const [unit] = await database.db
      .insert(units)
      .values({ organizationId: organization.id, name: "SmartPOS" })
      .returning();
    const [identity] = await database.db
      .insert(identities)
      .values({ email: `smartpos-hardening-${runId}@example.test`, displayName: "Platform" })
      .returning();
    assert.ok(unit && identity);
    const [device] = await database.db
      .insert(deviceEnrollments)
      .values({ organizationId: organization.id, unitId: unit.id, label: "Rede Smart" })
      .returning();
    assert.ok(device);

    const diagnostics = {
      manufacturer: "Gertec",
      model: "GPOS700",
      androidVersion: "12",
      firmwareVersion: "rede-test-1",
      appVersion: "0.2.3",
      packageName: "br.com.giromesa.ops",
      signingCertificateSha256: "a".repeat(64),
    };
    const deviceKeys = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const [credential] = await database.db
      .insert(posPaymentDeviceCredentials)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        installationId: device.id,
        publicKeySpki: deviceKeys.publicKey
          .export({ type: "spki", format: "der" })
          .toString("base64"),
        expiresAt: new Date(Date.now() + 86_400_000),
        rotateAfter: new Date(Date.now() + 43_200_000),
      })
      .returning();
    assert.ok(credential);
    await database.db.insert(posPaymentDeviceDiagnostics).values({
      organizationId: organization.id,
      unitId: unit.id,
      installationId: device.id,
      ...diagnostics,
    });
    const certificationId = randomUUID();
    await database.db.insert(posPaymentTerminalCertifications).values({
      id: certificationId,
      organizationId: organization.id,
      unitId: unit.id,
      provider: "rede",
      status: "approved",
      ...diagnostics,
      methods: ["credit_card", "debit_card", "pix"],
      maxInstallments: 12,
      supportsCancel: true,
      supportsRecover: true,
      supportsReversal: true,
    });
    await database.db.insert(posTerminalProfiles).values({
      organizationId: organization.id,
      unitId: unit.id,
      installationId: device.id,
      label: "Rede Smart",
      mode: "waiter_mobile",
      defaultRoute: "counter",
      createdByIdentityId: identity.id,
      updatedByIdentityId: identity.id,
    });

    const scope = new ScopeService(database);
    const smartPos = new PilotSmartPosService(database, scope);
    const pos = new PilotPosService(database, scope, smartPos);
    const terminalConfiguration: PaymentTerminalConfigurationInput = {
      provider: "rede",
      status: "homologated",
      certificationId,
      methods: ["credit_card", "debit_card", "pix"],
      maxInstallments: 12,
      supports: { cancel: true, recover: true, reversal: true },
    };

    let releaseInstallationLock = () => {};
    let markInstallationLockHeld = () => {};
    const installationLockHeld = new Promise<void>((resolve) => {
      markInstallationLockHeld = resolve;
    });
    const installationLockRelease = new Promise<void>((resolve) => {
      releaseInstallationLock = resolve;
    });
    const lockBlocker = database.db.transaction(async (tx) => {
      await smartPos.lockPaymentInstallation(tx, organization.id, unit.id, device.id);
      markInstallationLockHeld();
      await installationLockRelease;
    });
    await installationLockHeld;
    const waiterBaseline = await advisoryWaiterCount(database);
    let configurationSettled = false;
    const queuedConfiguration = pos
      .configurePaymentTerminal(organization.id, unit.id, device.id, terminalConfiguration)
      .finally(() => {
        configurationSettled = true;
      });
    try {
      await waitForAdditionalAdvisoryWaiter(database, waiterBaseline);
      assert.equal(configurationSettled, false);
    } finally {
      releaseInstallationLock();
    }
    await Promise.all([lockBlocker, queuedConfiguration]);
    assert.equal(
      (
        await database.db.transaction((tx) =>
          smartPos.paymentCapability(tx, organization.id, unit.id, device.id),
        )
      ).available,
      true,
    );

    const rotatedKeys = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const rotationId = randomUUID();
    const rotationBody = {
      rotationId,
      newPublicKeySpki: rotatedKeys.publicKey
        .export({ type: "spki", format: "der" })
        .toString("base64"),
    };
    await smartPos.rotateCredential(
      paymentDeviceRequest(
        credential.id,
        deviceKeys.privateKey,
        "/api/v1/device/payment-credentials/rotate",
        rotationBody,
      ),
      rotationBody,
    );
    const conflictingKeys = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const conflictingBody = {
      rotationId,
      newPublicKeySpki: conflictingKeys.publicKey
        .export({ type: "spki", format: "der" })
        .toString("base64"),
    };
    await assert.rejects(
      () =>
        smartPos.rotateCredential(
          paymentDeviceRequest(
            credential.id,
            deviceKeys.privateKey,
            "/api/v1/device/payment-credentials/rotate",
            conflictingBody,
          ),
          conflictingBody,
        ),
      (error: unknown) => {
        assert.equal(
          (error as { response?: { code?: string } }).response?.code,
          "PAYMENT_DEVICE_CREDENTIAL_ROTATION_CONFLICT",
        );
        return true;
      },
    );

    const [attemptTab, reversalTab] = await database.db
      .insert(posTabs)
      .values([
        {
          organizationId: organization.id,
          unitId: unit.id,
          openedByIdentityId: identity.id,
          totalCents: 500,
        },
        {
          organizationId: organization.id,
          unitId: unit.id,
          openedByIdentityId: identity.id,
          totalCents: 700,
        },
      ])
      .returning();
    assert.ok(attemptTab && reversalTab);
    const [canceledAttempt, approvedAttempt] = await database.db
      .insert(posPaymentAttempts)
      .values([
        {
          organizationId: organization.id,
          unitId: unit.id,
          tabId: attemptTab.id,
          installationId: device.id,
          requestedByIdentityId: identity.id,
          provider: "rede",
          method: "pix",
          amountCents: 500,
          installments: 1,
          status: "canceled",
          expiresAt: new Date(Date.now() + 60_000),
          resolvedAt: new Date(),
        },
        {
          organizationId: organization.id,
          unitId: unit.id,
          tabId: reversalTab.id,
          installationId: device.id,
          requestedByIdentityId: identity.id,
          provider: "rede",
          method: "pix",
          amountCents: 700,
          installments: 1,
          status: "approved",
          providerReference: `rede-approved-${runId}`,
          expiresAt: new Date(Date.now() + 60_000),
          resolvedAt: new Date(),
        },
      ])
      .returning();
    assert.ok(canceledAttempt && approvedAttempt);
    const lateApproval = {
      resultId: `late-approval-${runId}`,
      status: "approved" as const,
      providerReference: `rede-late-${runId}`,
      authorizationCode: "LATE123",
      occurredAt: new Date().toISOString(),
    };
    const submitLateApproval = () =>
      pos.recordDevicePaymentResult(
        paymentDeviceRequest(
          credential.id,
          deviceKeys.privateKey,
          `/api/v1/device/payment-attempts/${canceledAttempt.id}/result`,
          lateApproval,
        ),
        canceledAttempt.id,
        lateApproval,
      );
    for (let replay = 0; replay < 2; replay += 1) {
      await assert.rejects(submitLateApproval, (error: unknown) => {
        assert.equal(
          (error as { response?: { code?: string } }).response?.code,
          "PAYMENT_DEVICE_RESULT_TERMINAL_CONFLICT",
        );
        return true;
      });
    }
    const [attemptAfterConflict] = await database.db
      .select({ status: posPaymentAttempts.status })
      .from(posPaymentAttempts)
      .where(eq(posPaymentAttempts.id, canceledAttempt.id));
    assert.equal(attemptAfterConflict?.status, "canceled");
    assert.equal(
      (
        await database.db
          .select({ id: posPaymentAttemptResults.id })
          .from(posPaymentAttemptResults)
          .where(eq(posPaymentAttemptResults.attemptId, canceledAttempt.id))
      ).length,
      1,
    );
    assert.equal(
      (
        await database.db
          .select({ id: auditEvents.id })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.action, "pos.payment.attempt_result_conflict"),
              eq(auditEvents.entityId, canceledAttempt.id),
            ),
          )
      ).length,
      1,
    );
    assert.equal(
      (
        await database.db
          .select({ id: posTabPayments.id })
          .from(posTabPayments)
          .where(eq(posTabPayments.paymentAttemptId, canceledAttempt.id))
      ).length,
      0,
    );

    const [payment] = await database.db
      .insert(posTabPayments)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        tabId: reversalTab.id,
        method: "pix",
        amountCents: 700,
        reference: approvedAttempt.providerReference,
        paymentAttemptId: approvedAttempt.id,
        source: "terminal",
        verified: true,
        createdByIdentityId: identity.id,
      })
      .returning();
    assert.ok(payment);
    const [canceledReversal] = await database.db
      .insert(posPaymentReversals)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        paymentId: payment.id,
        paymentAttemptId: approvedAttempt.id,
        installationId: device.id,
        requestedByIdentityId: identity.id,
        amountCents: 700,
        reason: "Estorno cancelado pelo operador",
        status: "canceled",
        resolvedAt: new Date(),
      })
      .returning();
    assert.ok(canceledReversal);
    const lateReversalApproval = {
      resultId: `late-reversal-${runId}`,
      status: "approved" as const,
      providerReference: `rede-late-reversal-${runId}`,
      occurredAt: new Date().toISOString(),
    };
    const submitLateReversalApproval = () =>
      pos.recordDevicePaymentReversalResult(
        paymentDeviceRequest(
          credential.id,
          deviceKeys.privateKey,
          `/api/v1/device/payment-reversals/${canceledReversal.id}/result`,
          lateReversalApproval,
        ),
        canceledReversal.id,
        lateReversalApproval,
      );
    for (let replay = 0; replay < 2; replay += 1) {
      await assert.rejects(submitLateReversalApproval, (error: unknown) => {
        assert.equal(
          (error as { response?: { code?: string } }).response?.code,
          "PAYMENT_REVERSAL_RESULT_TERMINAL_CONFLICT",
        );
        return true;
      });
    }
    const [reversalAfterConflict] = await database.db
      .select({ status: posPaymentReversals.status })
      .from(posPaymentReversals)
      .where(eq(posPaymentReversals.id, canceledReversal.id));
    assert.equal(reversalAfterConflict?.status, "canceled");
    assert.equal(
      (
        await database.db
          .select({ id: posPaymentReversalResults.id })
          .from(posPaymentReversalResults)
          .where(eq(posPaymentReversalResults.reversalId, canceledReversal.id))
      ).length,
      1,
    );
    assert.equal(
      (
        await database.db
          .select({ id: outboxEvents.id })
          .from(outboxEvents)
          .where(
            and(
              eq(outboxEvents.topic, "pos.payment.reversal_result_conflict"),
              eq(outboxEvents.aggregateId, canceledReversal.id),
            ),
          )
      ).length,
      1,
    );
  } finally {
    await database.onModuleDestroy();
  }
});
