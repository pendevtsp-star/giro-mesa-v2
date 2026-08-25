import type { FloorTable, PilotFloor, PosTab, ServiceMode } from "../../operations.shared";

export const SALON_ROLE_CONFIG: Record<
  string,
  { title: string; badge: string; tone: string; description: string }
> = {
  owner: {
    title: "Proprietário",
    badge: "Acesso total",
    tone: "brand",
    description: "Visão gerencial completa e controle de turnos e espaço.",
  },
  manager: {
    title: "Gerente de operação",
    badge: "Gestão do salão",
    tone: "brand",
    description: "Supervisão do turno, exceções e gestão de praças.",
  },
  cashier: {
    title: "Operador de caixa",
    badge: "Contas e pagamentos",
    tone: "warning",
    description: "Foco em contas solicitadas, divisão, impressão e recebimento.",
  },
  waiter: {
    title: "Garçom / Atendente",
    badge: "Atendimento",
    tone: "info",
    description: "Foco nas próprias mesas, pedidos prontos e chamados.",
  },
  receptionist: {
    title: "Recepção",
    badge: "Disponibilidade",
    tone: "info",
    description: "Foco em disponibilidade, reservas e chegada dos clientes.",
  },
  busser: {
    title: "Auxiliar de salão",
    badge: "Giro de mesas",
    tone: "warning",
    description: "Foco nas mesas que precisam de limpeza e liberação.",
  },
};

export const DEFAULT_SALON_ROLE_CONFIG = {
  title: "Operador",
  badge: "Salão",
  tone: "neutral",
  description: "Operação e acompanhamento das mesas do salão.",
};

export type SalonPreflightItem = {
  id: string;
  label: string;
  detail: string;
  ready: boolean;
  blocking: boolean;
};

export function buildSalonPreflight(floor: PilotFloor): SalonPreflightItem[] {
  const activeRooms = floor.rooms.filter((room) => room.active);
  const activeTables = floor.tables.filter((table) => table.active);
  const assignedTableIds = new Set(floor.shiftSectionTables.map((row) => row.tableId));
  const sectionsWithPrimary = new Set(
    floor.shiftSectionStaff
      .filter((row) => row.role === "primary")
      .map((row) => row.shiftSectionId),
  );
  const unassignedTables = floor.activeShift
    ? activeTables.filter((table) => !assignedTableIds.has(table.id)).length
    : activeTables.filter(
        (table) => !floor.serviceSectionTables.some((row) => row.tableId === table.id),
      ).length;
  const sectionsWithoutPrimary = floor.activeShift
    ? floor.shiftSections.filter((section) => !sectionsWithPrimary.has(section.id)).length
    : floor.serviceSections.filter((section) => !section.defaultResponsibleIdentityId).length;

  return [
    {
      id: "space",
      label: "Espaço físico",
      detail:
        activeRooms.length && activeTables.length
          ? `${activeRooms.length} ambiente(s) e ${activeTables.length} mesa(s)`
          : "Crie ao menos um ambiente e uma mesa",
      ready: activeRooms.length > 0 && activeTables.length > 0,
      blocking: true,
    },
    {
      id: "sections",
      label: "Praças",
      detail: floor.activeShift
        ? `${floor.shiftSections.length} praça(s) no turno`
        : `${floor.serviceSections.length} modelo(s) reutilizável(is)`,
      ready: floor.activeShift ? floor.shiftSections.length > 0 : floor.serviceSections.length > 0,
      blocking: true,
    },
    {
      id: "tables",
      label: "Mesas atribuídas",
      detail: unassignedTables
        ? `${unassignedTables} mesa(s) ainda sem praça`
        : "Todas as mesas estão cobertas",
      ready: unassignedTables === 0,
      blocking: false,
    },
    {
      id: "staff",
      label: "Responsáveis",
      detail: sectionsWithoutPrimary
        ? `${sectionsWithoutPrimary} praça(s) sem titular`
        : "Todas as praças têm titular",
      ready: sectionsWithoutPrimary === 0,
      blocking: false,
    },
  ];
}

export function resolveShiftServiceMode(
  sections: ReadonlyArray<{ serviceMode: ServiceMode }>,
): ServiceMode {
  const modes = new Set(sections.map((section) => section.serviceMode));
  return modes.size === 1 ? (modes.values().next().value ?? "hybrid") : "hybrid";
}

export type TableTimelineItem = {
  id: string;
  at: string;
  label: string;
  detail?: string;
};

export function buildTableTimeline({
  table,
  tab,
  phase,
  call,
  transfer,
}: {
  table: FloorTable;
  tab: PosTab | null;
  phase?: PilotFloor["tablePhases"][number];
  call?: PilotFloor["serviceCalls"][number];
  transfer?: PilotFloor["shiftTableTransfers"][number];
}) {
  const items: TableTimelineItem[] = [];
  const openedAt = tab?.openedAt ?? tab?.createdAt ?? table.openedAt;
  if (openedAt) {
    items.push({ id: "opened", at: openedAt, label: "Atendimento iniciado" });
  }
  if (phase) {
    const phaseLabels = {
      awaiting_order: "Aguardando pedido",
      production: "Pedido em produção",
      ready: "Pedido pronto para servir",
      served: "Pedido servido",
    } as const;
    items.push({ id: "phase", at: phase.since, label: phaseLabels[phase.phase] });
  }
  if (call) {
    items.push({
      id: "call",
      at: call.createdAt,
      label: call.kind === "bill" ? "Conta solicitada" : "Chamado aberto",
      detail: call.status === "acknowledged" ? "Chamado assumido" : undefined,
    });
    if (call.acknowledgedAt) {
      items.push({ id: "acknowledged", at: call.acknowledgedAt, label: "Chamado assumido" });
    }
  }
  if (transfer) {
    items.push({
      id: "transfer",
      at: transfer.expiresAt,
      label: "Remanejamento termina",
      detail: transfer.reason,
    });
  }
  return items.sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime());
}

export function tableNextAction({
  status,
  hasTab,
  canOperate,
  phase,
  callKind,
}: {
  status: string;
  hasTab: boolean;
  canOperate: boolean;
  phase?: PilotFloor["tablePhases"][number]["phase"];
  callKind?: PilotFloor["serviceCalls"][number]["kind"];
}) {
  if (!canOperate) return "Acompanhar panorama";
  if (callKind === "bill") return "Preparar conta";
  if (callKind) return "Atender chamado";
  if (status === "needs_cleaning") return "Assumir limpeza";
  if (status === "cleaning") return "Liberar mesa";
  if (!hasTab && status === "reserved") return "Confirmar chegada";
  if (!hasTab) return "Iniciar atendimento";
  if (phase === "ready") return "Servir pedido";
  if (phase === "production") return "Acompanhar produção";
  if (phase === "awaiting_order") return "Adicionar pedido";
  return "Continuar atendimento";
}
