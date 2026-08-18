import { expect, type Page, test } from "@playwright/test";

const organizationId = "org-1";
const unitId = "unit-1";
const supplier = { id: "supplier-1", name: "Fornecedor Norte", active: true };
const inventory = {
  locations: [{ id: "location-1", name: "Estoque seco", code: "SECO", active: true }],
  items: [
    {
      id: "item-1",
      productId: null,
      preferredSupplierId: supplier.id,
      name: "Arroz",
      sku: null,
      barcode: null,
      unit: "kg",
      purchaseUnit: "saco",
      purchaseToStockFactor: 1,
      minimumQuantity: 2,
      reorderQuantity: 6,
      leadTimeDays: 1,
      allowNegative: false,
      active: true,
    },
    {
      id: "item-2",
      productId: null,
      preferredSupplierId: supplier.id,
      name: "Feijão",
      sku: null,
      barcode: null,
      unit: "kg",
      purchaseUnit: null,
      purchaseToStockFactor: 1,
      minimumQuantity: 2,
      reorderQuantity: 6,
      leadTimeDays: 1,
      allowNegative: false,
      active: true,
    },
  ],
  balances: [],
  lots: [],
  recentMovements: [],
  automation: { pending: 0, failed: 0, lastProcessedAt: null },
};

type Calls = {
  create: Record<string, unknown>[];
  createKeys: string[];
  approve: Record<string, unknown>[];
  receipt: Record<string, unknown>[];
  invoice: Record<string, unknown>[];
  reconcile: number;
  confirm: Record<string, unknown>[];
  reverseReceipt: Record<string, unknown>[];
  cancelInvoice: Record<string, unknown>[];
};

function emptyCalls(): Calls {
  return {
    create: [],
    createKeys: [],
    approve: [],
    receipt: [],
    invoice: [],
    reconcile: 0,
    confirm: [],
    reverseReceipt: [],
    cancelInvoice: [],
  };
}

async function mockPurchasesApi(
  page: Page,
  calls: Calls,
  failNextCreate = false,
  capabilityOverrides: Record<string, boolean> = {},
  failApprove = false,
  seedReady = false,
  profileRole = "manager",
) {
  let shouldFailCreate = failNextCreate;
  let orders: Record<string, unknown>[] = [];
  let items: Record<string, unknown>[] = [];
  let receipts: Record<string, unknown>[] = [];
  let invoices: Record<string, unknown>[] = [];
  if (seedReady) {
    orders = [
      {
        id: "purchase-1",
        humanNumber: 1,
        version: 3,
        supplierId: supplier.id,
        status: "received",
        totalCents: 1_000,
        createdAt: "2026-08-16T12:00:00.000Z",
      },
    ];
    items = [
      {
        id: "line-1",
        purchaseOrderId: "purchase-1",
        inventoryItemId: "item-1",
        quantity: "1",
        receivedQuantity: "1",
        unitCostCents: 1_000,
        totalCents: 1_000,
      },
    ];
    receipts = [
      {
        id: "receipt-1",
        purchaseOrderId: "purchase-1",
        status: "posted",
        version: 1,
      },
    ];
    invoices = [
      {
        id: "invoice-1",
        purchaseOrderId: "purchase-1",
        documentNumber: "NF-42",
        status: "matched",
        totalCents: 1_000,
        version: 2,
        reconciliation: {
          matched: true,
          lines: [
            {
              purchaseOrderItemId: "line-1",
              orderedQuantity: "1",
              receivedQuantity: "1",
              invoicedQuantity: "1",
              orderedUnitCostCents: 1_000,
              invoicedUnitCostCents: 1_000,
              matched: true,
            },
          ],
        },
      },
    ];
  }

  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const purchasesPath = `/v1/organizations/${organizationId}/units/${unitId}/management/purchases`;

    if (method === "GET" && path === purchasesPath) {
      await route.fulfill({
        json: {
          orders,
          items,
          receipts,
          receiptLines: [],
          suppliers: [supplier],
          invoices,
          invoiceLines: invoices.length
            ? [
                {
                  id: "invoice-line-1",
                  invoiceId: "invoice-1",
                  purchaseOrderItemId: "line-1",
                  inventoryItemId: "item-1",
                  quantity: "1",
                  unitCostCents: 1_000,
                  totalCents: 1_000,
                },
              ]
            : [],
          suggestions: [],
          metrics: {
            orderCount: orders.length,
            pendingCount: orders.length,
            divergentInvoiceCount: 0,
          },
          capabilities: {
            canCreate: true,
            canApprove: true,
            canReceive: true,
            canInvoice: true,
            canReconcile: true,
            canConfirmInvoice: true,
            canReverseReceipt: true,
            canCancelInvoice: true,
            ...capabilityOverrides,
          },
          pagination: { page: 1, pageSize: 25, total: orders.length },
        },
      });
      return;
    }
    if (method === "POST" && path === purchasesPath) {
      const body = request.postDataJSON() as { items: Array<Record<string, unknown>> };
      calls.create.push(body);
      calls.createKeys.push(request.headers()["idempotency-key"] ?? "");
      if (shouldFailCreate) {
        shouldFailCreate = false;
        await route.fulfill({ status: 422, json: { message: "Custo inválido para aprovação." } });
        return;
      }
      orders = [
        {
          id: "purchase-1",
          humanNumber: 1,
          version: 1,
          supplierId: supplier.id,
          status: "draft",
          totalCents: 3_000,
          expectedAt: null,
          approvedAt: null,
          approvedByIdentityId: null,
          rejectedAt: null,
          rejectedByIdentityId: null,
          rejectionReason: null,
          canceledAt: null,
          cancelReason: null,
          createdAt: "2026-08-16T12:00:00.000Z",
          updatedAt: null,
          notes: null,
        },
      ];
      items = body.items.map((line, index) => ({
        id: `line-${index + 1}`,
        purchaseOrderId: "purchase-1",
        inventoryItemId: line.inventoryItemId,
        quantity: line.quantity,
        unitCostCents: line.unitCostCents,
        receivedQuantity: "0",
        totalCents: line.unitCostCents,
        purchaseUnit: "un",
        stockUnit: "kg",
        purchaseToStockFactor: 1,
      }));
      await route.fulfill({ status: 201, json: orders[0] });
      return;
    }
    if (method === "POST" && path.endsWith("/purchases/purchase-1/approve")) {
      calls.approve.push(request.postDataJSON() as Record<string, unknown>);
      if (failApprove) {
        await route.fulfill({
          status: 409,
          json: { message: "O pedido foi alterado por outra operação." },
        });
        return;
      }
      orders = orders.map((order) => ({
        ...order,
        status: "approved",
        approvedAt: "2026-08-16T12:01:00.000Z",
        version: 2,
      }));
      await route.fulfill({ json: orders[0] });
      return;
    }
    if (method === "POST" && path.endsWith("/purchases/purchase-1/receipts")) {
      const body = request.postDataJSON() as { lines: Array<Record<string, unknown>> };
      calls.receipt.push(body);
      items = items.map((item) =>
        item.id === body.lines[0]?.purchaseOrderItemId
          ? { ...item, receivedQuantity: body.lines[0].quantity }
          : item,
      );
      orders = orders.map((order) => ({ ...order, status: "partially_received" }));
      receipts = [
        {
          id: "receipt-1",
          purchaseOrderId: "purchase-1",
          status: "posted",
          version: 1,
          lines: body.lines,
        },
      ];
      await route.fulfill({ status: 201, json: receipts[0] });
      return;
    }
    if (method === "POST" && path.endsWith("/purchases/purchase-1/invoices")) {
      const body = request.postDataJSON() as Record<string, unknown>;
      calls.invoice.push(body);
      invoices = [
        {
          id: "invoice-1",
          purchaseOrderId: "purchase-1",
          documentNumber: body.documentNumber,
          accessKey: body.accessKey ?? null,
          series: body.series ?? null,
          model: body.model ?? null,
          taxTotalCents: body.taxTotalCents ?? null,
          status: "pending_reconciliation",
          totalCents: body.totalCents,
          issuedAt: body.issuedAt,
          competenceDate: body.competenceDate,
          dueDate: body.dueDate,
          payableId: null,
          reconciliation: null,
          reconciledAt: null,
          confirmedAt: null,
          confirmedByIdentityId: null,
          version: 1,
        },
      ];
      await route.fulfill({ status: 201, json: invoices[0] });
      return;
    }
    if (method === "POST" && path.endsWith("/purchases/invoices/invoice-1/reconcile")) {
      calls.reconcile += 1;
      invoices = invoices.map((invoice) => ({
        ...invoice,
        status: "matched",
        reconciliation: {
          matched: true,
          lines: items.map((item) => ({
            purchaseOrderItemId: item.id,
            orderedQuantity: item.quantity,
            receivedQuantity: item.receivedQuantity,
            invoicedQuantity: item.quantity,
            orderedUnitCostCents: item.unitCostCents,
            invoicedUnitCostCents: item.unitCostCents,
            matched: true,
          })),
        },
        version: 2,
      }));
      await route.fulfill({ json: invoices[0] });
      return;
    }
    if (method === "POST" && path.endsWith("/purchases/receipts/receipt-1/reverse")) {
      calls.reverseReceipt.push(request.postDataJSON() as Record<string, unknown>);
      receipts = receipts.map((receipt) => ({ ...receipt, status: "reversed", version: 2 }));
      await route.fulfill({ json: receipts[0] });
      return;
    }
    if (method === "POST" && path.endsWith("/purchases/invoices/invoice-1/cancel")) {
      calls.cancelInvoice.push(request.postDataJSON() as Record<string, unknown>);
      invoices = invoices.map((invoice) => ({ ...invoice, status: "reversed", version: 4 }));
      await route.fulfill({ json: invoices[0] });
      return;
    }
    if (method === "POST" && path.endsWith("/purchases/invoices/invoice-1/confirm")) {
      calls.confirm.push(request.postDataJSON() as Record<string, unknown>);
      invoices = invoices.map((invoice) => ({ ...invoice, status: "confirmed", version: 3 }));
      await route.fulfill({ json: invoices[0] });
      return;
    }

    const payload =
      path === "/v1/auth/me"
        ? {
            identity: { id: "identity-1", email: "manager@giromesa.test", displayName: "Gerente" },
            memberships: [{ membershipId: "membership-1", organizationId, status: "active" }],
            platformAdmin: false,
          }
        : path === "/v1/organizations"
          ? [
              {
                membershipId: "membership-1",
                organization: {
                  id: organizationId,
                  tradeName: "Grupo Aurora",
                  document: "12345678000199",
                },
                units: [
                  {
                    id: unitId,
                    name: "Matriz",
                    city: "São Paulo",
                    timezone: "America/Sao_Paulo",
                    active: true,
                  },
                ],
                scopes: [{ role: profileRole, unitId }],
              },
            ]
          : method === "GET" && path.endsWith("/management/inventory")
            ? inventory
            : method === "GET" && path.endsWith("/management/suppliers")
              ? { items: [supplier], pagination: { page: 1, pageSize: 25, total: 1 } }
              : null;
    if (payload === null) {
      await route.fulfill({ status: 404, json: { message: `Mock ausente para ${path}` } });
      return;
    }
    await route.fulfill({ json: payload });
  });
}

async function openPurchases(
  page: Page,
  calls: Calls,
  failNextCreate = false,
  capabilityOverrides: Record<string, boolean> = {},
  failApprove = false,
  seedReady = false,
  profileRole = "manager",
) {
  await mockPurchasesApi(
    page,
    calls,
    failNextCreate,
    capabilityOverrides,
    failApprove,
    seedReady,
    profileRole,
  );
  await page.goto("/");
  await page.evaluate(() => {
    window.location.hash = "#/purchases";
  });
  await page.getByRole("button", { name: "Abrir operação" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Compras" })).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBe(dimensions.viewport);
}

test("gerente cria pedido multilinha, aprova, recebe parcialmente e concilia fatura", async ({
  page,
}) => {
  const calls = emptyCalls();
  await openPurchases(page, calls);

  await page.getByRole("button", { name: "Novo pedido" }).click();
  const purchaseDialog = page.getByRole("dialog", { name: "Novo pedido de compra" });
  await purchaseDialog.getByLabel("Fornecedor").selectOption(supplier.id);
  await purchaseDialog.getByLabel("Item de estoque").first().selectOption("item-1");
  await purchaseDialog.getByLabel("Quantidade").first().fill("2");
  await purchaseDialog.getByLabel("Custo unitário (R$)").first().fill("10,00");
  await purchaseDialog.getByRole("button", { name: "Adicionar item" }).click();
  await purchaseDialog.getByLabel("Item de estoque").nth(1).selectOption("item-2");
  await purchaseDialog.getByLabel("Quantidade").nth(1).fill("1");
  await purchaseDialog.getByLabel("Custo unitário (R$)").nth(1).fill("10,00");
  await purchaseDialog.getByRole("button", { name: "Criar pedido" }).click();
  await expect.poll(() => calls.create.length).toBe(1);
  expect(calls.create[0]?.items as unknown[]).toHaveLength(2);

  await page.getByRole("button", { name: "Aprovar" }).click();
  await expect.poll(() => calls.approve.length).toBe(1);
  expect(calls.approve[0]).toEqual({ version: 1 });

  await page.getByRole("button", { name: "Receber" }).click();
  const receiptDialog = page.getByRole("dialog", { name: /Receber/ });
  await receiptDialog.getByLabel("Local de entrada").first().selectOption("location-1");
  await receiptDialog.getByLabel("Quantidade").first().fill("1");
  await receiptDialog.getByLabel("Lote").first().fill("LT-2026");
  await receiptDialog.getByLabel("Validade").first().fill("2026-12-31");
  await receiptDialog.getByRole("button", { name: "Confirmar recebimento" }).click();
  await expect.poll(() => calls.receipt.length).toBe(1);
  expect((calls.receipt[0]?.lines as Record<string, unknown>[])[0]).toMatchObject({
    batchCode: "LT-2026",
    quantity: "1",
  });

  await page.getByRole("button", { name: "Fatura", exact: true }).click();
  const invoiceDialog = page.getByRole("dialog", { name: "Registrar fatura" });
  await invoiceDialog.getByLabel("Documento fiscal / fatura").fill("NF-42");
  await invoiceDialog.getByLabel("Chave de acesso NF-e (44 dígitos)").fill("1".repeat(44));
  await invoiceDialog.getByLabel("Série").fill("1");
  await invoiceDialog.getByLabel("Total de tributos (R$)").fill("2,50");
  await invoiceDialog.getByLabel("XML da NF-e (opcional, até 2 MB)").setInputFiles({
    name: "nfe.xml",
    mimeType: "application/xml",
    buffer: Buffer.from(`<NFe><chNFe>${"1".repeat(44)}</chNFe></NFe>`),
  });
  await invoiceDialog.getByLabel("Emissão", { exact: true }).fill("2026-08-16");
  await invoiceDialog.getByLabel("Competência").fill("2026-08-16");
  await invoiceDialog.getByLabel("Vencimento").fill("2026-09-16");
  await invoiceDialog.getByLabel("Tolerância para conciliação (R$)").fill("0,10");
  await invoiceDialog.getByRole("button", { name: "Registrar fatura" }).click();
  await expect.poll(() => calls.invoice.length).toBe(1);
  expect(calls.invoice[0]).toMatchObject({
    documentNumber: "NF-42",
    issuedAt: "2026-08-16",
    competenceDate: "2026-08-16",
    dueDate: "2026-09-16",
    totalCents: 3_000,
    toleranceCents: 10,
    confirmIfMatched: true,
    accessKey: "1".repeat(44),
    series: "1",
    model: "55",
    taxTotalCents: 250,
  });
  expect(calls.invoice[0]?.xmlContent).toContain("<NFe>");
  expect(calls.invoice[0]?.lines as unknown[]).toHaveLength(2);
  await page.getByRole("button", { name: "Fatura", exact: true }).click();
  const reconciliationDialog = page.getByRole("dialog", { name: "Registrar fatura" });
  await reconciliationDialog.getByRole("button", { name: "Conciliar" }).click();
  await expect.poll(() => calls.reconcile).toBe(1);
  await expect(reconciliationDialog.getByText("Conciliação por item")).toBeVisible();
  await expect(reconciliationDialog.getByText("Conforme").first()).toBeVisible();
  await reconciliationDialog.getByRole("button", { name: "Confirmar" }).click();
  await expect.poll(() => calls.confirm.length).toBe(1);
  expect(calls.confirm[0]).toEqual({ acceptDivergence: false, version: 2 });
  await reconciliationDialog.getByRole("button", { name: "Cancelar", exact: true }).click();

  await page.getByRole("button", { name: "Estornar recebimento" }).click();
  const reverseDialog = page.getByRole("dialog", { name: "Estornar recebimento" });
  await reverseDialog.getByLabel("Motivo").fill("Recebimento registrado em duplicidade");
  await reverseDialog.getByRole("button", { name: "Confirmar ação" }).click();
  await expect.poll(() => calls.reverseReceipt.length).toBe(1);
  expect(calls.reverseReceipt[0]).toEqual({
    reason: "Recebimento registrado em duplicidade",
    version: 1,
  });

  await page.getByRole("button", { name: "Cancelar fatura" }).click();
  const cancelInvoiceDialog = page.getByRole("dialog", { name: "Cancelar fatura" });
  await cancelInvoiceDialog.getByLabel("Motivo").fill("Documento fiscal substituído");
  await cancelInvoiceDialog.getByRole("button", { name: "Confirmar ação" }).click();
  await expect.poll(() => calls.cancelInvoice.length).toBe(1);
  expect(calls.cancelInvoice[0]).toEqual({ reason: "Documento fiscal substituído", version: 3 });

  await page.setViewportSize({ width: 375, height: 812 });
  await expectNoHorizontalOverflow(page);
});

test("perfil de estoque vê conciliação e estorno sem ações financeiras", async ({ page }) => {
  const calls = emptyCalls();
  await openPurchases(
    page,
    calls,
    false,
    {
      canApprove: false,
      canConfirmInvoice: false,
      canReverseReceipt: true,
      canCancelInvoice: false,
    },
    false,
    true,
    "inventory",
  );

  await expect(page.getByRole("button", { name: "Estornar recebimento" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancelar fatura" })).toHaveCount(0);
  await page.getByRole("button", { name: "Fatura", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Registrar fatura" });
  await expect(dialog.getByRole("button", { name: "Conciliar" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Confirmar" })).toHaveCount(0);
});

test("conflito de versão mantém pedido pendente e orienta recarregar", async ({ page }) => {
  const calls = emptyCalls();
  await openPurchases(page, calls, false, {}, true);

  await page.getByRole("button", { name: "Novo pedido" }).click();
  const dialog = page.getByRole("dialog", { name: "Novo pedido de compra" });
  await dialog.getByLabel("Fornecedor").selectOption(supplier.id);
  await dialog.getByLabel("Item de estoque").selectOption("item-1");
  await dialog.getByLabel("Quantidade").fill("1");
  await dialog.getByLabel("Custo unitário (R$)").fill("10,00");
  await dialog.getByRole("button", { name: "Criar pedido" }).click();
  await page.getByRole("button", { name: "Aprovar" }).click();

  await expect(page.getByRole("alert")).toContainText("alterado por outra operação");
  expect(calls.approve[0]).toEqual({ version: 1 });
  await expect(page.getByRole("button", { name: "Aprovar" })).toBeVisible();
});

test("erro do pedido mantém o formulário preenchido", async ({ page }) => {
  const calls = emptyCalls();
  await openPurchases(page, calls, true);

  await page.getByRole("button", { name: "Novo pedido" }).click();
  const dialog = page.getByRole("dialog", { name: "Novo pedido de compra" });
  await dialog.getByLabel("Fornecedor").selectOption(supplier.id);
  await dialog.getByLabel("Item de estoque").selectOption("item-1");
  await dialog.getByLabel("Quantidade").fill("2");
  await dialog.getByLabel("Custo unitário (R$)").fill("10,00");
  await dialog.getByRole("button", { name: "Criar pedido" }).click();

  await expect(page.getByRole("alert")).toContainText("Custo inválido");
  await expect(dialog.getByLabel("Quantidade")).toHaveValue("2");
  await expect(dialog.getByLabel("Custo unitário (R$)")).toHaveValue("10,00");
  await dialog.getByRole("button", { name: "Criar pedido" }).click();
  await expect.poll(() => calls.create.length).toBe(2);
  expect(calls.createKeys).toHaveLength(2);
  expect(calls.createKeys[1]).toBe(calls.createKeys[0]);
});
