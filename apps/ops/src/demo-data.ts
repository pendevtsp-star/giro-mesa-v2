import type {
  AlertItem,
  DiningTable,
  KitchenTicket,
  Organization,
  Product,
  Profile,
  StockItem,
} from "./domain";

const basePermissions = ["dashboard.view", "alerts.view"] as const;

export const profiles: Profile[] = [
  {
    id: "owner",
    name: "Marina Costa",
    shortName: "MC",
    role: "Proprietária",
    description: "Visão completa da operação e gestão",
    permissions: [
      ...basePermissions,
      "onboarding.manage",
      "salon.operate",
      "counter.operate",
      "catalog.manage",
      "kds.operate",
      "cash.operate",
      "inventory.manage",
      "purchases.manage",
      "finance.manage",
      "remuneration.manage",
      "people.manage",
      "delivery.operate",
      "reservations.manage",
      "growth.manage",
      "multiunit.view",
    ],
  },
  {
    id: "manager",
    name: "Rafael Nunes",
    shortName: "RN",
    role: "Gerente",
    description: "Turno, equipe, aprovações e exceções",
    permissions: [
      ...basePermissions,
      "onboarding.manage",
      "salon.operate",
      "counter.operate",
      "catalog.manage",
      "kds.operate",
      "cash.operate",
      "inventory.manage",
      "purchases.manage",
      "finance.manage",
      "remuneration.manage",
      "people.manage",
      "delivery.operate",
      "reservations.manage",
      "growth.manage",
      "multiunit.view",
    ],
  },
  {
    id: "waiter",
    name: "Lia Martins",
    shortName: "LM",
    role: "Garçom",
    description: "Mesas, chamados e pedidos",
    permissions: [
      ...basePermissions,
      "salon.operate",
      "counter.operate",
      "catalog.manage",
      "reservations.manage",
    ],
  },
  {
    id: "cashier",
    name: "Bruno Luz",
    shortName: "BL",
    role: "Caixa",
    description: "Recebimentos, turnos e fechamento",
    permissions: [...basePermissions, "counter.operate", "catalog.manage", "cash.operate"],
  },
  {
    id: "kitchen",
    name: "Ana Reis",
    shortName: "AR",
    role: "Cozinha / KDS",
    description: "Produção e disponibilidade",
    permissions: [...basePermissions, "catalog.manage", "kds.operate"],
  },
  {
    id: "inventory",
    name: "Caio Alves",
    shortName: "CA",
    role: "Estoque e compras",
    description: "Suprimentos, contagens e perdas",
    permissions: [...basePermissions, "inventory.manage", "purchases.manage"],
  },
  {
    id: "finance",
    name: "Clara Freire",
    shortName: "CF",
    role: "Financeiro",
    description: "Contas, conciliação e margem",
    permissions: [
      ...basePermissions,
      "cash.operate",
      "purchases.manage",
      "finance.manage",
      "remuneration.manage",
    ],
  },
  {
    id: "delivery",
    name: "Diego Rocha",
    shortName: "DR",
    role: "Delivery",
    description: "Pedidos, prazos e despacho",
    permissions: [
      ...basePermissions,
      "counter.operate",
      "catalog.manage",
      "delivery.operate",
      "reservations.manage",
    ],
  },
  {
    id: "platform",
    name: "Equipe GiroMesa",
    shortName: "GM",
    role: "Plataforma",
    description: "Tenants, suporte e incidentes",
    permissions: [...basePermissions, "platform.manage"],
  },
];

export const organizations: Organization[] = [
  {
    id: "a1111111-1111-4111-8111-111111111111",
    name: "[DEMO] Grupo Aurora",
    document: "00.000.000/0035-00",
    units: [
      {
        id: "b1111111-1111-4111-8111-111111111111",
        name: "[DEMO] Aurora Centro",
        city: "Belo Horizonte, MG",
        timezone: "America/Sao_Paulo",
      },
      {
        id: "b2222222-2222-4222-8222-222222222222",
        name: "[DEMO] Aurora Lagoa",
        city: "Belo Horizonte, MG",
        timezone: "America/Sao_Paulo",
      },
    ],
  },
];

const tableAreas: DiningTable["area"][] = ["Salão principal", "Varanda", "Balcão"];
const tableStatuses: DiningTable["status"][] = [
  "free",
  "occupied",
  "free",
  "attention",
  "free",
  "closing",
  "reserved",
  "free",
];

export const initialTables: DiningTable[] = tableAreas.flatMap((area, areaIndex) =>
  Array.from({ length: 40 }, (_, tableIndex) => {
    const sequence = areaIndex * 40 + tableIndex + 1;
    const status = tableStatuses[tableIndex % tableStatuses.length] ?? "free";
    const isActive = status === "occupied" || status === "attention" || status === "closing";
    return {
      id: `demo-table-${String(sequence).padStart(3, "0")}`,
      name: `Mesa ${String(sequence).padStart(3, "0")}`,
      seats: [2, 4, 4, 6][tableIndex % 4] ?? 4,
      status,
      ...(isActive
        ? {
            server: tableIndex % 2 === 0 ? "Lia" : "Rafael",
            totalCents: 4_000 + sequence * 173,
            openedMinutes: 8 + ((sequence * 7) % 74),
          }
        : {}),
      area,
    };
  }),
);

export const products: Product[] = [
  {
    id: "burger",
    name: "Burger Aurora",
    description: "Carne 160g, queijo meia cura, cebola e molho da casa",
    category: "Principais",
    priceCents: 3890,
    prepMinutes: 18,
    available: true,
    modifiers: [
      { id: "extra-cheese", name: "Queijo extra", priceCents: 500 },
      { id: "no-onion", name: "Sem cebola", priceCents: 0 },
    ],
  },
  {
    id: "risotto",
    name: "Risoto do Cerrado",
    description: "Arroz arbóreo, cogumelos e castanha de baru",
    category: "Principais",
    priceCents: 4690,
    prepMinutes: 24,
    available: true,
    modifiers: [{ id: "vegan", name: "Versão vegana", priceCents: 0 }],
  },
  {
    id: "croquette",
    name: "Croquete de costela",
    description: "Seis unidades com aioli defumado",
    category: "Entradas",
    priceCents: 2990,
    prepMinutes: 12,
    available: true,
    modifiers: [],
  },
  {
    id: "lemonade",
    name: "Limonada da casa",
    description: "Limão siciliano, capim-limão e água com gás",
    category: "Bebidas",
    priceCents: 1450,
    prepMinutes: 5,
    available: true,
    modifiers: [{ id: "no-sugar", name: "Sem açúcar", priceCents: 0 }],
  },
  {
    id: "tiramisu",
    name: "Tiramisù",
    description: "Café, mascarpone e cacau",
    category: "Sobremesas",
    priceCents: 2490,
    prepMinutes: 4,
    available: false,
    modifiers: [],
  },
];

export const initialTickets: KitchenTicket[] = [
  {
    id: "k01",
    reference: "Mesa 03",
    station: "Cozinha",
    items: ["2× Burger Aurora", "1× Risoto do Cerrado"],
    elapsedMinutes: 21,
    status: "new",
    priority: true,
  },
  {
    id: "k02",
    reference: "Mesa 01",
    station: "Bar",
    items: ["2× Limonada da casa"],
    elapsedMinutes: 4,
    status: "preparing",
  },
  {
    id: "k03",
    reference: "Balcão #184",
    station: "Cozinha",
    items: ["1× Croquete de costela", "1× Burger Aurora"],
    elapsedMinutes: 9,
    status: "ready",
  },
  {
    id: "k04",
    reference: "Varanda 01",
    station: "Cozinha",
    items: ["1× Risoto do Cerrado"],
    elapsedMinutes: 16,
    status: "preparing",
  },
];

export const stock: StockItem[] = [
  {
    id: "s1",
    name: "Carne burger 160g",
    unit: "un",
    quantity: 18,
    minimum: 24,
    costCents: 920,
    supplier: "Carnes Minas",
  },
  {
    id: "s2",
    name: "Arroz arbóreo",
    unit: "kg",
    quantity: 6.4,
    minimum: 5,
    costCents: 3280,
    supplier: "Empório Sul",
  },
  {
    id: "s3",
    name: "Limão siciliano",
    unit: "kg",
    quantity: 2.1,
    minimum: 4,
    costCents: 1680,
    supplier: "Horta Viva",
  },
  {
    id: "s4",
    name: "Queijo meia cura",
    unit: "kg",
    quantity: 7.3,
    minimum: 3,
    costCents: 5840,
    supplier: "Serra Laticínios",
  },
  {
    id: "s5",
    name: "Mascarpone",
    unit: "kg",
    quantity: 0,
    minimum: 2,
    costCents: 7470,
    supplier: "Empório Sul",
  },
];

export function createDemoScenario() {
  return {
    metadata: {
      dataset: "giromesa-complete-demo",
      version: 1,
      demoOnly: true,
      referenceTime: "2026-08-10T18:00:00.000Z",
    },
    serviceAreas: [
      { id: "demo-area-main", name: "Salão principal", tableCount: 40 },
      { id: "demo-area-balcony", name: "Varanda", tableCount: 40 },
      { id: "demo-area-counter", name: "Balcão", tableCount: 40 },
    ],
    shifts: [
      { id: "demo-shift-lunch-1", unit: "[DEMO] Aurora Centro", name: "Almoço", state: "closed" },
      { id: "demo-shift-dinner-1", unit: "[DEMO] Aurora Centro", name: "Jantar", state: "open" },
      { id: "demo-shift-lunch-2", unit: "[DEMO] Aurora Lagoa", name: "Almoço", state: "closed" },
      {
        id: "demo-shift-dinner-2",
        unit: "[DEMO] Aurora Lagoa",
        name: "Jantar",
        state: "scheduled",
      },
    ],
    kdsTickets: initialTickets.map((ticket) => ({ ...ticket, items: [...ticket.items] })),
    inventory: {
      locations: [
        { id: "demo-location-main", name: "Estoque principal" },
        { id: "demo-location-bar", name: "Bar" },
      ],
      items: stock.map((item) => ({ ...item })),
    },
    returnables: [
      {
        id: "demo-returnable-keg",
        name: "Barril retornável 30 L",
        tracking: "serialized",
        custody: "unit",
      },
      {
        id: "demo-returnable-crate",
        name: "Engradado 24 unidades",
        tracking: "aggregate",
        custody: "supplier",
      },
      {
        id: "demo-returnable-bottle",
        name: "Garrafa retornável 600 ml",
        tracking: "aggregate",
        custody: "table",
      },
    ],
    incidents: [
      {
        id: "demo-incident-breakage",
        kind: "breakage",
        summary: "Quebra registrada para análise gerencial",
        amountCents: 7_400,
      },
      {
        id: "demo-incident-missing-returnable",
        kind: "missing_returnable",
        summary: "Vasilhame ausente aguardando conferência",
        amountCents: 12_000,
      },
    ],
    finance: {
      payments: [
        { id: "demo-payment-cash", method: "cash", amountCents: 14_680, state: "settled" },
        {
          id: "demo-payment-debit",
          method: "debit_simulator",
          amountCents: 28_740,
          state: "settled",
        },
        {
          id: "demo-payment-voucher",
          method: "voucher_simulator",
          amountCents: 9_230,
          state: "pending",
        },
      ],
      payable: {
        id: "demo-payable-produce",
        description: "Compra demonstrativa de insumos",
        amountCents: 184_000,
      },
      receivable: {
        id: "demo-receivable-event",
        description: "Evento demonstrativo",
        amountCents: 98_000,
      },
    },
    doseClub: {
      provider: "doseclub",
      status: "disabled",
      mode: "simulator",
      mappingCount: 3,
      pendingReconciliationCount: 1,
    },
  } as const;
}

export const alerts: AlertItem[] = [
  {
    id: "a1",
    title: "Mesa 03 acima do tempo",
    detail: "Aberta há 1h16 e com chamado pendente.",
    severity: "critical",
    action: "Abrir mesa",
  },
  {
    id: "a2",
    title: "3 insumos abaixo do mínimo",
    detail: "Carne, limão e mascarpone pedem reposição.",
    severity: "warning",
    action: "Gerar compra",
  },
  {
    id: "a3",
    title: "Caixa ainda não conferido",
    detail: "R$ 428,50 em pagamentos aguardam conferência.",
    severity: "warning",
    action: "Conferir",
  },
  {
    id: "a4",
    title: "Sincronização normal",
    detail: "Último lote confirmado há 12 segundos.",
    severity: "info",
    action: "Ver detalhes",
  },
];

export const profileMetrics: Record<string, { label: string; value: string; detail: string }[]> = {
  owner: [
    { label: "Vendas do turno", value: "R$ 8.742", detail: "+11,8% vs. sexta anterior" },
    { label: "Margem estimada", value: "31,4%", detail: "Meta do mês: 32%" },
    { label: "CMV estimado", value: "29,7%", detail: "Dentro da faixa" },
    { label: "Ticket médio", value: "R$ 82,40", detail: "106 comandas" },
  ],
  manager: [
    { label: "Mesas ocupadas", value: "5 de 9", detail: "2 precisam de atenção" },
    { label: "Tempo médio", value: "18 min", detail: "Produção do turno" },
    { label: "Equipe ativa", value: "11", detail: "1 pausa em andamento" },
    { label: "Aprovações", value: "2", detail: "Desconto e cancelamento" },
  ],
  waiter: [
    { label: "Minhas mesas", value: "3", detail: "1 pediu a conta" },
    { label: "Chamados", value: "2", detail: "Mais antigo há 4 min" },
    { label: "Itens prontos", value: "3", detail: "Retirar no passe" },
    { label: "Vendas", value: "R$ 1.284", detail: "No turno atual" },
  ],
  cashier: [
    { label: "Recebido", value: "R$ 5.360", detail: "68 pagamentos" },
    { label: "Em aberto", value: "R$ 1.246", detail: "7 comandas" },
    { label: "Conferência", value: "R$ 428", detail: "3 lançamentos" },
    { label: "Sangrias", value: "R$ 600", detail: "2 no turno" },
  ],
  kitchen: [
    { label: "Na fila", value: "8", detail: "3 novos tickets" },
    { label: "Tempo médio", value: "17 min", detail: "Meta: até 20 min" },
    { label: "Atrasados", value: "1", detail: "Mesa 03" },
    { label: "Prontos", value: "4", detail: "Aguardando retirada" },
  ],
  inventory: [
    { label: "Abaixo do mínimo", value: "3", detail: "1 item zerado" },
    { label: "Compras abertas", value: "2", detail: "R$ 1.840 estimados" },
    { label: "Perdas hoje", value: "R$ 74", detail: "0,8% do consumo" },
    { label: "Contagem", value: "82%", detail: "18 itens pendentes" },
  ],
  finance: [
    { label: "Saldo projetado", value: "R$ 48,2 mil", detail: "Próximos 30 dias" },
    { label: "A pagar", value: "R$ 18,4 mil", detail: "R$ 4,2 mil esta semana" },
    { label: "A receber", value: "R$ 9,8 mil", detail: "3 valores vencidos" },
    { label: "Conciliação", value: "94%", detail: "6% pendente" },
  ],
  delivery: [
    { label: "Em preparo", value: "6", detail: "1 perto do prazo" },
    { label: "A despachar", value: "3", detail: "2 entregadores disponíveis" },
    { label: "Tempo médio", value: "34 min", detail: "Meta: até 40 min" },
    { label: "Vendas do canal", value: "R$ 1.920", detail: "27 pedidos" },
  ],
  platform: [
    { label: "Organizações", value: "18", detail: "3 em onboarding" },
    { label: "Unidades online", value: "22 de 23", detail: "1 em manutenção" },
    { label: "Incidentes", value: "0", detail: "Sem Sev1/Sev2" },
    { label: "Trial ativo", value: "4", detail: "2 ativam esta semana" },
  ],
};
