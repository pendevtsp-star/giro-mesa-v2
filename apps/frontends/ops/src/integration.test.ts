import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, resolveSecurityUrl } from "./api";
import { parseShellContext, sendShellCommand, sendShellPrintJob } from "./bridge";
import { createCommand, enqueueCommand, queuedCommandCount, removeQueuedCommand } from "./commands";
import {
  parsePeople,
  parsePeopleDirectory,
  parsePeopleIndicators,
  parsePurchases,
  parseSuppliers,
} from "./management.shared";
import { parsePilotCatalog } from "./operations.shared";

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
});
vi.stubGlobal("crypto", { randomUUID: () => "11111111-1111-4111-8111-111111111111" });

beforeEach(() => storage.clear());

describe("integração operacional", () => {
  it("aceita apenas URL web para a segurança da conta", () => {
    expect(resolveSecurityUrl("https://conta.giromesa.com.br/app?return=unsafe#x")).toBe(
      "https://conta.giromesa.com.br/app/seguranca",
    );
    expect(resolveSecurityUrl("javascript:alert(1)")).toBeNull();
  });

  it("cria o envelope aceito pelo contrato e preserva idempotência na fila", () => {
    const command = createCommand(
      "22222222-2222-4222-8222-222222222222",
      "order.item_added",
      { productId: "burger", quantity: 1 },
      new Date("2026-08-09T20:00:00.000Z"),
    );
    expect(command).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      deviceId: "22222222-2222-4222-8222-222222222222",
      type: "order.item_added",
      version: 1,
      occurredAt: "2026-08-09T20:00:00.000Z",
      idempotencyKey: "22222222-2222-4222-8222-222222222222:11111111-1111-4111-8111-111111111111",
      payload: { productId: "burger", quantity: 1 },
    });
    expect(enqueueCommand(command)).toBe(1);
    expect(queuedCommandCount()).toBe(1);
    expect(removeQueuedCommand(command.id)).toBe(0);
    expect(queuedCommandCount()).toBe(0);
  });

  it("envia comando e escopo ao bridge nativo", async () => {
    const invoke = vi.fn().mockResolvedValue({ Success: true, Duplicate: false });
    vi.stubGlobal("window", { HybridWebView: { InvokeDotNet: invoke } });
    const command = createCommand(
      "22222222-2222-4222-8222-222222222222",
      "order.created",
      {},
      new Date("2026-08-09T20:00:00.000Z"),
    );

    await expect(sendShellCommand("org-1", "unit-1", "actor-1", command)).resolves.toEqual({
      success: true,
      duplicate: false,
      errorCode: undefined,
    });
    expect(invoke).toHaveBeenCalledWith("SendCommandAsync", [
      "org-1",
      "unit-1",
      "actor-1",
      JSON.stringify(command),
    ]);
  });

  it("entrega a tentativa de impressão ao bridge com a mesma chave idempotente", async () => {
    const invoke = vi.fn().mockResolvedValue({
      Success: true,
      Status: "accepted",
      PrinterId: "caixa",
      Duplicate: false,
    });
    vi.stubGlobal("window", { HybridWebView: { InvokeDotNet: invoke } });
    const job = { id: "print-1", documentType: "partial_statement", copies: 1, payload: {} };

    await expect(sendShellPrintJob(job, "print-1:1")).resolves.toEqual({
      success: true,
      status: "accepted",
      errorCode: undefined,
      printerId: "caixa",
      duplicate: false,
    });
    expect(invoke).toHaveBeenCalledWith("SendPrintJobAsync", [JSON.stringify(job), "print-1:1"]);
  });

  it("normaliza contexto PascalCase do MAUI e ignora mensagens inválidas", () => {
    expect(
      parseShellContext(
        JSON.stringify({
          type: "shell.context",
          payload: {
            DeviceId: "33333333-3333-4333-8333-333333333333",
            DeviceName: "Caixa 01",
            Platform: "WinUI",
            HubUrl: "http://giromesa-hub.local:43120",
          },
        }),
      ),
    ).toEqual({
      embedded: true,
      deviceId: "33333333-3333-4333-8333-333333333333",
      deviceName: "Caixa 01",
      platform: "WinUI",
      hubUrl: "http://giromesa-hub.local:43120",
    });
    expect(parseShellContext("not-json")).toBeNull();
  });

  it("converte erro real da API em falha tratável", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          statusCode: 402,
          code: "OPERATION_RESTRICTED",
          message: "Novas operações estão bloqueadas.",
        }),
        { status: 402, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.health()).rejects.toMatchObject({
      status: 402,
      code: "OPERATION_RESTRICTED",
      message: "Novas operações estão bloqueadas.",
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/health"),
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("apresenta limite temporário da API em linguagem operacional", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "Rate limit exceeded" }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "29" },
        }),
      ),
    );

    await expect(
      api.management.reports("org-1", "unit-1", {
        from: "2026-08-01",
        to: "2026-08-31",
        comparisonMode: "previous_period",
      }),
    ).rejects.toMatchObject({
      status: 429,
      retryable: true,
      message: "Muitas solicitações em sequência. Aguarde 29 segundos e tente novamente.",
    });
  });

  it("não expõe a mensagem técnica de falhas internas", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ message: "Internal server error" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );

    await expect(
      api.management.reports("org-1", "unit-1", {
        from: "2026-08-01",
        to: "2026-08-16",
        comparisonMode: "previous_period",
      }),
    ).rejects.toMatchObject({
      status: 500,
      message: "O servidor não conseguiu concluir a consulta. Tente novamente em instantes.",
    });
  });

  it("consulta e atualiza delivery pela API autenticada", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify({ id: "delivery-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.growth.deliveryOrders("org-1", "unit-1", {
      status: "placed",
      query: "Fernanda",
      scheduled: true,
      sla: "overdue",
      updatedSince: "2026-08-16T20:00:00.000Z",
      limit: 20,
    });
    await api.growth.updateDeliveryZone("org-1", "zone-1", { active: false });
    await api.growth.transitionDelivery("org-1", "delivery-1", "confirmed");
    await api.growth.dispatchDelivery("org-1", "delivery-1", {
      courierReference: "courier-1",
      idempotencyKey: "delivery-dispatch-1",
    });
    await api.growth.assignDeliveryCourier("org-1", "delivery-1", {
      courierId: "courier-1",
      idempotencyKey: "delivery-assign-1",
    });
    await api.growth.createDeliveryCourier("org-1", {
      unitId: "unit-1",
      name: "João Motoboy",
      reference: "MOTO-01",
      phone: "11999999999",
      idempotencyKey: "delivery-courier-create-1",
    });
    await api.growth.requestDeliveryNotification("org-1", "delivery-1", {
      audience: "operations",
      type: "status_update",
      idempotencyKey: "delivery-notification-1",
    });

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "/v1/organizations/org-1/growth/units/unit-1/delivery-orders?status=placed&query=Fernanda&scheduled=true&sla=overdue",
        ),
        expect.stringContaining("/v1/organizations/org-1/growth/delivery-zones/zone-1"),
        expect.stringContaining("/v1/organizations/org-1/growth/delivery-orders/delivery-1/status"),
        expect.stringContaining(
          "/v1/organizations/org-1/growth/delivery-orders/delivery-1/dispatch",
        ),
        expect.stringContaining("/v1/organizations/org-1/growth/delivery-orders/delivery-1/assign"),
        expect.stringContaining("/v1/organizations/org-1/growth/delivery-couriers"),
        expect.stringContaining(
          "/v1/organizations/org-1/growth/delivery-orders/delivery-1/notifications",
        ),
      ]),
    );
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({
      body: JSON.stringify({
        courierReference: "courier-1",
        idempotencyKey: "delivery-dispatch-1",
      }),
      method: "POST",
    });
  });

  it("conclui desafio MFA por cookie sem persistir bearer", async () => {
    const challengeToken = "c".repeat(43);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ mfaRequired: true, challengeToken }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ identity: { id: "identity-1" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      api.login({ email: "marina@example.com", password: "senha-segura", trustedDevice: true }),
    ).resolves.toEqual({ mfaRequired: true, challengeToken, expiresAt: undefined });
    await api.verifyMfaChallenge({ challengeToken, code: "123456" });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/v1/auth/mfa/challenge/verify"),
      expect.objectContaining({
        credentials: "include",
        body: JSON.stringify({ challengeToken, code: "123456" }),
      }),
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("Bearer");
  });

  it("envia comandos gerenciais com cookie e chave de idempotência", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "approved" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.management.approvePurchase("org-1", "unit-1", "purchase-1", { version: 4 }, "idem-1");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/v1/organizations/org-1/units/unit-1/management/purchases/purchase-1/approve",
      ),
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ version: 4 }),
        headers: expect.objectContaining({ "idempotency-key": "idem-1" }),
      }),
    );
  });

  it("consulta relatórios no escopo e período selecionados", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.management.reports("org-1", "unit-1", {
      from: "2026-08-01",
      to: "2026-08-31",
      comparisonMode: "previous_period",
    });

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/v1/organizations/org-1/units/unit-1/management/reports");
    expect(url.searchParams.get("from")).toBe("2026-08-01");
    expect(url.searchParams.get("to")).toBe("2026-08-31");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("preserva filtros, linhas e idempotência nos contratos de compras", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.management.purchases("org-1", "unit-1", {
      page: 2,
      pageSize: 25,
      status: "draft",
      search: "feijao branco",
    });
    await api.management.createSupplier(
      "org-1",
      "unit-1",
      { name: "Fornecedor Norte", document: "12345678000199", address: "Rua A, 1" },
      "supplier-create-1",
    );
    await api.management.updateSupplier(
      "org-1",
      "unit-1",
      "supplier-1",
      { phone: "11999999999", version: 2 },
      "supplier-update-1",
    );
    await api.management.archiveSupplier(
      "org-1",
      "unit-1",
      "supplier-1",
      { version: 3 },
      "supplier-delete-1",
    );
    await api.management.updatePurchase(
      "org-1",
      "unit-1",
      "purchase-1",
      {
        supplierId: "supplier-1",
        version: 1,
        items: [
          { inventoryItemId: "item-1", quantity: "2", unitCostCents: 1_000 },
          { inventoryItemId: "item-2", quantity: "1", unitCostCents: 2_000 },
        ],
      },
      "purchase-update-1",
    );
    await api.management.receivePurchase(
      "org-1",
      "unit-1",
      "purchase-1",
      {
        competenceDate: "2026-08-16",
        dueDate: "2026-09-16",
        lines: [
          {
            purchaseOrderItemId: "line-1",
            locationId: "location-1",
            quantity: "1",
            batchCode: "LT-2026",
            expiresAt: "2026-12-31T00:00:00.000Z",
          },
        ],
      },
      "receipt-1",
    );
    await api.management.createPurchaseInvoice(
      "org-1",
      "unit-1",
      "purchase-1",
      {
        documentNumber: "NF-42",
        issuedAt: "2026-08-16",
        competenceDate: "2026-08-16",
        dueDate: "2026-09-16",
        totalCents: 1_000,
        toleranceCents: 0,
        confirmIfMatched: true,
        lines: [{ purchaseOrderItemId: "line-1", quantity: "1", unitCostCents: 1_000 }],
      },
      "invoice-1",
    );
    await api.management.reconcilePurchaseInvoice(
      "org-1",
      "unit-1",
      "invoice-1",
      { toleranceCents: 0, version: 1 },
      "reconcile-1",
    );
    await api.management.reversePurchaseReceipt(
      "org-1",
      "unit-1",
      "receipt-1",
      { reason: "Entrada lançada em duplicidade", version: 2 },
      "receipt-reverse-1",
    );
    await api.management.cancelPurchaseInvoice(
      "org-1",
      "unit-1",
      "invoice-1",
      { reason: "Documento fiscal substituído", version: 3 },
      "invoice-cancel-1",
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(
        "/management/purchases?page=2&pageSize=25&status=draft&search=feijao+branco",
      ),
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetchMock.mock.calls.slice(1).map(([url]) => String(url))).toEqual(
      expect.arrayContaining([
        expect.stringContaining("/management/suppliers/supplier-1"),
        expect.stringContaining("/management/purchases/purchase-1/receipts"),
        expect.stringContaining("/management/purchases/purchase-1/invoices"),
        expect.stringContaining("/management/purchases/invoices/invoice-1/reconcile"),
        expect.stringContaining("/management/purchases/receipts/receipt-1/reverse"),
        expect.stringContaining("/management/purchases/invoices/invoice-1/cancel"),
      ]),
    );
    expect(fetchMock.mock.calls[5]?.[1]).toEqual(
      expect.objectContaining({
        body: expect.stringContaining('"batchCode":"LT-2026"'),
        headers: expect.objectContaining({ "idempotency-key": "receipt-1" }),
      }),
    );
    expect(fetchMock.mock.calls[7]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ "idempotency-key": "reconcile-1" }),
      }),
    );
    expect(fetchMock.mock.calls[8]?.[1]).toEqual(
      expect.objectContaining({
        body: expect.stringContaining('"version":2'),
        headers: expect.objectContaining({ "idempotency-key": "receipt-reverse-1" }),
      }),
    );
    expect(fetchMock.mock.calls[9]?.[1]).toEqual(
      expect.objectContaining({
        body: expect.stringContaining('"version":3'),
        headers: expect.objectContaining({ "idempotency-key": "invoice-cancel-1" }),
      }),
    );
  });

  it("aceita resposta legada de compras e valida os campos novos quando presentes", () => {
    const legacy = parsePurchases({ orders: [], items: [], receipts: [] });
    expect(legacy).toMatchObject({ suppliers: [], invoices: [], capabilities: null, page: null });
    expect(
      parseSuppliers({ items: [{ id: "supplier-1", name: "Fornecedor Norte", active: true }] }),
    ).toEqual([expect.objectContaining({ id: "supplier-1", active: true })]);

    expect(
      parsePurchases({
        orders: [
          {
            id: "purchase-1",
            version: 2,
            supplierId: "supplier-1",
            status: "partially_received",
            totalCents: "3000",
            expectedAt: null,
            createdAt: null,
            updatedAt: null,
            notes: null,
          },
        ],
        items: [
          {
            id: "line-1",
            purchaseOrderId: "purchase-1",
            inventoryItemId: "item-1",
            quantity: "2",
            unitCostCents: 1500,
            receivedQuantity: "1",
          },
        ],
        receipts: [
          {
            id: "receipt-1",
            purchaseOrderId: "purchase-1",
            totalCents: 1500,
            status: "posted",
            version: 2,
          },
        ],
        suppliers: [{ id: "supplier-1", name: "Fornecedor Norte", active: true }],
        invoices: [
          {
            id: "invoice-1",
            purchaseOrderId: "purchase-1",
            documentNumber: "NF-42",
            documentKey: null,
            accessKey: "1".repeat(44),
            series: "1",
            model: "55",
            taxTotalCents: 120,
            status: "divergent",
            amountCents: 1500,
            issuedAt: null,
            dueDate: "2026-09-16",
            payableId: "payable-1",
            reconciliation: {
              lines: [
                {
                  purchaseOrderItemId: "line-1",
                  orderedQuantity: "2.000",
                  receivedQuantity: "1.000",
                  invoicedQuantity: "1.000",
                  matched: false,
                },
              ],
            },
          },
        ],
        suggestions: [
          { inventoryItemId: "item-1", suggestedQuantity: "6", reason: "Estoque abaixo do mínimo" },
        ],
        metrics: [{ key: "open", value: "1", label: "Em aberto" }],
        capabilities: {
          canCreate: true,
          canApprove: true,
          canReceive: true,
          canInvoice: true,
          canReconcile: true,
          canConfirmInvoice: false,
          canReverseReceipt: true,
          canCancelInvoice: true,
        },
        pagination: { page: 1, pageSize: 25, total: 1 },
      }),
    ).toMatchObject({
      orders: [{ supplierId: "supplier-1" }],
      items: [{ receivedQuantity: "1" }],
      receipts: [{ version: 2, status: "posted" }],
      invoices: [
        {
          status: "divergent",
          accessKey: "1".repeat(44),
          reconciliationLines: [{ matched: false }],
        },
      ],
      capabilities: { canConfirmInvoice: false, canReverseReceipt: true, canCancelInvoice: true },
      page: { total: 1 },
    });
  });

  it("mantém o escopo do servidor nas novas ações operacionais", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: "created-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.growth.createReservation("org-1", {
      unitId: "unit-1",
      guestName: "Ana",
      partySize: 4,
      scheduledAt: "2026-08-14T20:00:00.000Z",
      durationMinutes: 90,
      idempotencyKey: "reservation-1",
    });
    await api.management.createPerson("org-1", "unit-1", {
      name: "Bia",
      roleLabel: "Atendimento",
    });
    await api.management.closeCashShift(
      "org-1",
      "unit-1",
      "shift-1",
      { countedCents: 12_300 },
      "close-1",
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("/v1/organizations/org-1/growth/reservations"),
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: expect.stringContaining('"unitId":"unit-1"'),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/v1/organizations/org-1/units/unit-1/management/people"),
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining(
        "/v1/organizations/org-1/units/unit-1/management/cash-shifts/shift-1/close",
      ),
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({ "idempotency-key": "close-1" }),
      }),
    );
  });

  it("separa consentimento, rascunho e envio de marketing", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: "created-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.growth.recordConsent("org-1", "customer-1", {
      decision: "granted",
      purpose: "marketing",
      channel: "email",
      source: "ops-crm",
      legalBasis: "consent",
      policyVersion: "privacy-1",
    });
    await api.growth.createCampaign("org-1", {
      unitId: "unit-1",
      name: "Retorno",
      channel: "email",
      subject: "Sentimos sua falta",
      content: "Volte para nos visitar.",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("/v1/organizations/org-1/growth/customers/customer-1/consents"),
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/v1/organizations/org-1/growth/campaigns"),
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("/queue");
  });

  it("encaminha fluxos compostos aos contratos auditáveis do backend", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: "created-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.management.createInventoryEvent(
      "org-1",
      "unit-1",
      {
        type: "count",
        reason: "Contagem semanal",
        lines: [{ locationId: "location-1", inventoryItemId: "item-1", quantity: "12" }],
      },
      "inventory-1",
    );
    await api.management.createPurchase(
      "org-1",
      "unit-1",
      {
        supplierId: "supplier-1",
        items: [{ inventoryItemId: "item-1", quantity: "2", unitCostCents: 1_000 }],
      },
      "purchase-1",
    );
    await api.management.createTimeEntry(
      "org-1",
      "unit-1",
      { personId: "person-1", clockedInAt: "2026-08-14T12:00:00.000Z", source: "manual" },
      "time-entry-1",
    );
    await api.growth.createCoupon("org-1", {
      unitId: "unit-1",
      code: "VOLTE10",
      type: "percentage",
      value: 1_000,
      minimumOrderCents: 0,
      channels: ["direct"],
      unitIds: ["unit-1"],
      perCustomerLimit: 1,
      active: true,
    });

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(
      expect.arrayContaining([
        expect.stringContaining("/management/inventory/events"),
        expect.stringContaining("/management/purchases"),
        expect.stringContaining("/management/people/time-entries"),
        expect.stringContaining("/growth/coupons"),
      ]),
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ "idempotency-key": "inventory-1" }),
      }),
    );
  });

  it("envia mutações POS com cookie e idempotência inclusive em PUT", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ tabId: "tab-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.pilot.serviceCharge("org-1", "unit-1", "tab-1", 1_000, "idem-pos-1");
    await api.pilot.createCombo(
      "org-1",
      "unit-1",
      {
        name: "Combo da casa",
        priceCents: 3_990,
        items: [{ productId: "product-1", quantity: 1 }],
      },
      "combo-1",
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(
        "/v1/organizations/org-1/units/unit-1/pilot/tabs/tab-1/service-charge",
      ),
      expect.objectContaining({
        method: "PUT",
        credentials: "include",
        body: JSON.stringify({ basisPoints: 1_000 }),
        headers: expect.objectContaining({ "idempotency-key": "idem-pos-1" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/v1/organizations/org-1/units/unit-1/pilot/catalog/combos"),
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({ "idempotency-key": "combo-1" }),
      }),
    );
  });

  it("envia operações avançadas do cardápio real aos contratos persistentes", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.pilot.bulkAdjustPrices(
      "org-1",
      "unit-1",
      {
        productIds: ["product-1"],
        categoryIds: [],
        mode: "percentage",
        value: 2_000,
        channel: "both",
        reason: "Reajuste anual do cardápio",
      },
      "catalog-bulk-1",
    );
    await api.pilot.updateCatalogPublication(
      "org-1",
      "unit-1",
      { slug: "unidade-centro", active: true },
      "catalog-publication-1",
    );
    await api.pilot.uploadCatalogMedia("org-1", "unit-1", {
      fileName: "produto.jpg",
      mimeType: "image/jpeg",
      base64: "YWJjZA==",
    });
    await api.pilot.setProductDailyStock("org-1", "unit-1", "product-1", {
      remaining: 12,
      autoDeductStock: true,
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("/pilot/catalog/prices/bulk"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "idempotency-key": "catalog-bulk-1" }),
        body: expect.stringContaining('"channel":"both"'),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/pilot/catalog/publication"),
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({ "idempotency-key": "catalog-publication-1" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("/pilot/catalog/media"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"base64":"YWJjZA=="'),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining("/pilot/catalog/products/product-1/daily-stock"),
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ remaining: 12, autoDeductStock: true }),
      }),
    );
  });

  it("projeta ordenação e branding persistidos no cardápio real", () => {
    const parsed = parsePilotCatalog({
      categories: [
        { id: "category-2", name: "Segundo", active: true, sortOrder: 2 },
        { id: "category-1", name: "Primeiro", active: true, sortOrder: 1 },
      ],
      products: [],
      prices: [],
      availability: [],
      branding: {
        displayName: "Casa Centro",
        primaryColor: "#123456",
        address: "Rua Principal, 10",
        phone: "11999999999",
        instagram: "",
        openingHours: "Todos os dias, 11h às 23h",
        serviceTaxNotice: "Serviço opcional de 10%",
        corkageFeeNotice: "Rolha R$ 40",
        wifi: { ssid: "Casa", password: "segura" },
      },
    });

    expect(parsed.categories.map(({ id }) => id)).toEqual(["category-1", "category-2"]);
    expect(parsed.branding).toMatchObject({
      restaurantName: "Casa Centro",
      address: "Rua Principal, 10",
      instagram: null,
      serviceTaxNotice: "Serviço opcional de 10%",
      corkageFeeNotice: "Rolha R$ 40",
      wifiNotice: "Wi-Fi: Casa | Senha: segura",
    });
  });

  it("consulta o overview da plataforma somente com a sessão cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          counts: { organizations: 0, units: 0, activeTrials: 0 },
          recentTrialApplications: [],
          recentContacts: [],
          recentOrganizations: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.platform.overview();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v1/platform/overview"),
      expect.objectContaining({ credentials: "include" }),
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("Authorization");
  });

  it("parses schedules and commissions returned by people", () => {
    const parsed = parsePeople({
      people: [],
      schedules: [
        {
          id: "schedule-1",
          personId: "person-1",
          startsAt: "2026-08-18T12:00:00.000Z",
          endsAt: "2026-08-18T20:00:00.000Z",
          breakMinutes: 60,
        },
      ],
      timeEntries: [],
      breaks: [],
      corrections: [],
      summaries: [],
      anomalies: [],
      alerts: [],
      closures: [],
      selectedPersonIds: [],
      accounts: [],
      commissionRules: [{ id: "rule-1", name: "Vendas", basisPoints: 500, active: true }],
      commissions: [
        {
          id: "commission-1",
          personId: "person-1",
          ruleId: "rule-1",
          sourceOrderId: null,
          baseCents: 10_000,
          amountCents: 500,
          status: "pending",
          createdAt: "2026-08-18T20:00:00.000Z",
        },
      ],
      settings: {
        mode: "all",
        geofenceEnabled: false,
        locationLabel: null,
        latitude: null,
        longitude: null,
        radiusMeters: 100,
        accuracyToleranceMeters: 50,
        managerCanView: true,
        financeCanView: false,
        antiFraudEnabled: true,
        offlineEnabled: true,
        notificationsEnabled: true,
        managerAlertOnAnomaly: true,
        lateToleranceMinutes: 15,
        minimumBreakMinutes: 30,
        maxOvertimeMinutes: 120,
        longShiftAlertMinutes: 720,
        reminderBeforeShiftMinutes: 15,
        reminderAfterShiftMinutes: 15,
      },
      canManage: true,
    });

    expect(parsed.schedules[0]).toEqual({
      id: "schedule-1",
      personId: "person-1",
      startsAt: "2026-08-18T12:00:00.000Z",
      endsAt: "2026-08-18T20:00:00.000Z",
      breakMinutes: 60,
      notes: null,
      status: "active",
      canceledAt: null,
      cancelReason: null,
      updatedAt: undefined,
    });
    expect(parsed.commissionRules[0]).toEqual({
      id: "rule-1",
      name: "Vendas",
      basisPoints: 500,
      active: true,
    });
    expect(parsed.commissions[0]).toMatchObject({
      id: "commission-1",
      personId: "person-1",
      amountCents: 500,
      status: "pending",
    });
  });

  it("posts commission rules and commissions to people endpoints", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: "created-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.management.createCommissionRule("org-1", "unit-1", {
      name: "Vendas",
      basisPoints: 500,
    });
    await api.management.createCommission(
      "org-1",
      "unit-1",
      { personId: "person-1", ruleId: "rule-1", baseCents: 10_000 },
      "commission-idempotency-1",
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("/management/people/commission-rules"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Vendas", basisPoints: 500 }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/management/people/commissions"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ personId: "person-1", ruleId: "rule-1", baseCents: 10_000 }),
        headers: expect.objectContaining({ "idempotency-key": "commission-idempotency-1" }),
      }),
    );
  });

  it("parses paginated people and explicit operational coverage", () => {
    const directory = parsePeopleDirectory({
      items: [
        {
          id: "person-1",
          identityId: null,
          name: "Ana",
          roleLabel: "Garçom",
          employmentCode: "A-1",
          active: true,
          hourlyRateCents: 1800,
          updatedAt: "2026-08-18T12:00:00.000Z",
        },
      ],
      pagination: { page: 2, pageSize: 20, total: 31, totalPages: 2 },
    });
    const indicators = parsePeopleIndicators({
      period: { from: "2026-08-01", to: "2026-08-18" },
      timezone: "America/Sao_Paulo",
      indicators: {
        scheduledShifts: 30,
        absences: 2,
        lateArrivals: 3,
        recurringLatePeople: 1,
        overtimeMinutes: 90,
        laborCostCents: 120_000,
        laborCostPercentage: null,
      },
      coverage: {
        schedules: "complete",
        timeEntries: "complete",
        laborCost: "partial",
        missingHourlyRatePeople: 2,
      },
    });

    expect(directory.pagination).toEqual({ page: 2, pageSize: 20, total: 31, pageCount: 2 });
    expect(directory.items[0]).toMatchObject({
      name: "Ana",
      employmentCode: "A-1",
      access: { status: "none" },
    });
    expect(indicators.coverage).toEqual({
      schedules: "complete",
      timeEntries: "complete",
      laborCost: "partial",
      missingHourlyRatePeople: 2,
    });
  });

  it("uses persisted people lifecycle endpoints and idempotency", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.management.updatePerson("org-1", "unit-1", "person-1", {
      name: "Ana Souza",
      expectedUpdatedAt: "2026-08-18T12:00:00.000Z",
    });
    await api.management.changePersonStatus(
      "org-1",
      "unit-1",
      "person-1",
      false,
      "Desligamento confirmado",
    );
    await api.management.transitionCommission(
      "org-1",
      "unit-1",
      "commission-1",
      { action: "approve", note: "Conferida com a venda" },
      "commission-transition-1",
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("/management/people/person-1"),
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/management/people/person-1/inactivate"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ reason: "Desligamento confirmado" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("/management/people/commissions/commission-1/transition"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "idempotency-key": "commission-transition-1" }),
      }),
    );
  });
});
