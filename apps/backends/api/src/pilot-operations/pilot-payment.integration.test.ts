import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { it } from "node:test";
import {
  auditEvents,
  deviceEnrollments,
  identities,
  managementCashAdjustments,
  managementCashEntries,
  managementCashRegisters,
  managementCashShifts,
  managementOperationalLosses,
  memberships,
  organizations,
  outboxEvents,
  posPaymentAttemptResults,
  posPaymentAttempts,
  posPaymentDeviceCredentials,
  posPaymentDeviceDiagnostics,
  posPaymentDevicePairingCodes,
  posPaymentReconciliations,
  posPaymentReversals,
  posPaymentTerminalCertifications,
  posTabPayments,
  posTabs,
  posTerminalProfiles,
  roleBindings,
  units,
} from "@giromesa/db";
import { and, eq, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { MetricsService } from "../health/health.module.js";
import { ManagementService } from "../management/management.service.js";
import { ManagementOverviewService } from "../management/management-overview.service.js";
import { ManagementReportService } from "../management/management-report.service.js";
import { ManagementSettlementsService } from "../management/management-settlements.service.js";
import { OrganizationsService } from "../organizations/organizations.service.js";
import { ScopeService } from "../organizations/scope.service.js";
import { PilotPosService } from "./pilot-pos.service.js";
import { smartPosCanonicalRequest } from "./pilot-rules.js";
import type { TerminalProfileInput } from "./pilot-schemas.js";
import { PilotSmartPosService, smartPosInstallationLockKey } from "./pilot-smartpos.service.js";

function paymentDeviceSigner(
  credentialId: string,
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
) {
  return (method: string, path: string, body?: unknown) => {
    const timestamp = Math.floor(Date.now() / 1_000).toString();
    const nonce = randomUUID();
    const signature = sign(
      "sha256",
      Buffer.from(smartPosCanonicalRequest(method, path, timestamp, nonce, body)),
      { key: privateKey, dsaEncoding: "ieee-p1363" },
    ).toString("base64url");
    return { credentialId, timestamp, nonce, signature, method, path, body };
  };
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
  throw new Error("Timed out waiting for the revocation transaction to queue on the advisory lock");
}

it("posts one trusted payment from the enrolled SmartPOS result", async (context) => {
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
        legalName: "SmartPOS Integration Ltda",
        tradeName: "SmartPOS Integration",
        document: `${runId.replaceAll("-", "").slice(0, 12)}11`,
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
      .values({ email: `smartpos-${runId}@example.test`, displayName: "SmartPOS Manager" })
      .returning();
    assert.ok(unit && identity);
    const [membership] = await database.db
      .insert(memberships)
      .values({ identityId: identity.id, organizationId: organization.id, status: "active" })
      .returning();
    assert.ok(membership);
    await database.db.insert(roleBindings).values({ membershipId: membership.id, role: "owner" });

    const [device, otherDevice] = await database.db
      .insert(deviceEnrollments)
      .values([
        {
          organizationId: organization.id,
          unitId: unit.id,
          label: "Rede Smart",
        },
        {
          organizationId: organization.id,
          unitId: unit.id,
          label: "Outro terminal",
        },
      ])
      .returning();
    assert.ok(device && otherDevice);
    const deviceKeys = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const otherDeviceKeys = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const credentialDates = {
      expiresAt: new Date(Date.now() + 86_400_000),
      rotateAfter: new Date(Date.now() + 43_200_000),
    };
    const [deviceCredential, otherDeviceCredential] = await database.db
      .insert(posPaymentDeviceCredentials)
      .values([
        {
          organizationId: organization.id,
          unitId: unit.id,
          installationId: device.id,
          publicKeySpki: deviceKeys.publicKey
            .export({ type: "spki", format: "der" })
            .toString("base64"),
          ...credentialDates,
        },
        {
          organizationId: organization.id,
          unitId: unit.id,
          installationId: otherDevice.id,
          publicKeySpki: otherDeviceKeys.publicKey
            .export({ type: "spki", format: "der" })
            .toString("base64"),
          ...credentialDates,
        },
      ])
      .returning();
    assert.ok(deviceCredential && otherDeviceCredential);
    const signDevice = paymentDeviceSigner(deviceCredential.id, deviceKeys.privateKey);
    const signOtherDevice = paymentDeviceSigner(
      otherDeviceCredential.id,
      otherDeviceKeys.privateKey,
    );
    const claimRequest = (attemptId: string, signer = signDevice) =>
      signer("POST", `/api/v1/device/payment-attempts/${attemptId}/claim`);
    const resultRequest = (attemptId: string, body: unknown, signer = signDevice) =>
      signer("POST", `/api/v1/device/payment-attempts/${attemptId}/result`, body);
    const reportedDiagnostics = {
      manufacturer: "Gertec",
      model: "GPOS700",
      androidVersion: "12",
      firmwareVersion: "rede-test-1",
      appVersion: "0.2.3",
      packageName: "br.com.giromesa.ops",
      signingCertificateSha256: "a".repeat(64),
    };
    await database.db.insert(posPaymentDeviceDiagnostics).values([
      {
        organizationId: organization.id,
        unitId: unit.id,
        installationId: device.id,
        ...reportedDiagnostics,
      },
      {
        organizationId: organization.id,
        unitId: unit.id,
        installationId: otherDevice.id,
        ...reportedDiagnostics,
      },
    ]);
    const certificationId = randomUUID();
    await database.db.insert(posPaymentTerminalCertifications).values({
      id: certificationId,
      organizationId: organization.id,
      unitId: unit.id,
      provider: "rede",
      status: "approved",
      ...reportedDiagnostics,
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
      paymentMode: "homologated_pos",
      defaultRoute: "counter",
      createdByIdentityId: identity.id,
      updatedByIdentityId: identity.id,
    });
    const [tab] = await database.db
      .insert(posTabs)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        openedByIdentityId: identity.id,
        totalCents: 1_000,
      })
      .returning();
    assert.ok(tab);

    const scope = new ScopeService(database);
    const smartPos = new PilotSmartPosService(database, scope);
    const service = new PilotPosService(database, scope, smartPos);
    const management = new ManagementService(database, scope);
    const settlements = new ManagementSettlementsService(database, scope);
    const overview = new ManagementOverviewService(database, scope, management);
    const reports = new ManagementReportService(database, scope, management, new MetricsService());
    const organizationService = new OrganizationsService(database, scope);
    const pairing = await smartPos.createPairingCode(identity.id, organization.id, unit.id, {
      label: "SmartPOS pareado",
      expiresInSeconds: 300,
    });
    const pairedKeys = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pairedInstallationId = randomUUID();
    const paired = await smartPos.redeemPairing({
      code: pairing.code,
      installationId: pairedInstallationId,
      publicKeySpki: pairedKeys.publicKey
        .export({ type: "spki", format: "der" })
        .toString("base64"),
      diagnostics: reportedDiagnostics,
    });
    assert.equal(paired.installationId, pairedInstallationId);
    assert.equal(paired.capabilities.available, false);
    await assert.rejects(() =>
      smartPos.redeemPairing({
        code: pairing.code,
        installationId: randomUUID(),
        publicKeySpki: pairedKeys.publicKey
          .export({ type: "spki", format: "der" })
          .toString("base64"),
        diagnostics: reportedDiagnostics,
      }),
    );
    assert.equal(
      (
        await database.db
          .select()
          .from(posPaymentDevicePairingCodes)
          .where(eq(posPaymentDevicePairingCodes.id, pairing.pairingId))
      )[0]?.consumedByInstallationId,
      pairedInstallationId,
    );
    const pairedSigner = paymentDeviceSigner(paired.credentialId, pairedKeys.privateKey);
    const rotatedKeys = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const rotationBody = {
      rotationId: randomUUID(),
      newPublicKeySpki: rotatedKeys.publicKey
        .export({ type: "spki", format: "der" })
        .toString("base64"),
    };
    const rotated = await smartPos.rotateCredential(
      pairedSigner("POST", "/api/v1/device/payment-credentials/rotate", rotationBody),
      rotationBody,
    );
    assert.notEqual(rotated.credentialId, paired.credentialId);
    const rotatedSigner = paymentDeviceSigner(rotated.credentialId, rotatedKeys.privateKey);
    assert.equal(
      (
        await smartPos.reportDiagnostics(
          rotatedSigner("POST", "/api/v1/device/payment-diagnostics", reportedDiagnostics),
          reportedDiagnostics,
        )
      ).available,
      false,
    );
    await database.db
      .update(deviceEnrollments)
      .set({ revokedAt: new Date() })
      .where(eq(deviceEnrollments.id, pairedInstallationId));
    await database.db
      .update(posPaymentDeviceDiagnostics)
      .set({ lastSeenAt: new Date("2000-01-01T00:00:00.000Z") })
      .where(eq(posPaymentDeviceDiagnostics.installationId, pairedInstallationId));
    await assert.rejects(() =>
      smartPos.reportDiagnostics(
        rotatedSigner("POST", "/api/v1/device/payment-diagnostics", reportedDiagnostics),
        reportedDiagnostics,
      ),
    );
    assert.equal(
      (await smartPos.health(identity.id, organization.id, unit.id)).summary.offlineDevices,
      0,
    );
    await service.configurePaymentTerminal(organization.id, unit.id, device.id, {
      provider: "rede",
      status: "homologated",
      certificationId,
      methods: ["credit_card", "debit_card", "pix"],
      maxInstallments: 12,
      supports: { cancel: true, recover: true, reversal: true },
    });
    const [terminalCashRegister, manualCashRegister] = await database.db
      .insert(managementCashRegisters)
      .values([
        {
          organizationId: organization.id,
          unitId: unit.id,
          name: "SmartPOS",
          createdByIdentityId: identity.id,
        },
        {
          organizationId: organization.id,
          unitId: unit.id,
          name: "Caixa manual",
          createdByIdentityId: identity.id,
        },
      ])
      .returning();
    assert.ok(terminalCashRegister && manualCashRegister);
    const terminalProfileInput: TerminalProfileInput = {
      label: "Rede Smart atualizada",
      mode: "waiter_mobile",
      paymentMode: "homologated_pos",
      defaultRoute: "counter",
      printerId: null,
      stationId: null,
      cashRegisterId: terminalCashRegister.id,
      compact: true,
      quickActions: [],
    };
    await service.putTerminalProfile(
      identity.id,
      organization.id,
      unit.id,
      device.id,
      `ordinary-profile-${runId}`,
      terminalProfileInput,
    );
    assert.equal(
      (await service.getTerminalProfile(identity.id, organization.id, unit.id, device.id))
        ?.cashRegisterId,
      terminalCashRegister.id,
    );
    assert.equal(
      (await service.getPaymentCapabilities(identity.id, organization.id, unit.id, device.id))
        .available,
      true,
    );
    const mismatchedDiagnostics = { ...reportedDiagnostics, firmwareVersion: "unexpected" };
    const mismatchCapability = await smartPos.reportDiagnostics(
      signDevice("POST", "/api/v1/device/payment-diagnostics", mismatchedDiagnostics),
      mismatchedDiagnostics,
    );
    assert.equal(mismatchCapability.available, false);
    assert.equal(mismatchCapability.reason, "PAYMENT_REPORTED_DIAGNOSTICS_MISMATCH");
    await smartPos.reportDiagnostics(
      signDevice("POST", "/api/v1/device/payment-diagnostics", reportedDiagnostics),
      reportedDiagnostics,
    );
    await smartPos.configureCertification(organization.id, unit.id, certificationId, {
      provider: "rede",
      status: "approved",
      diagnostics: reportedDiagnostics,
      methods: ["credit_card", "debit_card", "pix"],
      maxInstallments: 12,
      supports: { cancel: true, recover: true, reversal: true },
      killSwitchEnabled: true,
      killSwitchReason: "Teste de bloqueio remoto",
    });
    const killed = await service.getPaymentCapabilities(
      identity.id,
      organization.id,
      unit.id,
      device.id,
    );
    assert.equal(killed.available, false);
    assert.equal(killed.reason, "PAYMENT_TERMINAL_KILL_SWITCHED");
    await smartPos.configureCertification(organization.id, unit.id, certificationId, {
      provider: "rede",
      status: "approved",
      diagnostics: reportedDiagnostics,
      methods: ["credit_card", "debit_card", "pix"],
      maxInstallments: 12,
      supports: { cancel: true, recover: true, reversal: true },
      killSwitchEnabled: false,
      killSwitchReason: null,
    });
    await assert.rejects(
      () =>
        smartPos.configureCertification(randomUUID(), randomUUID(), certificationId, {
          provider: "rede",
          status: "approved",
          diagnostics: reportedDiagnostics,
          methods: ["credit_card"],
          maxInstallments: 1,
          supports: { cancel: false, recover: false, reversal: false },
          killSwitchEnabled: false,
          killSwitchReason: null,
        }),
      (error: unknown) => {
        assert.equal(
          (error as { response?: { code?: string } }).response?.code,
          "PAYMENT_CERTIFICATION_SCOPE_MISMATCH",
        );
        return true;
      },
    );
    const [cashShift, manualCashShift] = await database.db
      .insert(managementCashShifts)
      .values([
        {
          organizationId: organization.id,
          unitId: unit.id,
          cashRegisterId: terminalCashRegister.id,
          operatorIdentityId: identity.id,
          currentResponsibleIdentityId: identity.id,
          openingCents: 0,
          openIdempotencyKey: `cash-shift-${runId}`,
        },
        {
          organizationId: organization.id,
          unitId: unit.id,
          cashRegisterId: manualCashRegister.id,
          operatorIdentityId: identity.id,
          currentResponsibleIdentityId: identity.id,
          openingCents: 0,
          openIdempotencyKey: `manual-cash-shift-${runId}`,
        },
      ])
      .returning();
    assert.ok(cashShift && manualCashShift);
    const created = await service.createPaymentAttempt(
      identity.id,
      organization.id,
      unit.id,
      tab.id,
      `attempt-${runId}`,
      { installationId: device.id, method: "credit_card", amountCents: 600, installments: 2 },
    );
    const attempt = created.attempt as { id: string };
    const replay = await service.createPaymentAttempt(
      identity.id,
      organization.id,
      unit.id,
      tab.id,
      `attempt-${runId}`,
      { installationId: device.id, method: "credit_card", amountCents: 600, installments: 2 },
    );
    assert.equal(replay.idempotentReplay, true);
    await assert.rejects(() =>
      service.createPaymentAttempt(
        identity.id,
        organization.id,
        unit.id,
        tab.id,
        `attempt-over-${runId}`,
        { installationId: device.id, method: "pix", amountCents: 500, installments: 1 },
      ),
    );
    await assert.rejects(() =>
      service.recordPayment(
        identity.id,
        organization.id,
        unit.id,
        tab.id,
        `manual-reserved-${runId}`,
        { method: "cash", amountCents: 500, cashRegisterId: manualCashRegister.id },
      ),
    );
    await assert.rejects(
      () =>
        service.setTip(identity.id, organization.id, unit.id, tab.id, `reduce-reserved-${runId}`, {
          tipCents: 0,
        }),
      (error: unknown) => {
        assert.equal(
          (error as { response?: { code?: string } }).response?.code,
          "TAB_TOTAL_BELOW_COMMITTED_PAYMENTS",
        );
        return true;
      },
    );
    const [tabAfterRejectedReduction] = await database.db
      .select({ totalCents: posTabs.totalCents, tipCents: posTabs.tipCents })
      .from(posTabs)
      .where(eq(posTabs.id, tab.id));
    assert.deepEqual(tabAfterRejectedReduction, { totalCents: 1_000, tipCents: 0 });
    await assert.rejects(
      () =>
        service.closeTab(identity.id, organization.id, unit.id, tab.id, `close-reserved-${runId}`, {
          printRequested: false,
        }),
      (error: unknown) => {
        assert.equal(
          (error as { response?: { code?: string } }).response?.code,
          "TAB_HAS_ACTIVE_PAYMENT_ATTEMPT",
        );
        return true;
      },
    );
    const [mergeTarget] = await database.db
      .insert(posTabs)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        openedByIdentityId: identity.id,
        totalCents: 0,
      })
      .returning();
    assert.ok(mergeTarget);
    await assert.rejects(
      () =>
        service.mergeTabs(identity.id, organization.id, unit.id, `merge-reserved-${runId}`, {
          targetTabId: mergeTarget.id,
          sourceTabIds: [tab.id],
          reasonCode: "operational_reorganization",
        }),
      (error: unknown) => {
        assert.equal(
          (error as { response?: { code?: string } }).response?.code,
          "TAB_MERGE_HAS_ACTIVE_PAYMENT_ATTEMPT",
        );
        return true;
      },
    );

    const [lossRaceTab] = await database.db
      .insert(posTabs)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        openedByIdentityId: identity.id,
        totalCents: 1_000,
      })
      .returning();
    assert.ok(lossRaceTab);
    const pendingLoss = await settlements.createOperationalLoss(
      identity.id,
      organization.id,
      unit.id,
      `loss-race-create-${runId}`,
      {
        tabId: lossRaceTab.id,
        type: "unpaid_tab",
        reason: "Teste de concorrência com reserva SmartPOS",
        amountCents: 700,
      },
    );
    const lossAttemptRace = await Promise.allSettled([
      service.createPaymentAttempt(
        identity.id,
        organization.id,
        unit.id,
        lossRaceTab.id,
        `loss-race-attempt-${runId}`,
        { installationId: device.id, method: "pix", amountCents: 700, installments: 1 },
      ),
      settlements.decideOperationalLoss(
        identity.id,
        organization.id,
        unit.id,
        pendingLoss.id,
        `loss-race-approve-${runId}`,
        { action: "approve", note: "Aprovação concorrente de teste" },
      ),
    ]);
    assert.equal(lossAttemptRace.filter((result) => result.status === "fulfilled").length, 1);

    const [reverseRaceTab] = await database.db
      .insert(posTabs)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        openedByIdentityId: identity.id,
        totalCents: 1_000,
      })
      .returning();
    assert.ok(reverseRaceTab);
    const reverseRaceLoss = await settlements.createOperationalLoss(
      identity.id,
      organization.id,
      unit.id,
      `reverse-race-create-${runId}`,
      {
        tabId: reverseRaceTab.id,
        type: "unpaid_tab",
        reason: "Teste de concorrência entre fechamento e reversão",
        amountCents: 1_000,
      },
    );
    await settlements.decideOperationalLoss(
      identity.id,
      organization.id,
      unit.id,
      reverseRaceLoss.id,
      `reverse-race-approve-${runId}`,
      { action: "approve", note: "Aprovação para teste de corrida" },
    );
    const closeReverseRace = await Promise.allSettled([
      service.closeTab(
        identity.id,
        organization.id,
        unit.id,
        reverseRaceTab.id,
        `reverse-race-close-${runId}`,
        { printRequested: false },
      ),
      settlements.decideOperationalLoss(
        identity.id,
        organization.id,
        unit.id,
        reverseRaceLoss.id,
        `reverse-race-reverse-${runId}`,
        { action: "reverse", note: "Reversão concorrente de teste" },
      ),
    ]);
    assert.equal(closeReverseRace.filter((result) => result.status === "fulfilled").length, 1);
    const [[reverseRaceTabAfter], [reverseRaceLossAfter]] = await Promise.all([
      database.db
        .select({ status: posTabs.status })
        .from(posTabs)
        .where(eq(posTabs.id, reverseRaceTab.id)),
      database.db
        .select({ status: managementOperationalLosses.status })
        .from(managementOperationalLosses)
        .where(eq(managementOperationalLosses.id, reverseRaceLoss.id)),
    ]);
    assert.notDeepEqual(
      [reverseRaceTabAfter?.status, reverseRaceLossAfter?.status],
      ["closed", "reversed"],
    );

    const [concurrentAttemptTab, concurrentManualTab] = await database.db
      .insert(posTabs)
      .values([
        {
          organizationId: organization.id,
          unitId: unit.id,
          openedByIdentityId: identity.id,
          totalCents: 1_000,
        },
        {
          organizationId: organization.id,
          unitId: unit.id,
          openedByIdentityId: identity.id,
          totalCents: 1_000,
        },
      ])
      .returning();
    assert.ok(concurrentAttemptTab && concurrentManualTab);
    const concurrentAttempts = await Promise.allSettled([
      service.createPaymentAttempt(
        identity.id,
        organization.id,
        unit.id,
        concurrentAttemptTab.id,
        `concurrent-attempt-a-${runId}`,
        { installationId: device.id, method: "pix", amountCents: 700, installments: 1 },
      ),
      service.createPaymentAttempt(
        identity.id,
        organization.id,
        unit.id,
        concurrentAttemptTab.id,
        `concurrent-attempt-b-${runId}`,
        { installationId: device.id, method: "pix", amountCents: 700, installments: 1 },
      ),
    ]);
    assert.equal(concurrentAttempts.filter((result) => result.status === "fulfilled").length, 1);
    const concurrentManualPayments = await Promise.allSettled([
      service.recordPayment(
        identity.id,
        organization.id,
        unit.id,
        concurrentManualTab.id,
        `concurrent-manual-a-${runId}`,
        { method: "cash", amountCents: 700, cashRegisterId: manualCashRegister.id },
      ),
      service.recordPayment(
        identity.id,
        organization.id,
        unit.id,
        concurrentManualTab.id,
        `concurrent-manual-b-${runId}`,
        { method: "cash", amountCents: 700, cashRegisterId: manualCashRegister.id },
      ),
    ]);
    assert.equal(
      concurrentManualPayments.filter((result) => result.status === "fulfilled").length,
      1,
    );

    const [claimCancelTab, expiredClaimTab] = await database.db
      .insert(posTabs)
      .values([
        {
          organizationId: organization.id,
          unitId: unit.id,
          openedByIdentityId: identity.id,
          totalCents: 1_000,
        },
        {
          organizationId: organization.id,
          unitId: unit.id,
          openedByIdentityId: identity.id,
          totalCents: 1_000,
        },
      ])
      .returning();
    assert.ok(claimCancelTab && expiredClaimTab);
    const claimCancelAttempt = await service.createPaymentAttempt(
      identity.id,
      organization.id,
      unit.id,
      claimCancelTab.id,
      `claim-cancel-${runId}`,
      { installationId: device.id, method: "pix", amountCents: 500, installments: 1 },
    );
    const claimCancelAttemptId = (claimCancelAttempt.attempt as { id: string }).id;
    const claimCancelRace = await Promise.allSettled([
      service.claimDevicePaymentAttempt(claimRequest(claimCancelAttemptId), claimCancelAttemptId),
      service.cancelPaymentAttempt(
        identity.id,
        organization.id,
        unit.id,
        claimCancelAttemptId,
        `cancel-race-${runId}`,
      ),
    ]);
    const claimCancelFinal = await service.getPaymentAttempt(
      identity.id,
      organization.id,
      unit.id,
      claimCancelAttemptId,
    );
    if (claimCancelFinal.attempt.status === "canceled") {
      assert.equal(claimCancelRace[0]?.status, "rejected");
    } else {
      assert.equal(claimCancelFinal.attempt.status, "processing");
      assert.equal(claimCancelRace[0]?.status, "fulfilled");
      if (claimCancelRace[1]?.status === "fulfilled") {
        assert.equal(
          (
            await service.claimDevicePaymentAttempt(
              claimRequest(claimCancelAttemptId),
              claimCancelAttemptId,
            )
          ).action,
          "cancel",
        );
      }
    }

    const expiredAttempt = await service.createPaymentAttempt(
      identity.id,
      organization.id,
      unit.id,
      expiredClaimTab.id,
      `expired-claim-${runId}`,
      { installationId: device.id, method: "pix", amountCents: 500, installments: 1 },
    );
    const expiredAttemptId = (expiredAttempt.attempt as { id: string }).id;
    await database.db
      .update(posPaymentAttempts)
      .set({ expiresAt: new Date("2000-01-01T00:00:00.000Z") })
      .where(eq(posPaymentAttempts.id, expiredAttemptId));
    await assert.rejects(() =>
      service.claimDevicePaymentAttempt(claimRequest(expiredAttemptId), expiredAttemptId),
    );
    assert.equal(
      (await service.getPaymentAttempt(identity.id, organization.id, unit.id, expiredAttemptId))
        .attempt.status,
      "canceled",
    );
    await assert.rejects(() =>
      service.recordDevicePaymentResult(
        {
          method: "POST",
          path: `/api/v1/device/payment-attempts/${attempt.id}/result`,
        },
        attempt.id,
        {
          resultId: `result-missing-${runId}`,
          status: "approved",
          providerReference: `rede-${runId}`,
          occurredAt: new Date().toISOString(),
        },
      ),
    );
    await assert.rejects(() => {
      const body = {
        resultId: `result-other-${runId}`,
        status: "approved" as const,
        providerReference: `rede-${runId}`,
        occurredAt: new Date().toISOString(),
      };
      return service.recordDevicePaymentResult(
        resultRequest(attempt.id, body, signOtherDevice),
        attempt.id,
        body,
      );
    });
    await assert.rejects(() => {
      const body = {
        resultId: `result-before-claim-${runId}`,
        status: "approved" as const,
        providerReference: `rede-before-claim-${runId}`,
        occurredAt: new Date().toISOString(),
      };
      return service.recordDevicePaymentResult(resultRequest(attempt.id, body), attempt.id, body);
    });
    const signedClaim = claimRequest(attempt.id);
    const claimed = await service.claimDevicePaymentAttempt(signedClaim, attempt.id);
    assert.equal(claimed.attempt.status, "processing");
    assert.equal(claimed.action, "start");
    await assert.rejects(
      () => service.claimDevicePaymentAttempt(signedClaim, attempt.id),
      (error: unknown) => {
        assert.equal(
          (error as { response?: { code?: string } }).response?.code,
          "PAYMENT_DEVICE_REQUEST_REPLAYED",
        );
        return true;
      },
    );
    const replayedClaim = await service.claimDevicePaymentAttempt(
      claimRequest(attempt.id),
      attempt.id,
    );
    assert.equal(replayedClaim.attempt.status, "processing");
    assert.equal(replayedClaim.action, "recover");
    await service.putTerminalProfile(
      identity.id,
      organization.id,
      unit.id,
      device.id,
      `unbound-profile-${runId}`,
      { ...terminalProfileInput, cashRegisterId: null },
    );
    const ambiguousDeviceResult = {
      resultId: `result-ambiguous-${runId}`,
      status: "approved" as const,
      providerReference: `rede-ambiguous-${runId}`,
      occurredAt: new Date().toISOString(),
    };
    await assert.rejects(
      () =>
        service.recordDevicePaymentResult(
          resultRequest(attempt.id, ambiguousDeviceResult),
          attempt.id,
          ambiguousDeviceResult,
        ),
      (error: unknown) => {
        assert.equal(
          (error as { response?: { code?: string } }).response?.code,
          "CASH_REGISTER_BINDING_REQUIRED",
        );
        return true;
      },
    );
    await service.putTerminalProfile(
      identity.id,
      organization.id,
      unit.id,
      device.id,
      `rebound-profile-${runId}`,
      terminalProfileInput,
    );
    const deviceResult = {
      resultId: `result-${runId}`,
      status: "approved" as const,
      providerReference: `rede-${runId}`,
      authorizationCode: "A12345",
      occurredAt: "2000-01-01T00:00:00.000Z",
    };
    const approved = await service.recordDevicePaymentResult(
      resultRequest(attempt.id, deviceResult),
      attempt.id,
      deviceResult,
    );
    assert.equal(approved.attempt.status, "approved");
    assert.equal(
      (
        await service.recordDevicePaymentResult(
          resultRequest(attempt.id, deviceResult),
          attempt.id,
          deviceResult,
        )
      ).idempotentReplay,
      true,
    );

    const [payments, results, audits, outbox] = await Promise.all([
      database.db
        .select()
        .from(posTabPayments)
        .where(eq(posTabPayments.paymentAttemptId, attempt.id)),
      database.db
        .select()
        .from(posPaymentAttemptResults)
        .where(eq(posPaymentAttemptResults.attemptId, attempt.id)),
      database.db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.organizationId, organization.id),
            eq(auditEvents.action, "pos.payment.recorded"),
            eq(auditEvents.entityId, attempt.id),
          ),
        ),
      database.db
        .select()
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.topic, "pos.payment.recorded"),
            eq(outboxEvents.aggregateId, attempt.id),
          ),
        ),
    ]);
    assert.equal(payments.length, 1);
    assert.equal(payments[0]?.source, "terminal");
    assert.equal(payments[0]?.verified, true);
    assert.equal(payments[0]?.createdAt.getUTCFullYear(), new Date().getUTCFullYear());
    const [cashEntry] = await database.db
      .select()
      .from(managementCashEntries)
      .where(eq(managementCashEntries.sourceId, payments[0]?.id ?? ""));
    assert.deepEqual(
      cashEntry && {
        cashShiftId: cashEntry.cashShiftId,
        direction: cashEntry.direction,
        entryType: cashEntry.entryType,
        paymentMethod: cashEntry.paymentMethod,
        affectsDrawer: cashEntry.affectsDrawer,
        amountCents: cashEntry.amountCents,
        sourceType: cashEntry.sourceType,
        actorIdentityId: cashEntry.actorIdentityId,
      },
      {
        cashShiftId: cashShift.id,
        direction: "in",
        entryType: "pos_payment",
        paymentMethod: "credit_card",
        affectsDrawer: false,
        amountCents: 600,
        sourceType: "pos_tab_payment",
        actorIdentityId: identity.id,
      },
    );
    assert.equal(results[0]?.occurredAt.toISOString(), "2000-01-01T00:00:00.000Z");
    assert.equal(audits.length, 1);
    assert.equal(outbox.length, 1);
    const paymentId = payments[0]?.id;
    assert.ok(paymentId);
    const reconciliationBase = {
      provider: "rede" as const,
      providerSettlementId: `settlement-${runId}`,
      providerReference: deviceResult.providerReference,
      grossCents: 600,
      feeCents: 30,
      netCents: 570,
      expectedSettlementAt: new Date(Date.now() + 86_400_000).toISOString(),
      settledAt: null,
      status: "pending" as const,
      source: "api" as const,
    };
    const pendingReconciliation = await smartPos.ingestReconciliation(
      organization.id,
      unit.id,
      reconciliationBase,
    );
    assert.equal(pendingReconciliation.reconciliation.status, "pending");
    assert.equal(
      (await smartPos.ingestReconciliation(organization.id, unit.id, reconciliationBase))
        .idempotentReplay,
      true,
    );
    await smartPos.ingestReconciliation(organization.id, unit.id, {
      ...reconciliationBase,
      status: "matched",
    });
    await assert.rejects(
      () => smartPos.ingestReconciliation(organization.id, unit.id, reconciliationBase),
      (error: unknown) => {
        assert.equal(
          (error as { response?: { code?: string } }).response?.code,
          "PAYMENT_RECONCILIATION_STATUS_REGRESSION",
        );
        return true;
      },
    );
    const settledAt = new Date().toISOString();
    await smartPos.ingestReconciliation(organization.id, unit.id, {
      ...reconciliationBase,
      status: "settled",
      settledAt,
    });
    await assert.rejects(
      () =>
        smartPos.ingestReconciliation(organization.id, unit.id, {
          ...reconciliationBase,
          status: "settled",
          settledAt,
          source: "webhook",
        }),
      (error: unknown) => {
        assert.equal(
          (error as { response?: { code?: string } }).response?.code,
          "PAYMENT_RECONCILIATION_CONFLICT",
        );
        return true;
      },
    );

    const reversal = await service.requestPaymentReversal(
      identity.id,
      organization.id,
      unit.id,
      paymentId,
      `reversal-${runId}`,
      { reason: "Estorno integral de teste homologado" },
    );
    assert.equal(
      (
        await service.requestPaymentReversal(
          identity.id,
          organization.id,
          unit.id,
          paymentId,
          `reversal-${runId}`,
          { reason: "Estorno integral de teste homologado" },
        )
      ).idempotentReplay,
      true,
    );
    const reversalId = reversal.reversal.id;
    const claimedReversal = await service.claimDevicePaymentReversal(
      signDevice("POST", `/api/v1/device/payment-reversals/${reversalId}/claim`),
      reversalId,
    );
    assert.equal(claimedReversal.action.type, "reverse");
    const reversalResult = {
      resultId: `reversal-result-${runId}`,
      status: "approved" as const,
      providerReference: `rede-reversal-${runId}`,
      occurredAt: new Date().toISOString(),
    };
    const signedReversalResult = () =>
      signDevice("POST", `/api/v1/device/payment-reversals/${reversalId}/result`, reversalResult);
    assert.equal(
      (
        await service.recordDevicePaymentReversalResult(
          signedReversalResult(),
          reversalId,
          reversalResult,
        )
      ).reversal.status,
      "approved",
    );
    assert.equal(
      (
        await service.recordDevicePaymentReversalResult(
          signedReversalResult(),
          reversalId,
          reversalResult,
        )
      ).idempotentReplay,
      true,
    );
    const [[reversedAttempt], [storedPayment], [storedReversal], [reconciled]] = await Promise.all([
      database.db
        .select({ status: posPaymentAttempts.status })
        .from(posPaymentAttempts)
        .where(eq(posPaymentAttempts.id, attempt.id)),
      database.db.select().from(posTabPayments).where(eq(posTabPayments.id, paymentId)),
      database.db
        .select({ status: posPaymentReversals.status })
        .from(posPaymentReversals)
        .where(eq(posPaymentReversals.id, reversalId)),
      database.db
        .select({ status: posPaymentReconciliations.status })
        .from(posPaymentReconciliations)
        .where(eq(posPaymentReconciliations.paymentId, paymentId)),
    ]);
    assert.equal(reversedAttempt?.status, "reversed");
    assert.ok(storedPayment, "reversal must preserve the original ledger payment");
    assert.equal(storedReversal?.status, "approved");
    assert.equal(reconciled?.status, "reversed");
    const openShiftReversalEntries = await database.db
      .select()
      .from(managementCashEntries)
      .where(
        and(
          eq(managementCashEntries.organizationId, organization.id),
          eq(managementCashEntries.unitId, unit.id),
          eq(managementCashEntries.sourceType, "payment_reversal"),
          eq(managementCashEntries.sourceId, reversalId),
        ),
      );
    assert.deepEqual(
      openShiftReversalEntries.map((entry) => ({
        cashShiftId: entry.cashShiftId,
        direction: entry.direction,
        entryType: entry.entryType,
        paymentMethod: entry.paymentMethod,
        affectsDrawer: entry.affectsDrawer,
        amountCents: entry.amountCents,
      })),
      [
        {
          cashShiftId: cashShift.id,
          direction: "out",
          entryType: "reversal",
          paymentMethod: "credit_card",
          affectsDrawer: false,
          amountCents: 600,
        },
      ],
    );
    const tabSnapshot = await service.getTab(identity.id, organization.id, unit.id, tab.id);
    assert.equal(tabSnapshot.payments.length, 1);
    assert.equal(tabSnapshot.payments[0]?.amountCents, 600);
    assert.equal(tabSnapshot.payments[0]?.reversedCents, 600);
    assert.equal(tabSnapshot.payments[0]?.netAmountCents, 0);
    assert.equal(tabSnapshot.payments[0]?.financialStatus, "reversed");
    assert.deepEqual(tabSnapshot.paymentSummary, {
      grossPaidCents: 600,
      reversedCents: 600,
      paidCents: 0,
    });
    const cashState = await management.listCashShifts(identity.id, organization.id, unit.id);
    assert.deepEqual(
      cashState.pendingTabs.find((candidate) => candidate.id === tab.id),
      {
        id: tab.id,
        label: "Comanda",
        totalCents: 1_000,
        paidCents: 0,
        remainingCents: 1_000,
      },
    );
    const lossCandidates = await settlements.lossCandidates(
      identity.id,
      organization.id,
      unit.id,
      "",
    );
    assert.equal(
      lossCandidates.candidates.find((candidate) => candidate.tabId === tab.id)?.remainingCents,
      1_000,
    );
    const operationSnapshot = await (
      overview as unknown as {
        loadOperations: (
          identityId: string,
          organizationId: string,
          unitId: string,
          periodStart: Date,
          now: Date,
          kdsDelayMinutes: number,
        ) => Promise<{ receivedCents: number }>;
      }
    ).loadOperations(
      identity.id,
      organization.id,
      unit.id,
      new Date(Date.now() - 60 * 60_000),
      new Date(),
      15,
    );
    // The earlier concurrency scenario left one legitimate R$ 7 cash receipt;
    // the R$ 6 terminal payment must be fully neutralized by this reversal.
    assert.equal(operationSnapshot.receivedCents, 700);
    const localDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: unit.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const paymentDrill = await reports.drillDown(identity.id, organization.id, unit.id, {
      from: localDate,
      to: localDate,
      comparisonMode: "previous_period",
      dimension: "payment_method",
      key: "credit_card",
      limit: 50,
    });
    assert.equal(paymentDrill.totals.amountCents, -600);
    assert.equal(paymentDrill.rows[0]?.referenceType, "payment_reversal");
    assert.equal(paymentDrill.rows[0]?.amountCents, -600);
    const managementReport = await management.reports(identity.id, organization.id, unit.id, {
      from: localDate,
      to: localDate,
      comparisonMode: "previous_period",
      family: "sales",
    });
    assert.equal(
      managementReport.breakdowns.paymentMethods.find((method) => method.key === "credit_card")
        ?.revenueCents,
      -600,
    );

    const [postCloseTab] = await database.db
      .insert(posTabs)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        openedByIdentityId: identity.id,
        totalCents: 450,
      })
      .returning();
    assert.ok(postCloseTab);
    const postCloseAttempt = await service.createPaymentAttempt(
      identity.id,
      organization.id,
      unit.id,
      postCloseTab.id,
      `post-close-attempt-${runId}`,
      { installationId: device.id, method: "debit_card", amountCents: 450, installments: 1 },
    );
    await service.claimDevicePaymentAttempt(
      claimRequest(postCloseAttempt.attempt.id),
      postCloseAttempt.attempt.id,
    );
    const postClosePaymentResult = {
      resultId: `post-close-payment-result-${runId}`,
      status: "approved" as const,
      providerReference: `rede-post-close-${runId}`,
      occurredAt: new Date().toISOString(),
    };
    const postClosePayment = await service.recordDevicePaymentResult(
      resultRequest(postCloseAttempt.attempt.id, postClosePaymentResult),
      postCloseAttempt.attempt.id,
      postClosePaymentResult,
    );
    assert.ok(postClosePayment.paymentId);
    await management.closeCashShift(
      identity.id,
      organization.id,
      unit.id,
      cashShift.id,
      `post-close-shift-${runId}`,
      {
        tenderCounts: [
          { method: "cash", observedCents: 0, source: "manual" },
          { method: "credit_card", observedCents: 600, source: "manual" },
          { method: "debit_card", observedCents: 450, source: "manual" },
        ],
        closeReason: "Fechamento antes do estorno de teste",
      },
    );
    const postCloseReversal = await service.requestPaymentReversal(
      identity.id,
      organization.id,
      unit.id,
      postClosePayment.paymentId,
      `post-close-reversal-${runId}`,
      { reason: "Estorno após o fechamento do caixa" },
    );
    await service.claimDevicePaymentReversal(
      signDevice("POST", `/api/v1/device/payment-reversals/${postCloseReversal.reversal.id}/claim`),
      postCloseReversal.reversal.id,
    );
    const postCloseReversalResult = {
      resultId: `post-close-reversal-result-${runId}`,
      status: "approved" as const,
      providerReference: `rede-post-close-reversal-${runId}`,
      occurredAt: new Date().toISOString(),
    };
    const recordPostCloseReversal = () =>
      service.recordDevicePaymentReversalResult(
        signDevice(
          "POST",
          `/api/v1/device/payment-reversals/${postCloseReversal.reversal.id}/result`,
          postCloseReversalResult,
        ),
        postCloseReversal.reversal.id,
        postCloseReversalResult,
      );
    assert.equal((await recordPostCloseReversal()).reversal.status, "approved");
    assert.equal((await recordPostCloseReversal()).idempotentReplay, true);
    const [postCloseAdjustment, postCloseReversalEvent] = await Promise.all([
      database.db
        .select()
        .from(managementCashAdjustments)
        .where(
          and(
            eq(managementCashAdjustments.organizationId, organization.id),
            eq(managementCashAdjustments.unitId, unit.id),
            eq(managementCashAdjustments.sourceType, "payment_reversal"),
            eq(managementCashAdjustments.sourceId, postCloseReversal.reversal.id),
          ),
        ),
      database.db
        .select({ metadata: auditEvents.metadata })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.organizationId, organization.id),
            eq(auditEvents.unitId, unit.id),
            eq(auditEvents.action, "pos.payment.reversal_approved"),
            eq(auditEvents.entityId, postCloseReversal.reversal.id),
          ),
        ),
    ]);
    assert.deepEqual(
      postCloseAdjustment.map((adjustment) => ({
        cashRegisterId: adjustment.cashRegisterId,
        originalCashShiftId: adjustment.originalCashShiftId,
        direction: adjustment.direction,
        entryType: adjustment.entryType,
        paymentMethod: adjustment.paymentMethod,
        affectsDrawer: adjustment.affectsDrawer,
        amountCents: adjustment.amountCents,
      })),
      [
        {
          cashRegisterId: terminalCashRegister.id,
          originalCashShiftId: cashShift.id,
          direction: "out",
          entryType: "reversal",
          paymentMethod: "debit_card",
          affectsDrawer: false,
          amountCents: 450,
        },
      ],
    );
    assert.equal(
      (postCloseReversalEvent[0]?.metadata as { cashAdjustmentId?: string }).cashAdjustmentId,
      postCloseAdjustment[0]?.id,
    );
    const replacementAttempt = await service.createPaymentAttempt(
      identity.id,
      organization.id,
      unit.id,
      tab.id,
      `replacement-after-reversal-${runId}`,
      { installationId: device.id, method: "pix", amountCents: 600, installments: 1 },
    );
    assert.equal(replacementAttempt.attempt.status, "created");
    const replacementClaim = await service.claimDevicePaymentAttempt(
      claimRequest(replacementAttempt.attempt.id),
      replacementAttempt.attempt.id,
    );
    assert.equal(replacementClaim.attempt.status, "processing");
    const repair = await smartPos.createPairingCode(identity.id, organization.id, unit.id, {
      label: "Rede Smart re-pareada",
      expiresInSeconds: 300,
    });
    const repairKeys = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const repairInput = {
      code: repair.code,
      installationId: device.id,
      publicKeySpki: repairKeys.publicKey
        .export({ type: "spki", format: "der" })
        .toString("base64"),
      diagnostics: reportedDiagnostics,
    };
    await assert.rejects(
      () => smartPos.redeemPairing(repairInput),
      (error: unknown) => {
        assert.equal(
          (error as { response?: { code?: string } }).response?.code,
          "PAYMENT_DEVICE_HAS_ACTIVE_OPERATIONS",
        );
        return true;
      },
    );
    const canceledReplacement = {
      resultId: `canceled-replacement-${runId}`,
      status: "canceled" as const,
      occurredAt: new Date().toISOString(),
    };
    await service.recordDevicePaymentResult(
      resultRequest(replacementAttempt.attempt.id, canceledReplacement),
      replacementAttempt.attempt.id,
      canceledReplacement,
    );
    const repairAttemptRace = await Promise.allSettled([
      smartPos.redeemPairing(repairInput),
      service.createPaymentAttempt(
        identity.id,
        organization.id,
        unit.id,
        tab.id,
        `attempt-repair-race-${runId}`,
        { installationId: device.id, method: "pix", amountCents: 600, installments: 1 },
      ),
    ]);
    assert.equal(repairAttemptRace.filter((result) => result.status === "fulfilled").length, 1);

    await database.db.insert(posTerminalProfiles).values({
      organizationId: organization.id,
      unitId: unit.id,
      installationId: otherDevice.id,
      label: "Outro terminal",
      mode: "waiter_mobile",
      paymentMode: "homologated_pos",
      defaultRoute: "counter",
      createdByIdentityId: identity.id,
      updatedByIdentityId: identity.id,
    });
    await service.configurePaymentTerminal(organization.id, unit.id, otherDevice.id, {
      provider: "rede",
      status: "homologated",
      certificationId,
      methods: ["credit_card", "debit_card", "pix"],
      maxInstallments: 12,
      supports: { cancel: true, recover: true, reversal: true },
    });
    assert.equal(
      (await service.getPaymentCapabilities(identity.id, organization.id, unit.id, otherDevice.id))
        .available,
      true,
    );
    const deterministicRepair = await smartPos.createPairingCode(
      identity.id,
      organization.id,
      unit.id,
      { label: "Outro terminal re-pareado", expiresInSeconds: 300 },
    );
    const deterministicRepairKeys = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const repaired = await smartPos.redeemPairing({
      code: deterministicRepair.code,
      installationId: otherDevice.id,
      publicKeySpki: deterministicRepairKeys.publicKey
        .export({ type: "spki", format: "der" })
        .toString("base64"),
      diagnostics: reportedDiagnostics,
    });
    assert.equal(repaired.capabilities.available, false);
    assert.equal(repaired.capabilities.certificationId, null);

    await service.configurePaymentTerminal(organization.id, unit.id, otherDevice.id, {
      provider: "rede",
      status: "homologated",
      certificationId,
      methods: ["credit_card", "debit_card", "pix"],
      maxInstallments: 12,
      supports: { cancel: true, recover: true, reversal: true },
    });
    await service.putTerminalProfile(
      identity.id,
      organization.id,
      unit.id,
      otherDevice.id,
      `rebound-other-profile-${runId}`,
      terminalProfileInput,
    );
    const revokedDeviceSigner = paymentDeviceSigner(
      repaired.credentialId,
      deterministicRepairKeys.privateKey,
    );
    const [revocationClaimTab, revocationResultTab, revocationReversalTab] = await database.db
      .insert(posTabs)
      .values([
        {
          organizationId: organization.id,
          unitId: unit.id,
          openedByIdentityId: identity.id,
          totalCents: 1_000,
        },
        {
          organizationId: organization.id,
          unitId: unit.id,
          openedByIdentityId: identity.id,
          totalCents: 1_000,
        },
        {
          organizationId: organization.id,
          unitId: unit.id,
          openedByIdentityId: identity.id,
          totalCents: 1_000,
        },
      ])
      .returning();
    assert.ok(revocationClaimTab && revocationResultTab && revocationReversalTab);
    const revocationClaimAttempt = await service.createPaymentAttempt(
      identity.id,
      organization.id,
      unit.id,
      revocationClaimTab.id,
      `revocation-claim-${runId}`,
      { installationId: otherDevice.id, method: "pix", amountCents: 400, installments: 1 },
    );
    const revocationResultAttempt = await service.createPaymentAttempt(
      identity.id,
      organization.id,
      unit.id,
      revocationResultTab.id,
      `revocation-result-${runId}`,
      { installationId: otherDevice.id, method: "pix", amountCents: 500, installments: 1 },
    );
    const revocationReversalAttempt = await service.createPaymentAttempt(
      identity.id,
      organization.id,
      unit.id,
      revocationReversalTab.id,
      `revocation-reversal-${runId}`,
      { installationId: otherDevice.id, method: "pix", amountCents: 600, installments: 1 },
    );
    const signedRevocationClaim = (attemptId: string) =>
      revokedDeviceSigner("POST", `/api/v1/device/payment-attempts/${attemptId}/claim`);
    await service.claimDevicePaymentAttempt(
      signedRevocationClaim(revocationResultAttempt.attempt.id),
      revocationResultAttempt.attempt.id,
    );
    await service.claimDevicePaymentAttempt(
      signedRevocationClaim(revocationReversalAttempt.attempt.id),
      revocationReversalAttempt.attempt.id,
    );
    const approvedForReversal = {
      resultId: randomUUID(),
      status: "approved" as const,
      providerReference: `rede-revoke-base-${runId}`,
      authorizationCode: "RVK123",
      occurredAt: new Date().toISOString(),
    };
    const approvedReversalBase = await service.recordDevicePaymentResult(
      revokedDeviceSigner(
        "POST",
        `/api/v1/device/payment-attempts/${revocationReversalAttempt.attempt.id}/result`,
        approvedForReversal,
      ),
      revocationReversalAttempt.attempt.id,
      approvedForReversal,
    );
    assert.ok(approvedReversalBase.paymentId);
    const pendingRevocationReversal = await service.requestPaymentReversal(
      identity.id,
      organization.id,
      unit.id,
      approvedReversalBase.paymentId,
      `revocation-reversal-request-${runId}`,
      { reason: "Teste de serialização com revogação" },
    );

    let releaseInstallationLock = () => {};
    let markInstallationLockHeld = () => {};
    const installationLockHeld = new Promise<void>((resolve) => {
      markInstallationLockHeld = resolve;
    });
    const installationLockRelease = new Promise<void>((resolve) => {
      releaseInstallationLock = resolve;
    });
    const lockBlocker = database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${smartPosInstallationLockKey(organization.id, unit.id, otherDevice.id)}))`,
      );
      markInstallationLockHeld();
      await installationLockRelease;
    });
    await installationLockHeld;
    const waiterBaseline = await advisoryWaiterCount(database);
    const revocation = organizationService.revokeDevice(
      identity.id,
      organization.id,
      unit.id,
      otherDevice.id,
    );
    await waitForAdditionalAdvisoryWaiter(database, waiterBaseline);
    const resultAfterRevocation = {
      resultId: randomUUID(),
      status: "approved" as const,
      providerReference: `rede-revoke-race-${runId}`,
      authorizationCode: "RVK456",
      occurredAt: new Date().toISOString(),
    };
    const operationsQueuedBehindRevocation = Promise.allSettled([
      service.claimDevicePaymentAttempt(
        signedRevocationClaim(revocationClaimAttempt.attempt.id),
        revocationClaimAttempt.attempt.id,
      ),
      service.recordDevicePaymentResult(
        revokedDeviceSigner(
          "POST",
          `/api/v1/device/payment-attempts/${revocationResultAttempt.attempt.id}/result`,
          resultAfterRevocation,
        ),
        revocationResultAttempt.attempt.id,
        resultAfterRevocation,
      ),
      service.claimDevicePaymentReversal(
        revokedDeviceSigner(
          "POST",
          `/api/v1/device/payment-reversals/${pendingRevocationReversal.reversal.id}/claim`,
        ),
        pendingRevocationReversal.reversal.id,
      ),
    ]);
    releaseInstallationLock();
    await lockBlocker;
    await revocation;
    const revokedOperations = await operationsQueuedBehindRevocation;
    assert.equal(
      revokedOperations.every((result) => result.status === "rejected"),
      true,
    );
    for (const result of revokedOperations) {
      if (result.status !== "rejected") continue;
      assert.ok(
        ["PAYMENT_DEVICE_CREDENTIAL_INVALID", "PAYMENT_DEVICE_REVOKED"].includes(
          (result.reason as { response?: { code?: string } }).response?.code ?? "",
        ),
      );
    }
    const [
      [revokedDevice],
      revokedCredentials,
      [claimAfter],
      [resultAfter],
      [reversalAfter],
      racePayment,
    ] = await Promise.all([
      database.db
        .select({ revokedAt: deviceEnrollments.revokedAt })
        .from(deviceEnrollments)
        .where(eq(deviceEnrollments.id, otherDevice.id)),
      database.db
        .select({ revokedAt: posPaymentDeviceCredentials.revokedAt })
        .from(posPaymentDeviceCredentials)
        .where(
          and(
            eq(posPaymentDeviceCredentials.organizationId, organization.id),
            eq(posPaymentDeviceCredentials.unitId, unit.id),
            eq(posPaymentDeviceCredentials.installationId, otherDevice.id),
          ),
        ),
      database.db
        .select({ status: posPaymentAttempts.status })
        .from(posPaymentAttempts)
        .where(eq(posPaymentAttempts.id, revocationClaimAttempt.attempt.id)),
      database.db
        .select({ status: posPaymentAttempts.status })
        .from(posPaymentAttempts)
        .where(eq(posPaymentAttempts.id, revocationResultAttempt.attempt.id)),
      database.db
        .select({ status: posPaymentReversals.status })
        .from(posPaymentReversals)
        .where(eq(posPaymentReversals.id, pendingRevocationReversal.reversal.id)),
      database.db
        .select({ id: posTabPayments.id })
        .from(posTabPayments)
        .where(eq(posTabPayments.paymentAttemptId, revocationResultAttempt.attempt.id)),
    ]);
    assert.ok(revokedDevice?.revokedAt);
    assert.equal(revokedCredentials.length > 0, true);
    assert.equal(
      revokedCredentials.every((credential) => credential.revokedAt !== null),
      true,
    );
    assert.equal(claimAfter?.status, "created");
    assert.equal(resultAfter?.status, "processing");
    assert.equal(reversalAfter?.status, "pending");
    assert.equal(racePayment.length, 0);
  } finally {
    await database.onModuleDestroy();
  }
});
