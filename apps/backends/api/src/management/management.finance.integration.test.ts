import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { identities, memberships, organizations, roleBindings, units } from "@giromesa/db";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { ManagementService } from "./management.service.js";

it("persists the finance lifecycle with approval, reversal and reconciliation", async (context) => {
  const databaseUrl = process.env.MANAGEMENT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    context.skip("MANAGEMENT_DATABASE_URL or DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const mediaRoot = await mkdtemp(join(tmpdir(), "giromesa-finance-"));
  const previousMediaRoot = process.env.MEDIA_ROOT;
  const previousScanMode = process.env.ACCOUNTANT_ATTACHMENT_SCAN_MODE;
  process.env.MEDIA_ROOT = mediaRoot;
  process.env.ACCOUNTANT_ATTACHMENT_SCAN_MODE = "disabled";
  const database = new DatabaseService();
  try {
    const suffix = randomUUID();
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: `Finance integration ${suffix}`,
        tradeName: "Finance integration",
        document: suffix.replace(/-/g, "").slice(0, 14),
      })
      .returning({ id: organizations.id });
    assert.ok(organization);
    const organizationId = organization.id;
    const [unit] = await database.db
      .insert(units)
      .values({ organizationId, name: "Finance unit", timezone: "America/Sao_Paulo" })
      .returning({ id: units.id });
    const people = await database.db
      .insert(identities)
      .values([
        { email: `finance-requester-${suffix}@example.test`, displayName: "Requester" },
        { email: `finance-approver-${suffix}@example.test`, displayName: "Approver" },
      ])
      .returning({ id: identities.id });
    assert.ok(unit && people[0] && people[1]);
    const memberRows = await database.db
      .insert(memberships)
      .values(
        people.map((identity) => ({
          identityId: identity.id,
          organizationId,
          status: "active" as const,
        })),
      )
      .returning({ id: memberships.id });
    await database.db
      .insert(roleBindings)
      .values(
        memberRows.map((membership) => ({ membershipId: membership.id, role: "owner" as const })),
      );

    const management = new ManagementService(database, new ScopeService(database));
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const uploaded = await management.uploadFinanceAttachment(
      people[0].id,
      organizationId,
      unit.id,
      `finance-attachment-${suffix}`,
      {
        fileName: "comprovante.png",
        contentType: "image/png",
        contentBase64: png.toString("base64"),
      },
    );
    assert.ok(uploaded.attachment.id);
    const downloaded = await management.financeAttachment(
      people[0].id,
      organizationId,
      unit.id,
      uploaded.attachment.id,
    );
    assert.deepEqual(Buffer.from(downloaded.content, "base64"), png);
    await management.updateFinanceSettings(
      people[0].id,
      organizationId,
      unit.id,
      `finance-settings-${suffix}`,
      {
        paymentApprovalThresholdCents: 10_000,
        requireDistinctApprover: true,
        dueSoonDays: 10,
      },
    );
    const payable = await management.createPayable(
      people[0].id,
      organizationId,
      unit.id,
      `finance-payable-${suffix}`,
      {
        description: "Aluguel",
        amountCents: 20_000,
        competenceDate: "2026-01-31",
        dueDate: "2026-01-31",
        attachments: [{ id: uploaded.attachment.id, name: uploaded.attachment.name }],
        recurrence: { installments: 2, intervalMonths: 1 },
      },
    );
    assert.equal(payable.installmentCount, 2);
    const approval = await management.requestFinanceApproval(
      people[0].id,
      organizationId,
      unit.id,
      `finance-approval-${suffix}`,
      {
        direction: "payable",
        entryId: payable.payableId,
        amountCents: 20_000,
        method: "pix",
      },
    );
    await management.decideFinanceApproval(
      people[1].id,
      organizationId,
      unit.id,
      approval.approvalRequestId,
      `finance-decision-${suffix}`,
      { decision: "approve" },
    );
    const payment = await management.payPayable(
      people[0].id,
      organizationId,
      unit.id,
      payable.payableId,
      `finance-payment-${suffix}`,
      {
        amountCents: 20_000,
        method: "pix",
        approvalRequestId: approval.approvalRequestId,
      },
    );
    await management.reversePayablePayment(
      people[0].id,
      organizationId,
      unit.id,
      payment.paymentId,
      `finance-reversal-${suffix}`,
      { reason: "Pagamento duplicado" },
    );
    const canceled = await management.cancelPayable(
      people[0].id,
      organizationId,
      unit.id,
      payable.payableId,
      `finance-cancel-${suffix}`,
      { reason: "Contrato rescindido", version: 3 },
    );
    assert.equal(canceled.status, "canceled");
    assert.equal(
      (
        await management.cancelPayable(
          people[0].id,
          organizationId,
          unit.id,
          payable.payableId,
          `finance-cancel-${suffix}`,
          { reason: "Contrato rescindido", version: 3 },
        )
      ).status,
      "canceled",
    );

    const receivable = await management.createReceivable(
      people[0].id,
      organizationId,
      unit.id,
      `finance-receivable-${suffix}`,
      {
        description: "Evento",
        amountCents: 5_000,
        competenceDate: "2026-02-01",
        dueDate: "2026-02-10",
        attachments: [],
        lines: [],
      },
    );
    const received = await management.receiveReceivable(
      people[0].id,
      organizationId,
      unit.id,
      receivable.receivableId,
      `finance-received-${suffix}`,
      { amountCents: 5_000, method: "pix" },
    );
    const imported = await management.importReconciliation(
      people[0].id,
      organizationId,
      unit.id,
      `finance-reconciliation-${suffix}`,
      {
        source: "imported",
        fileHash: suffix.replace(/-/g, "").padEnd(64, "0"),
        entries: [
          {
            paymentDirection: "receivable",
            externalKey: `bank-${suffix}`,
            grossCents: 5_000,
            feeCents: 0,
            netCents: 5_000,
            status: "matched",
            paymentId: received.paymentId,
          },
        ],
      },
    );
    assert.equal(imported.providerConnected, false);
    const dashboard = await management.financeDashboard(people[0].id, organizationId, unit.id, {
      direction: "all",
      status: "all",
      search: "",
      page: 1,
      pageSize: 25,
    });
    assert.equal(dashboard.entries.length, 3);
    assert.equal(dashboard.reconciliationEntries[0]?.status, "matched");
    assert.equal(dashboard.payablePayments[0]?.status, "reversed");
  } finally {
    await database.onModuleDestroy();
    await rm(mediaRoot, { force: true, recursive: true });
    if (previousMediaRoot === undefined) delete process.env.MEDIA_ROOT;
    else process.env.MEDIA_ROOT = previousMediaRoot;
    if (previousScanMode === undefined) delete process.env.ACCOUNTANT_ATTACHMENT_SCAN_MODE;
    else process.env.ACCOUNTANT_ATTACHMENT_SCAN_MODE = previousScanMode;
  }
});
