import { createHash } from "node:crypto";
import type { SystemRole } from "@giromesa/domain";

export type OverviewProfileId = Exclude<SystemRole, "kds"> | "kitchen";
export type OverviewTone = "neutral" | "success" | "warning" | "danger" | "info";
export type OverviewSourceId =
  | "operationalShift"
  | "operations"
  | "inventory"
  | "finance"
  | "cash"
  | "delivery"
  | "reservations"
  | "activity"
  | "multiunit";
export type OverviewRoute =
  | "dashboard"
  | "salon"
  | "counter"
  | "catalog"
  | "kds"
  | "cash"
  | "inventory"
  | "purchases"
  | "finance"
  | "reports"
  | "people"
  | "delivery"
  | "reservations"
  | "crm"
  | "multiunit";

export interface OverviewSnapshot {
  activeShift: { label: string; startsAt: Date } | null;
  cashShift?: { startsAt: Date; lastDifferenceCents: number | null } | null;
  operations?: {
    salesCents: number;
    closedTabs: number;
    openTabs: number;
    myOpenTabs: number;
    openValueCents: number;
    receivedCents: number;
    tables: number;
    occupiedTables: number;
    turnoverTables: number;
    openCalls: number;
    overdueCalls: number;
    kdsPending: number;
    kdsPreparing: number;
    kdsReady: number;
    kdsDelayed: number;
    readyForMe: number;
    activePeople: number;
    pendingApprovals: number;
    previousSalesCents: number;
    previousClosedTabs: number;
    previousReceivedCents: number;
    busiestStationLabel: string | null;
    busiestStationQueue: number;
  };
  inventory?: {
    outOfStock: number;
    belowMinimum: number;
    awaitingReceipt: number;
    eventsToday: number;
    previousEvents: number;
    coverageRisk: number;
    suggestedPurchases: number;
    supplierDelays: number;
  };
  finance?: {
    overduePayables: number;
    overduePayablesCents: number;
    overdueReceivables: number;
    overdueReceivablesCents: number;
    projectedBalanceCents: number;
    unresolvedReconciliations: number;
    grossMarginCents: number | null;
    payablesDueSoon: number;
    payablesDueSoonCents: number;
    receivablesDueSoon: number;
    receivablesDueSoonCents: number;
  };
  delivery?: {
    active: number;
    preparing: number;
    ready: number;
    delayed: number;
    atRisk: number;
    busyCouriers: number;
    totalCouriers: number;
    canceledToday: number;
  };
  reservations?: { upcoming: number; overdue: number; waitlist: number };
  multiunit?: Array<{
    unitId: string;
    name: string;
    salesCents: number;
    marginCents: number | null;
    alerts: number;
    tone: OverviewTone;
  }>;
}

export interface OverviewPreferences {
  alertsEnabled: boolean;
  minimumTone: "info" | "warning" | "danger";
  digestMinutes: number;
  thresholds: {
    kdsDelayMinutes: number;
    stockCoverageDays: number;
    deliveryRiskMinutes: number;
    salesGoalCents: number;
    maxKdsDelayed: number;
    maxStockouts: number;
    maxDeliveryDelayed: number;
    maxReconciliations: number;
  };
}

export const defaultOverviewPreferences: OverviewPreferences = {
  alertsEnabled: true,
  minimumTone: "warning",
  digestMinutes: 15,
  thresholds: {
    kdsDelayMinutes: 15,
    stockCoverageDays: 7,
    deliveryRiskMinutes: 15,
    salesGoalCents: 0,
    maxKdsDelayed: 0,
    maxStockouts: 0,
    maxDeliveryDelayed: 0,
    maxReconciliations: 0,
  },
};

const roleOrder: readonly SystemRole[] = [
  "owner",
  "manager",
  "cashier",
  "delivery",
  "waiter",
  "receptionist",
  "busser",
  "kds",
  "inventory",
  "finance",
  "accountant",
];

export const overviewRoutes: Record<OverviewProfileId, readonly OverviewRoute[]> = {
  accountant: ["dashboard"],
  owner: [
    "dashboard",
    "salon",
    "counter",
    "catalog",
    "kds",
    "cash",
    "inventory",
    "purchases",
    "finance",
    "reports",
    "people",
    "delivery",
    "reservations",
    "crm",
    "multiunit",
  ],
  manager: [
    "dashboard",
    "salon",
    "counter",
    "catalog",
    "kds",
    "cash",
    "inventory",
    "purchases",
    "finance",
    "reports",
    "people",
    "delivery",
    "reservations",
    "crm",
    "multiunit",
  ],
  waiter: ["dashboard", "salon", "counter", "catalog", "reservations"],
  receptionist: ["dashboard", "reservations", "salon"],
  busser: ["dashboard", "salon"],
  cashier: ["dashboard", "salon", "counter", "catalog", "cash"],
  kitchen: ["dashboard", "catalog", "kds"],
  inventory: ["dashboard", "inventory", "purchases"],
  finance: ["dashboard", "cash", "purchases", "finance", "reports"],
  delivery: ["dashboard", "counter", "catalog", "delivery", "reservations"],
};

export function resolveOverviewProfile(
  bindings: readonly { role: SystemRole; unitId: string | null }[],
  unitId: string,
): OverviewProfileId | null {
  const effective = new Set(
    bindings
      .filter((binding) => binding.unitId === null || binding.unitId === unitId)
      .map(({ role }) => role),
  );
  const role = roleOrder.find((candidate) => effective.has(candidate));
  return role === "kds" ? "kitchen" : (role ?? null);
}

const money = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const count = (value: number) => String(value);
const unavailable = "Dados temporariamente indisponíveis";

type Metric = {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: OverviewTone;
  route: OverviewRoute;
  source: OverviewSourceId;
  comparison?: { label: string; value: string; tone: OverviewTone };
  goal?: { label: string; tone: OverviewTone };
};
type Priority = {
  id: string;
  title: string;
  detail: string;
  tone: OverviewTone;
  route: OverviewRoute;
  actionLabel: string;
  source: OverviewSourceId;
  occurrenceKey: string;
};

function sourceFor(id: string, route: OverviewRoute): OverviewSourceId {
  if (["received", "tabs-to-receive"].includes(id)) return "operations";
  if (
    [
      "gross-margin",
      "projected-balance",
      "payables-overdue",
      "receivables-overdue",
      "reconciliation",
      "finance-due-soon",
    ].includes(id)
  )
    return "finance";
  if (
    ["cash-status", "cash-closed", "cash-close-blockers", "cash-difference"].includes(id) ||
    route === "cash"
  )
    return "cash";
  if (route === "inventory" || route === "purchases") return "inventory";
  if (route === "delivery") return "delivery";
  if (route === "reservations") return "reservations";
  if (route === "multiunit") return "multiunit";
  return "operations";
}

function metric(
  id: string,
  label: string,
  value: string,
  detail: string,
  tone: OverviewTone,
  route: OverviewRoute,
): Metric {
  return { id, label, value, detail, tone, route, source: sourceFor(id, route) };
}

function priority(
  id: string,
  title: string,
  detail: string,
  tone: OverviewTone,
  route: OverviewRoute,
  actionLabel: string,
): Priority {
  return {
    id,
    title,
    detail,
    tone,
    route,
    actionLabel,
    source: sourceFor(id, route),
    occurrenceKey: createHash("sha256").update(`${id}\u0000${title}\u0000${detail}`).digest("hex"),
  };
}

function operationalMetrics(profile: OverviewProfileId, snapshot: OverviewSnapshot): Metric[] {
  const operation = snapshot.operations;
  if (!operation) {
    const missing = (id: string, label: string, route: OverviewRoute) =>
      metric(id, label, "—", unavailable, "warning", route);
    if (profile === "owner")
      return [
        missing("pending-approvals", "Aprovações pendentes", "counter"),
        missing("sales", "Vendas do turno", "reports"),
        metric(
          "gross-margin",
          "Margem bruta",
          snapshot.finance?.grossMarginCents == null
            ? "—"
            : money(snapshot.finance.grossMarginCents),
          snapshot.finance
            ? snapshot.finance.grossMarginCents == null
              ? "Sem cobertura completa de custo"
              : "Receita menos CMV"
            : unavailable,
          "neutral",
          "reports",
        ),
        metric(
          "projected-balance",
          "Saldo projetado",
          snapshot.finance ? money(snapshot.finance.projectedBalanceCents) : "—",
          snapshot.finance ? "A receber menos a pagar" : unavailable,
          snapshot.finance ? "info" : "warning",
          "finance",
        ),
      ];
    if (profile === "manager")
      return [
        missing("pending-approvals", "Aprovações pendentes", "counter"),
        missing("occupancy", "Ocupação", "salon"),
        missing("open-tabs", "Comandas abertas", "counter"),
        missing("late-kds", "Tickets atrasados", "kds"),
      ];
    if (profile === "waiter")
      return [
        missing("my-tables", "Minhas mesas", "salon"),
        missing("open-calls", "Chamados", "salon"),
        missing("ready-items", "Prontos para retirar", "salon"),
        missing("open-tabs", "Comandas abertas", "counter"),
      ];
    if (profile === "cashier")
      return [
        metric(
          "cash-status",
          "Caixa",
          snapshot.cashShift === undefined ? "—" : snapshot.cashShift ? "Aberto" : "Fechado",
          snapshot.cashShift === undefined
            ? unavailable
            : snapshot.cashShift
              ? "Turno de caixa em andamento"
              : "Nenhum turno de caixa aberto",
          snapshot.cashShift === undefined ? "warning" : snapshot.cashShift ? "success" : "warning",
          "cash",
        ),
        missing("received", "Recebido no turno", "cash"),
        missing("tabs-to-receive", "Comandas a receber", "counter"),
        metric(
          "cash-difference",
          "Última diferença",
          snapshot.cashShift?.lastDifferenceCents == null
            ? "—"
            : money(snapshot.cashShift.lastDifferenceCents),
          snapshot.cashShift === undefined ? unavailable : "Último caixa encerrado",
          snapshot.cashShift?.lastDifferenceCents ? "warning" : "neutral",
          "cash",
        ),
      ];
    return [
      missing("kds-new", "Novos", "kds"),
      missing("kds-preparing", "Em preparo", "kds"),
      missing("kds-late", "Atrasados", "kds"),
      missing("kds-ready", "Prontos", "kds"),
    ];
  }
  const occupancy = operation.tables
    ? Math.round((operation.occupiedTables / operation.tables) * 100)
    : 0;
  if (profile === "owner")
    return [
      metric(
        "pending-approvals",
        "Aprovações pendentes",
        count(operation.pendingApprovals),
        "Descontos e cancelamentos",
        operation.pendingApprovals ? "warning" : "success",
        "counter",
      ),
      metric(
        "sales",
        "Vendas do turno",
        money(operation.salesCents),
        `${operation.closedTabs} comanda(s) fechada(s)`,
        "info",
        "reports",
      ),
      metric(
        "average-ticket",
        "Ticket médio",
        money(operation.closedTabs ? Math.round(operation.salesCents / operation.closedTabs) : 0),
        "Por comanda fechada",
        "neutral",
        "reports",
      ),
      metric(
        "gross-margin",
        "Margem bruta",
        snapshot.finance?.grossMarginCents === null || snapshot.finance === undefined
          ? "—"
          : money(snapshot.finance.grossMarginCents),
        snapshot.finance?.grossMarginCents === null || snapshot.finance === undefined
          ? "Sem cobertura completa de custo"
          : "Receita menos CMV",
        "neutral",
        "reports",
      ),
      metric(
        "projected-balance",
        "Saldo projetado",
        snapshot.finance ? money(snapshot.finance.projectedBalanceCents) : "—",
        snapshot.finance ? "A receber menos a pagar" : unavailable,
        "info",
        "finance",
      ),
    ];
  if (profile === "manager")
    return [
      metric(
        "pending-approvals",
        "Aprovações pendentes",
        count(operation.pendingApprovals),
        "Descontos e cancelamentos",
        operation.pendingApprovals ? "warning" : "success",
        "counter",
      ),
      metric(
        "occupancy",
        "Ocupação",
        `${occupancy}%`,
        `${operation.occupiedTables} de ${operation.tables} mesa(s)`,
        occupancy >= 90 ? "warning" : "info",
        "salon",
      ),
      metric(
        "open-tabs",
        "Comandas abertas",
        count(operation.openTabs),
        money(operation.openValueCents),
        "neutral",
        "counter",
      ),
      metric(
        "late-kds",
        "Tickets atrasados",
        count(operation.kdsDelayed),
        "Acima de 15 minutos",
        operation.kdsDelayed ? "danger" : "success",
        "kds",
      ),
      metric(
        "active-team",
        "Equipe em turno",
        count(operation.activePeople),
        "Pessoas com ponto aberto",
        "neutral",
        "people",
      ),
    ];
  if (profile === "waiter")
    return [
      metric(
        "my-tables",
        "Minhas mesas",
        count(operation.myOpenTabs),
        "Comandas sob sua responsabilidade",
        "info",
        "salon",
      ),
      metric(
        "open-calls",
        "Chamados",
        count(operation.openCalls),
        `${operation.overdueCalls} fora do SLA`,
        operation.overdueCalls ? "danger" : "neutral",
        "salon",
      ),
      metric(
        "ready-items",
        "Prontos para retirar",
        count(operation.readyForMe),
        "Tickets das suas comandas",
        operation.readyForMe ? "warning" : "success",
        "salon",
      ),
      metric(
        "open-tabs",
        "Comandas abertas",
        count(operation.openTabs),
        "Na unidade",
        "neutral",
        "counter",
      ),
    ];
  if (profile === "cashier")
    return [
      metric(
        "cash-status",
        "Caixa",
        snapshot.cashShift === undefined ? "—" : snapshot.cashShift ? "Aberto" : "Fechado",
        snapshot.cashShift === undefined
          ? unavailable
          : snapshot.cashShift
            ? "Turno de caixa em andamento"
            : "Nenhum turno de caixa aberto",
        snapshot.cashShift === undefined ? "warning" : snapshot.cashShift ? "success" : "warning",
        "cash",
      ),
      metric(
        "received",
        "Recebido no turno",
        money(operation.receivedCents),
        "Pagamentos registrados",
        "info",
        "cash",
      ),
      metric(
        "tabs-to-receive",
        "Comandas a receber",
        count(operation.openTabs),
        money(operation.openValueCents),
        operation.openTabs ? "warning" : "success",
        "counter",
      ),
      metric(
        "cash-close-blockers",
        "Pendências para fechar",
        count(operation.openTabs + (snapshot.finance?.unresolvedReconciliations ?? 0)),
        "Comandas e conciliações abertas",
        operation.openTabs || snapshot.finance?.unresolvedReconciliations ? "warning" : "success",
        "cash",
      ),
      metric(
        "cash-difference",
        "Última diferença",
        snapshot.cashShift?.lastDifferenceCents == null
          ? "—"
          : money(snapshot.cashShift.lastDifferenceCents),
        "Último caixa encerrado",
        snapshot.cashShift?.lastDifferenceCents ? "warning" : "neutral",
        "cash",
      ),
    ];
  if (profile === "receptionist")
    return [
      metric(
        "occupancy",
        "Ocupação",
        `${occupancy}%`,
        `${operation.occupiedTables} de ${operation.tables} mesa(s)`,
        occupancy >= 90 ? "warning" : "info",
        "salon",
      ),
      metric(
        "open-calls",
        "Chamados",
        count(operation.openCalls),
        `${operation.overdueCalls} fora do SLA`,
        operation.overdueCalls ? "danger" : "neutral",
        "salon",
      ),
    ];
  if (profile === "busser")
    return [
      metric(
        "table-turnover",
        "Mesas para preparar",
        count(operation.turnoverTables),
        "Aguardando ou em limpeza",
        operation.turnoverTables ? "warning" : "success",
        "salon",
      ),
      metric(
        "occupancy",
        "Ocupação",
        `${occupancy}%`,
        `${operation.occupiedTables} mesa(s) ocupada(s)`,
        "info",
        "salon",
      ),
    ];
  return [
    metric(
      "kds-new",
      "Novos",
      count(operation.kdsPending),
      "Aguardando início",
      operation.kdsPending ? "warning" : "success",
      "kds",
    ),
    metric(
      "kds-preparing",
      "Em preparo",
      count(operation.kdsPreparing),
      "Produção atual",
      "info",
      "kds",
    ),
    metric(
      "kds-late",
      "Atrasados",
      count(operation.kdsDelayed),
      "Acima de 15 minutos",
      operation.kdsDelayed ? "danger" : "success",
      "kds",
    ),
    metric(
      "kds-ready",
      "Prontos",
      count(operation.kdsReady),
      "Aguardando retirada",
      operation.kdsReady ? "warning" : "success",
      "kds",
    ),
  ];
}

function roleMetrics(profile: OverviewProfileId, snapshot: OverviewSnapshot): Metric[] {
  if (["owner", "manager", "waiter", "cashier", "kitchen"].includes(profile))
    return operationalMetrics(profile, snapshot);
  if (profile === "inventory") {
    const data = snapshot.inventory;
    return data
      ? [
          metric(
            "out-of-stock",
            "Itens zerados",
            count(data.outOfStock),
            "Sem saldo disponível",
            data.outOfStock ? "danger" : "success",
            "inventory",
          ),
          metric(
            "below-minimum",
            "Abaixo do mínimo",
            count(data.belowMinimum),
            "Reposição necessária",
            data.belowMinimum ? "warning" : "success",
            "inventory",
          ),
          metric(
            "coverage-risk",
            "Cobertura em risco",
            count(data.coverageRisk),
            "Consumo pode superar o estoque",
            data.coverageRisk ? "warning" : "success",
            "inventory",
          ),
          metric(
            "suggested-purchases",
            "Compras sugeridas",
            count(data.suggestedPurchases),
            `${data.supplierDelays} entrega(s) de fornecedor atrasada(s)`,
            data.supplierDelays ? "danger" : data.suggestedPurchases ? "warning" : "success",
            "purchases",
          ),
        ]
      : [metric("inventory-unavailable", "Estoque", "—", unavailable, "warning", "inventory")];
  }
  if (profile === "finance") {
    const data = snapshot.finance;
    return data
      ? [
          metric(
            "payables-overdue",
            "A pagar vencido",
            money(data.overduePayablesCents),
            `${data.overduePayables} título(s)`,
            data.overduePayables ? "danger" : "success",
            "finance",
          ),
          metric(
            "receivables-overdue",
            "A receber vencido",
            money(data.overdueReceivablesCents),
            `${data.overdueReceivables} título(s)`,
            data.overdueReceivables ? "warning" : "success",
            "finance",
          ),
          metric(
            "projected-balance",
            "Saldo projetado",
            money(data.projectedBalanceCents),
            "A receber menos a pagar",
            "info",
            "finance",
          ),
          metric(
            "finance-due-soon",
            "Próximos 7 dias",
            money(data.receivablesDueSoonCents - data.payablesDueSoonCents),
            `${data.receivablesDueSoon} recebimento(s) e ${data.payablesDueSoon} pagamento(s)`,
            data.payablesDueSoonCents > data.receivablesDueSoonCents ? "warning" : "info",
            "finance",
          ),
          metric(
            "reconciliation",
            "Conciliação pendente",
            count(data.unresolvedReconciliations),
            "Lançamentos não resolvidos",
            data.unresolvedReconciliations ? "warning" : "success",
            "finance",
          ),
        ]
      : [metric("finance-unavailable", "Financeiro", "—", unavailable, "warning", "finance")];
  }
  const data = snapshot.delivery;
  return data
    ? [
        metric(
          "delivery-active",
          "Pedidos ativos",
          count(data.active),
          "Em atendimento",
          "info",
          "delivery",
        ),
        metric(
          "delivery-at-risk",
          "Próximos do prazo",
          count(data.atRisk),
          "Dentro da janela de risco configurada",
          data.atRisk ? "warning" : "success",
          "delivery",
        ),
        metric(
          "delivery-ready",
          "Prontos para despacho",
          count(data.ready),
          "Aguardando entregador",
          data.ready ? "warning" : "success",
          "delivery",
        ),
        metric(
          "delivery-delayed",
          "Atrasados",
          count(data.delayed),
          "Prazo prometido vencido",
          data.delayed ? "danger" : "success",
          "delivery",
        ),
      ]
    : [metric("delivery-unavailable", "Delivery", "—", unavailable, "warning", "delivery")];
}

function priorities(profile: OverviewProfileId, snapshot: OverviewSnapshot): Priority[] {
  const items: Priority[] = [];
  const operation = snapshot.operations;
  const inventory = snapshot.inventory;
  const finance = snapshot.finance;
  const delivery = snapshot.delivery;
  const reservations = snapshot.reservations;
  if (
    (profile === "owner" || profile === "manager" || profile === "inventory") &&
    inventory?.outOfStock
  )
    items.push(
      priority(
        "stockout",
        `${inventory.outOfStock} item(ns) sem estoque`,
        "A operação pode sofrer ruptura.",
        "danger",
        "inventory",
        "Repor estoque",
      ),
    );
  if (
    (profile === "owner" || profile === "manager" || profile === "finance") &&
    finance?.overduePayables
  )
    items.push(
      priority(
        "overdue-payables",
        `${finance.overduePayables} conta(s) vencida(s)`,
        money(finance.overduePayablesCents),
        "danger",
        "finance",
        "Tratar vencimentos",
      ),
    );
  if (
    (profile === "owner" || profile === "manager" || profile === "cashier") &&
    snapshot.cashShift === null
  )
    items.push(
      priority(
        "cash-closed",
        "Caixa fechado",
        "Nenhum turno de caixa está aberto.",
        "warning",
        "cash",
        "Abrir caixa",
      ),
    );
  if (profile === "cashier" && snapshot.cashShift && operation?.openTabs)
    items.push(
      priority(
        "cash-close-blockers",
        `${operation.openTabs} comanda(s) impedem o fechamento`,
        "Finalize os recebimentos antes de conferir o caixa.",
        "warning",
        "cash",
        "Preparar fechamento",
      ),
    );
  if ((profile === "owner" || profile === "manager") && operation?.pendingApprovals)
    items.push(
      priority(
        "pending-approvals",
        `${operation.pendingApprovals} aprovação(ões) pendente(s)`,
        "Revise descontos e cancelamentos solicitados.",
        "warning",
        "counter",
        "Revisar aprovações",
      ),
    );
  if ((profile === "manager" || profile === "kitchen") && operation?.kdsDelayed)
    items.push(
      priority(
        "late-kds",
        `${operation.kdsDelayed} ticket(s) atrasado(s)`,
        "Priorize o mais antigo.",
        "danger",
        "kds",
        "Abrir produção",
      ),
    );
  if ((profile === "manager" || profile === "waiter") && operation?.overdueCalls)
    items.push(
      priority(
        "late-calls",
        `${operation.overdueCalls} chamado(s) fora do SLA`,
        "Atenda o chamado mais antigo.",
        "danger",
        "salon",
        "Atender chamados",
      ),
    );
  if (profile === "waiter" && operation?.readyForMe)
    items.push(
      priority(
        "ready-for-me",
        `${operation.readyForMe} retirada(s) pronta(s)`,
        "Leve os pedidos às suas mesas.",
        "warning",
        "salon",
        "Retirar pedidos",
      ),
    );
  if (profile === "cashier" && operation?.openTabs)
    items.push(
      priority(
        "tabs-to-charge",
        `${operation.openTabs} comanda(s) a receber`,
        money(operation.openValueCents),
        "warning",
        "counter",
        "Receber comandas",
      ),
    );
  if (profile === "inventory" && inventory?.awaitingReceipt)
    items.push(
      priority(
        "purchase-receipts",
        `${inventory.awaitingReceipt} compra(s) aguardando recebimento`,
        "Confira quantidades e custos.",
        "warning",
        "purchases",
        "Receber compras",
      ),
    );
  if (profile === "inventory" && inventory?.coverageRisk)
    items.push(
      priority(
        "coverage-risk",
        `${inventory.coverageRisk} item(ns) com cobertura insuficiente`,
        "O estoque pode acabar antes do prazo de reposição.",
        "danger",
        "inventory",
        "Revisar cobertura",
      ),
    );
  if (profile === "inventory" && inventory?.supplierDelays)
    items.push(
      priority(
        "supplier-delays",
        `${inventory.supplierDelays} entrega(s) de fornecedor atrasada(s)`,
        "Cobrar previsão ou buscar alternativa.",
        "warning",
        "purchases",
        "Ver compras",
      ),
    );
  if (profile === "finance" && finance?.unresolvedReconciliations)
    items.push(
      priority(
        "reconciliation",
        `${finance.unresolvedReconciliations} conciliação(ões) pendente(s)`,
        "Há lançamentos sem resolução.",
        "warning",
        "finance",
        "Conciliar",
      ),
    );
  if (profile === "delivery" && delivery?.delayed)
    items.push(
      priority(
        "late-deliveries",
        `${delivery.delayed} entrega(s) atrasada(s)`,
        "Prazo prometido já venceu.",
        "danger",
        "delivery",
        "Ver entregas",
      ),
    );
  if (profile === "delivery" && delivery?.ready)
    items.push(
      priority(
        "ready-deliveries",
        `${delivery.ready} pedido(s) pronto(s)`,
        "Aguardando despacho.",
        "warning",
        "delivery",
        "Despachar",
      ),
    );
  if (profile === "delivery" && delivery?.atRisk)
    items.push(
      priority(
        "delivery-at-risk",
        `${delivery.atRisk} entrega(s) próximas do prazo`,
        "Antecipe despacho ou redistribua a carga.",
        "warning",
        "delivery",
        "Reorganizar entregas",
      ),
    );
  if (profile === "delivery" && delivery?.canceledToday)
    items.push(
      priority(
        "delivery-failures",
        `${delivery.canceledToday} entrega(s) cancelada(s) hoje`,
        "Revise endereço, pagamento e motivo do cancelamento.",
        "info",
        "delivery",
        "Revisar falhas",
      ),
    );
  if (profile === "owner" && snapshot.multiunit?.some(({ alerts }) => alerts > 0))
    items.push(
      priority(
        "multiunit-attention",
        "Há unidades exigindo atenção",
        "Compare os desvios operacionais antes de priorizar ações.",
        "warning",
        "multiunit",
        "Comparar unidades",
      ),
    );
  if (["owner", "manager", "waiter"].includes(profile) && reservations?.overdue)
    items.push(
      priority(
        "late-reservations",
        `${reservations.overdue} reserva(s) atrasada(s)`,
        "Confirme chegada ou ausência.",
        "warning",
        "reservations",
        "Ver reservas",
      ),
    );
  if (["owner", "manager", "waiter"].includes(profile) && reservations?.upcoming)
    items.push(
      priority(
        "upcoming-reservations",
        `${reservations.upcoming} reserva(s) nas próximas 2 horas`,
        "Prepare a recepção e as mesas.",
        "info",
        "reservations",
        "Ver agenda",
      ),
    );
  if (["owner", "manager", "waiter", "receptionist"].includes(profile) && reservations?.waitlist)
    items.push(
      priority(
        "waitlist",
        `${reservations.waitlist} grupo(s) na fila de espera`,
        "Acompanhe a disponibilidade de mesas.",
        "warning",
        "reservations",
        "Abrir fila",
      ),
    );
  if (["owner", "manager", "waiter", "busser"].includes(profile) && operation?.turnoverTables)
    items.push(
      priority(
        "table-turnover",
        `${operation.turnoverTables} mesa(s) aguardando liberação`,
        "Assuma a limpeza e confirme quando a mesa estiver pronta.",
        "warning",
        "salon",
        "Abrir salão",
      ),
    );
  const severity: Record<OverviewTone, number> = {
    danger: 0,
    warning: 1,
    info: 2,
    neutral: 3,
    success: 4,
  };
  return items.sort((left, right) => severity[left.tone] - severity[right.tone]).slice(0, 5);
}

const quickActions: Record<
  OverviewProfileId,
  { id: string; label: string; route: OverviewRoute }[]
> = {
  accountant: [],
  owner: [
    { id: "reports", label: "Ver relatórios", route: "reports" },
    { id: "finance", label: "Abrir financeiro", route: "finance" },
    { id: "multiunit", label: "Comparar unidades", route: "multiunit" },
  ],
  manager: [
    { id: "salon", label: "Abrir salão", route: "salon" },
    { id: "kds", label: "Abrir produção", route: "kds" },
    { id: "people", label: "Ver equipe", route: "people" },
  ],
  waiter: [
    { id: "salon", label: "Abrir salão", route: "salon" },
    { id: "counter", label: "Nova comanda", route: "counter" },
    { id: "reservations", label: "Ver reservas", route: "reservations" },
  ],
  receptionist: [
    { id: "reservations", label: "Abrir recepção", route: "reservations" },
    { id: "salon", label: "Ver disponibilidade", route: "salon" },
  ],
  busser: [{ id: "salon", label: "Ver mesas para limpeza", route: "salon" }],
  cashier: [
    { id: "cash", label: "Operar caixa", route: "cash" },
    { id: "counter", label: "Receber comanda", route: "counter" },
    { id: "catalog", label: "Consultar cardápio", route: "catalog" },
  ],
  kitchen: [
    { id: "kds", label: "Abrir produção", route: "kds" },
    { id: "catalog", label: "Ver disponibilidade", route: "catalog" },
  ],
  inventory: [
    { id: "inventory", label: "Registrar contagem", route: "inventory" },
    { id: "purchases", label: "Receber compra", route: "purchases" },
  ],
  finance: [
    { id: "finance", label: "Abrir financeiro", route: "finance" },
    { id: "cash", label: "Conferir caixa", route: "cash" },
    { id: "reports", label: "Ver relatórios", route: "reports" },
  ],
  delivery: [
    { id: "delivery", label: "Abrir entregas", route: "delivery" },
    { id: "counter", label: "Ver pedidos", route: "counter" },
    { id: "reservations", label: "Ver agenda", route: "reservations" },
  ],
};

function percentageChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? "Sem variação" : "Sem base anterior";
  const value = Math.round(((current - previous) / Math.abs(previous)) * 100);
  return `${value > 0 ? "+" : ""}${value}%`;
}

function comparisonFor(metricId: string, snapshot: OverviewSnapshot) {
  const operation = snapshot.operations;
  const inventory = snapshot.inventory;
  const values: Record<string, [number, number] | undefined> = {
    sales: operation && [operation.salesCents, operation.previousSalesCents],
    "average-ticket": operation && [
      operation.closedTabs ? operation.salesCents / operation.closedTabs : 0,
      operation.previousClosedTabs
        ? operation.previousSalesCents / operation.previousClosedTabs
        : 0,
    ],
    received: operation && [operation.receivedCents, operation.previousReceivedCents],
    "events-today": inventory && [inventory.eventsToday, inventory.previousEvents],
  };
  const value = values[metricId];
  if (!value) return undefined;
  const change = percentageChange(value[0], value[1]);
  return {
    label: "Período anterior",
    value: change,
    tone: value[0] >= value[1] ? ("success" as const) : ("warning" as const),
  };
}

function goalFor(metricId: string, snapshot: OverviewSnapshot, preferences: OverviewPreferences) {
  const thresholds = preferences.thresholds;
  const operation = snapshot.operations;
  const inventory = snapshot.inventory;
  const finance = snapshot.finance;
  const delivery = snapshot.delivery;
  const goals: Record<string, [number, number, "minimum" | "maximum"] | undefined> = {
    sales:
      operation && thresholds.salesGoalCents > 0
        ? [operation.salesCents, thresholds.salesGoalCents, "minimum"]
        : undefined,
    "late-kds": operation && [operation.kdsDelayed, thresholds.maxKdsDelayed, "maximum"],
    "kds-late": operation && [operation.kdsDelayed, thresholds.maxKdsDelayed, "maximum"],
    "out-of-stock": inventory && [inventory.outOfStock, thresholds.maxStockouts, "maximum"],
    "delivery-delayed": delivery && [delivery.delayed, thresholds.maxDeliveryDelayed, "maximum"],
    reconciliation: finance && [
      finance.unresolvedReconciliations,
      thresholds.maxReconciliations,
      "maximum",
    ],
  };
  const goal = goals[metricId];
  if (!goal) return undefined;
  const met = goal[2] === "minimum" ? goal[0] >= goal[1] : goal[0] <= goal[1];
  const label =
    metricId === "sales"
      ? `Meta ${money(goal[1])}`
      : `Meta ${goal[2] === "maximum" ? "até " : ""}${goal[1]}`;
  return { label, tone: met ? ("success" as const) : ("warning" as const) };
}

export function shapeManagementOverview(
  profileId: OverviewProfileId,
  generatedAt: Date,
  snapshot: OverviewSnapshot,
  unavailableSources: readonly string[] = [],
  preferences: OverviewPreferences = defaultOverviewPreferences,
) {
  const allowed = new Set(overviewRoutes[profileId]);
  const metrics = roleMetrics(profileId, snapshot)
    .filter(({ route }) => allowed.has(route))
    .map((metric) => ({
      ...metric,
      comparison: comparisonFor(metric.id, snapshot),
      goal: goalFor(metric.id, snapshot, preferences),
    }));
  const visiblePriorities = priorities(profileId, snapshot).filter(({ route }) =>
    allowed.has(route),
  );
  const operation = snapshot.operations;
  const reservation = snapshot.reservations;
  const inventory = snapshot.inventory;
  const finance = snapshot.finance;
  const delivery = snapshot.delivery;
  const pulse: Array<{
    id: string;
    label: string;
    value: string;
    route?: OverviewRoute;
    source: OverviewSourceId;
  }> = [];
  if (operation) {
    pulse.push({
      id: "open-tabs",
      label: "Comandas abertas",
      value: count(operation.openTabs),
      route: allowed.has("counter") ? "counter" : undefined,
      source: "operations",
    });
    pulse.push({
      id: "active-team",
      label: "Equipe ativa",
      value: count(operation.activePeople),
      route: allowed.has("people") ? "people" : undefined,
      source: "operations",
    });
  }
  if (profileId === "manager" && operation)
    pulse.push({
      id: "workload",
      label: "Mesas por pessoa",
      value: operation.activePeople
        ? (operation.occupiedTables / operation.activePeople).toFixed(1).replace(".", ",")
        : "—",
      route: "people",
      source: "operations",
    });
  if (profileId === "kitchen" && operation?.busiestStationLabel)
    pulse.push({
      id: "busiest-station",
      label: "Maior fila",
      value: `${operation.busiestStationLabel} · ${operation.busiestStationQueue}`,
      route: "kds",
      source: "operations",
    });
  if (profileId === "cashier" && operation)
    pulse.push({
      id: "cash-readiness",
      label: "Pendências de fechamento",
      value: count(operation.openTabs + (finance?.unresolvedReconciliations ?? 0)),
      route: "cash",
      source: "cash",
    });
  if (profileId === "inventory" && inventory)
    pulse.push({
      id: "supplier-delays",
      label: "Fornecedores atrasados",
      value: count(inventory.supplierDelays),
      route: "purchases",
      source: "inventory",
    });
  if (profileId === "finance" && finance)
    pulse.push({
      id: "finance-due-soon",
      label: "Saldo dos próximos 7 dias",
      value: money(finance.receivablesDueSoonCents - finance.payablesDueSoonCents),
      route: "finance",
      source: "finance",
    });
  if (profileId === "delivery" && delivery)
    pulse.push({
      id: "courier-load",
      label: "Entregadores ocupados",
      value: `${delivery.busyCouriers}/${delivery.totalCouriers}`,
      route: "delivery",
      source: "delivery",
    });
  if (reservation)
    pulse.push({
      id: "upcoming-reservations",
      label: "Reservas próximas",
      value: count(reservation.upcoming),
      route: allowed.has("reservations") ? "reservations" : undefined,
      source: "reservations",
    });
  const activeShift =
    profileId === "cashier" && snapshot.cashShift
      ? { label: "Turno de caixa", startsAt: snapshot.cashShift.startsAt.toISOString() }
      : snapshot.activeShift
        ? {
            label: snapshot.activeShift.label,
            startsAt: snapshot.activeShift.startsAt.toISOString(),
          }
        : null;
  return {
    profileId,
    generatedAt: generatedAt.toISOString(),
    unavailableSources: [...unavailableSources].sort(),
    activeShift,
    metrics,
    priorities: visiblePriorities,
    pulse,
    multiunit: profileId === "owner" ? (snapshot.multiunit ?? []) : [],
    quickActions: quickActions[profileId].filter(({ route }) => allowed.has(route)),
  };
}
