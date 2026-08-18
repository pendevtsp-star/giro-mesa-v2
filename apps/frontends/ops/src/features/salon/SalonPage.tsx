import { Badge, Button, Card, EmptyState, Icon, Modal, StatusDot, Toast } from "@giromesa/ui";
import { type FormEvent, useEffect, useState } from "react";
import { api } from "../../api";
import { pilotMutation, QueuedOperationalMutationError } from "../../operational-dispatch";
import {
  type PilotScope,
  parsePilotFloor,
  RemoteGate,
  type ServiceMode,
  useRemote,
  usesQuickServiceMode,
} from "../../operations.shared";
import { formatMoney } from "../../rules";
import { TabWorkspace } from "../counter/CounterWorkspace";
import {
  buildJoinedShiftLayout,
  FloorPlan,
  type FloorPlanPosition,
  type FloorPlanZonePosition,
} from "./FloorPlan";
import { MoveTableDialog } from "./MoveTableDialog";
import { SalonSearch } from "./SalonSearch";
import { buildSequentialTableNames, MAX_TABLE_BATCH } from "./tableNames";

type FloorFilter =
  | "all"
  | "available"
  | "occupied"
  | "attention"
  | "closing"
  | "reserved"
  | "turnover";
type OperationalTableStatus =
  | Exclude<FloorFilter, "all" | "turnover">
  | "needs_cleaning"
  | "cleaning";

export function findPriorityServiceCall<T extends { kind: string; tableId: string }>(
  calls: readonly T[],
  tableIds: readonly string[],
) {
  const relevant = calls.filter((call) => tableIds.includes(call.tableId));
  return relevant.find((call) => call.kind === "bill") ?? relevant[0];
}

export function tableStatusPresentation(status: OperationalTableStatus) {
  switch (status) {
    case "occupied":
      return {
        className: "occupied",
        label: "Em atendimento",
        pulse: false,
        tone: "info",
      } as const;
    case "attention":
      return { className: "attention", label: "Chamando", pulse: true, tone: "danger" } as const;
    case "closing":
      return {
        className: "closing",
        label: "Pediu a conta",
        pulse: true,
        tone: "warning",
      } as const;
    case "reserved":
      return { className: "reserved", label: "Reservada", pulse: false, tone: "neutral" } as const;
    case "needs_cleaning":
      return {
        className: "needs-cleaning",
        label: "Aguardando limpeza",
        pulse: false,
        tone: "warning",
      } as const;
    case "cleaning":
      return {
        className: "cleaning",
        label: "Em limpeza",
        pulse: false,
        tone: "info",
      } as const;
    default:
      return { className: "available", label: "Livre", pulse: false, tone: "success" } as const;
  }
}

const servicePhasePresentation = {
  awaiting_order: "Aguardando pedido",
  production: "Em produção",
  ready: "Pronto para servir",
  served: "Pedido servido",
} as const;

export function buildTableTransferCommand(tabId: string, targetTableId: string) {
  const body = { tableId: targetTableId, reason: "Mudança de mesa pelo atendimento" };
  return { body, payload: pilotMutation("transfer-tab", { tabId, body }) };
}

export function RealSalonPage({ scope }: { scope: PilotScope }) {
  const floor = useRemote(
    scope,
    () => scope.load("floor", undefined, () => api.pilot.floor(scope.organizationId, scope.unitId)),
    parsePilotFloor,
  );
  const nextTransferBoundary =
    floor.state.status === "ready"
      ? Math.min(
          ...floor.state.data.shiftTableTransfers.flatMap((transfer) => {
            const expiry = new Date(transfer.expiresAt).getTime();
            const warning = expiry - 15 * 60_000;
            return [expiry, warning > Date.now() ? warning : Number.POSITIVE_INFINITY];
          }),
        )
      : Number.POSITIVE_INFINITY;
  useEffect(() => {
    if (!Number.isFinite(nextTransferBoundary)) return;
    const timer = globalThis.setTimeout(
      floor.retry,
      Math.max(0, nextTransferBoundary - Date.now()) + 250,
    );
    return () => globalThis.clearTimeout(timer);
  }, [nextTransferBoundary, floor.retry]);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<FloorFilter>("all");
  const [roomFilter, setRoomFilter] = useState("all");
  const [sectionFilter, setSectionFilter] = useState(scope.profileId === "waiter" ? "mine" : "all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"map" | "floor" | "list">("map");
  const [showMetricsCockpit, setShowMetricsCockpit] = useState(false);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const [moveTableOpen, setMoveTableOpen] = useState(false);
  const canConfigure = scope.profileId === "owner" || scope.profileId === "manager";
  const canReorganizeTurn = ["owner", "manager", "waiter"].includes(scope.profileId);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      ) {
        if (event.key === "Escape") {
          (event.target as HTMLElement).blur();
        }
        return;
      }

      if (event.key === "Escape") {
        setSelectedTableId(null);
        setSetupOpen(false);
        setJoinDialogOpen(false);
        setTransferDialogOpen(false);
        setShortcutsModalOpen(false);
        return;
      }

      if (event.key === "/" || event.key === "f" || event.key === "F") {
        event.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>(".salon-search input");
        searchInput?.focus();
        return;
      }

      if ((event.key === "j" || event.key === "J") && canReorganizeTurn) {
        event.preventDefault();
        setJoinMode((current) => !current);
        setJoinSelection([]);
        return;
      }

      if (event.key === "v" || event.key === "V") {
        event.preventDefault();
        setView((current) => (current === "map" ? "floor" : current === "floor" ? "list" : "map"));
        return;
      }

      if (event.key === "?") {
        event.preventDefault();
        setShortcutsModalOpen((current) => !current);
        return;
      }

      if (event.key >= "1" && event.key <= "6") {
        const filterMap: FloorFilter[] = [
          "all",
          "available",
          "occupied",
          "attention",
          "closing",
          "reserved",
        ];
        const index = Number(event.key) - 1;
        if (filterMap[index]) {
          event.preventDefault();
          setFilterStatus(filterMap[index]);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canReorganizeTurn]);
  const [priorityQueueOpen, setPriorityQueueOpen] = useState(true);
  const [guests, setGuests] = useState(2);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedbackState] = useState<{
    message: string;
    tone: "success" | "danger" | "info";
  } | null>(null);
  const [roomName, setRoomName] = useState("");
  const [roomId, setRoomId] = useState("");
  const [tableMode, setTableMode] = useState<"single" | "batch">("single");
  const [tableLabel, setTableLabel] = useState("");
  const [tablePrefix, setTablePrefix] = useState("Mesa");
  const [tableStart, setTableStart] = useState(1);
  const [tableQuantity, setTableQuantity] = useState(4);
  const [tableSeats, setTableSeats] = useState(4);
  const [setupOpen, setSetupOpen] = useState(false);
  const [joinMode, setJoinMode] = useState(false);
  const [joinSelection, setJoinSelection] = useState<string[]>([]);
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const [joinAccountMode, setJoinAccountMode] = useState<
    "layout_only" | "physical_only" | "single_tab"
  >("single_tab");
  const [joinAnchorId, setJoinAnchorId] = useState("");
  const [joinResponsibleIdentityId, setJoinResponsibleIdentityId] = useState("");
  const [selectedTabId, setSelectedTabId] = useState<string | null>(null);

  const [detachTableId, setDetachTableId] = useState("");
  const [floorFocusId, setFloorFocusId] = useState<string | null>(null);
  const [floorEditRequestKey, setFloorEditRequestKey] = useState(0);
  const [setupSection, setSetupSection] = useState<"space" | "shift">("space");
  const [serviceSectionName, setServiceSectionName] = useState("");
  const [serviceSectionColor, setServiceSectionColor] = useState("#176B4D");
  const [serviceSectionMode, setServiceSectionMode] = useState<ServiceMode>("hybrid");
  const [serviceSectionTableIds, setServiceSectionTableIds] = useState<string[]>([]);
  const [serviceSectionDefaultResponsibleId, setServiceSectionDefaultResponsibleId] = useState("");
  const [shiftLabel, setShiftLabel] = useState("");
  const [shiftMode, setShiftMode] = useState<ServiceMode>("hybrid");
  const [copyPreviousAssignments, setCopyPreviousAssignments] = useState(true);
  const [assignmentSectionId, setAssignmentSectionId] = useState("");
  const [assignmentPrimaryId, setAssignmentPrimaryId] = useState("");
  const [assignmentSupportIds, setAssignmentSupportIds] = useState<string[]>([]);
  const [assignmentTableIds, setAssignmentTableIds] = useState<string[]>([]);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [transferTargetSectionId, setTransferTargetSectionId] = useState("");
  const [transferDurationMinutes, setTransferDurationMinutes] = useState(60);
  const [transferOpenTab, setTransferOpenTab] = useState(true);
  const [transferReason, setTransferReason] = useState("Remanejamento durante a operação");
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [handoverAssignments, setHandoverAssignments] = useState<Record<string, string>>({});
  const [handoverReason, setHandoverReason] = useState("Passagem para a próxima equipe");
  function setFeedback(message: string, tone: "success" | "danger" | "info" = "success") {
    setFeedbackState(message ? { message, tone } : null);
  }

  function setErrorFeedback(error: unknown, fallback: string) {
    setFeedback(
      error instanceof Error ? error.message : fallback,
      error instanceof QueuedOperationalMutationError ? "info" : "danger",
    );
  }

  async function handleMoveEntireTable(targetTableId: string, currentTableId: string) {
    if (!currentTableId || !targetTableId) return;
    setBusy(true);
    try {
      const currentTab =
        floor.state.status === "ready"
          ? floor.state.data.openTabs.find((t) => t.tableId === currentTableId)
          : null;
      if (!currentTab)
        throw new Error("A comanda não está mais aberta nesta mesa. Atualize o salão.");
      const { body, payload } = buildTableTransferCommand(currentTab.id, targetTableId);
      await scope.dispatch("pos.tab.transfer_requested", payload, (key) =>
        api.pilot.transferTab(scope.organizationId, scope.unitId, currentTab.id, body, key),
      );
      setSelectedTableId(targetTableId);
      setFeedback("Comanda e pedidos transferidos com sucesso para a nova mesa.");
      floor.retry();
    } catch (error) {
      setErrorFeedback(error, "Não foi possível mudar de mesa.");
    } finally {
      setBusy(false);
    }
  }

  const batchNames = buildSequentialTableNames(tablePrefix, tableStart, tableQuantity);
  const tableNames = tableMode === "single" ? [tableLabel.trim()].filter(Boolean) : batchNames;

  return (
    <RemoteGate remote={floor}>
      {(data) => {
        const table = data.tables.find((item) => item.id === selectedTableId) ?? null;
        const groupMembers = (groupId: string) =>
          data.tableGroupMembers
            .filter((member) => member.groupId === groupId)
            .map((member) => member.tableId);
        const groupForTable = (tableId: string) => {
          const membership = data.tableGroupMembers.find((member) => member.tableId === tableId);
          return membership
            ? data.tableGroups.find((group) => group.id === membership.groupId)
            : undefined;
        };
        const serviceCallForTable = (tableId: string) => {
          const group = groupForTable(tableId);
          const memberIds = group ? groupMembers(group.id) : [tableId];
          return findPriorityServiceCall(data.serviceCalls, memberIds);
        };
        const selectedGroup = table ? groupForTable(table.id) : undefined;
        const selectedGroupResponsible = selectedGroup?.responsibleIdentityId
          ? data.staff.find((person) => person.identityId === selectedGroup.responsibleIdentityId)
          : undefined;
        const selectedGroupTableIds = selectedGroup ? groupMembers(selectedGroup.id) : [];
        const selectedGroupTabs = selectedGroup
          ? data.openTabs.filter(
              (tab) => tab.tableId && selectedGroupTableIds.includes(tab.tableId),
            )
          : [];
        const tab = table
          ? (data.openTabs.find((item) => item.id === selectedTabId) ??
            data.openTabs.find((item) => item.id === selectedGroup?.primaryTabId) ??
            data.openTabs.find((item) => item.tableId === table.id) ??
            selectedGroupTabs[0] ??
            null)
          : null;
        const selectedTabResponsible = tab?.responsibleIdentityId
          ? data.staff.find((person) => person.identityId === tab.responsibleIdentityId)
          : undefined;
        const selectedTabOpenedMinutes = tab?.openedAt
          ? Math.max(0, Math.floor((Date.now() - new Date(tab.openedAt).getTime()) / 60_000))
          : 0;
        const allActiveTables = data.tables.filter((item) => item.active);
        const groupedMembers = new Set(
          data.tableGroupMembers
            .filter((member) => {
              const group = data.tableGroups.find((candidate) => candidate.id === member.groupId);
              return group && group.anchorTableId !== member.tableId;
            })
            .map((member) => member.tableId),
        );
        const activeTables = allActiveTables.filter((item) => !groupedMembers.has(item.id));
        const displayStatus = (item: (typeof data.tables)[number]) => {
          const group = groupForTable(item.id);
          const memberIds = group ? groupMembers(group.id) : [item.id];
          if (
            data.serviceCalls.some(
              (call) => call.kind === "bill" && memberIds.includes(call.tableId),
            )
          ) {
            return "closing" as const;
          }
          if (
            data.serviceCalls.some(
              (call) => call.kind !== "bill" && memberIds.includes(call.tableId),
            )
          ) {
            return "attention" as const;
          }
          if (!group) return item.status;
          if (data.openTabs.some((open) => open.tableId && memberIds.includes(open.tableId))) {
            return "occupied" as const;
          }
          if (
            data.tables.some(
              (candidate) => memberIds.includes(candidate.id) && candidate.status === "reserved",
            )
          ) {
            return "reserved" as const;
          }
          if (
            data.tables.some(
              (candidate) => memberIds.includes(candidate.id) && candidate.status === "cleaning",
            )
          ) {
            return "cleaning" as const;
          }
          if (
            data.tables.some(
              (candidate) =>
                memberIds.includes(candidate.id) && candidate.status === "needs_cleaning",
            )
          ) {
            return "needs_cleaning" as const;
          }
          return "available" as const;
        };
        const servicePhaseForTable = (tableId: string) => {
          const group = groupForTable(tableId);
          const memberIds = group ? groupMembers(group.id) : [tableId];
          const phases = data.tablePhases.filter((phase) => memberIds.includes(phase.tableId));
          return (
            phases.find((phase) => phase.phase === "ready") ??
            phases.find((phase) => phase.phase === "production") ??
            phases.find((phase) => phase.phase === "awaiting_order") ??
            phases.find((phase) => phase.phase === "served")
          );
        };
        const baseShiftSectionForTable = (tableId: string) => {
          const membership = data.shiftSectionTables.find((row) => row.tableId === tableId);
          return membership
            ? data.shiftSections.find((section) => section.id === membership.shiftSectionId)
            : undefined;
        };
        const transferForTable = (tableId: string) =>
          data.shiftTableTransfers.find((row) => row.tableId === tableId);
        const shiftSectionForTable = (tableId: string) => {
          const transfer = transferForTable(tableId);
          return transfer
            ? data.shiftSections.find((section) => section.id === transfer.targetShiftSectionId)
            : baseShiftSectionForTable(tableId);
        };
        const primaryForSection = (shiftSectionId: string) => {
          const assignment = data.shiftSectionStaff.find(
            (row) => row.shiftSectionId === shiftSectionId && row.role === "primary",
          );
          return assignment
            ? data.staff.find((person) => person.identityId === assignment.identityId)
            : undefined;
        };
        const operationalAssignmentForTable = (tableId: string) => {
          const section = shiftSectionForTable(tableId);
          return section ? { section, primary: primaryForSection(section.id) } : null;
        };
        const selectedAssignment = table ? operationalAssignmentForTable(table.id) : null;
        const selectedTransfer = table
          ? (transferForTable(table.id) ??
            selectedGroupTableIds.map(transferForTable).find(Boolean))
          : undefined;
        const selectedCall = table ? serviceCallForTable(table.id) : undefined;
        const selectedBaseSection = table ? baseShiftSectionForTable(table.id) : undefined;
        const selectedSectionRole = selectedAssignment
          ? data.shiftSectionStaff.find(
              (row) =>
                row.shiftSectionId === selectedAssignment.section.id &&
                row.identityId === scope.identityId,
            )?.role
          : undefined;
        const selectedServiceMode = table
          ? (operationalAssignmentForTable(table.id)?.section.serviceMode ?? data.serviceMode)
          : data.serviceMode;
        const selectedUsesQuickFlow = usesQuickServiceMode(selectedServiceMode);
        const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
        const filteredTables = activeTables.filter((item) => {
          const status = displayStatus(item);
          if (
            filterStatus !== "all" &&
            (filterStatus === "turnover"
              ? status !== "needs_cleaning" && status !== "cleaning"
              : status !== filterStatus)
          ) {
            return false;
          }
          if (roomFilter !== "all" && item.roomId !== roomFilter) return false;
          const assignment = operationalAssignmentForTable(item.id);
          if (
            sectionFilter === "mine" &&
            data.activeShift &&
            !data.shiftSectionStaff.some(
              (row) =>
                row.shiftSectionId === assignment?.section.id &&
                row.identityId === scope.identityId,
            )
          ) {
            return false;
          }
          if (
            sectionFilter !== "all" &&
            sectionFilter !== "mine" &&
            assignment?.section.id !== sectionFilter
          ) {
            return false;
          }
          if (!normalizedQuery) return true;
          const room = data.rooms.find((candidate) => candidate.id === item.roomId)?.name ?? "";
          const group = groupForTable(item.id);
          const memberLabels = group
            ? groupMembers(group.id)
                .flatMap((id) => data.tables.find((candidate) => candidate.id === id)?.label ?? [])
                .join(" ")
            : "";
          return `${item.label} ${memberLabels} ${room} ${assignment?.section.name ?? ""} ${assignment?.primary?.displayName ?? ""}`
            .toLocaleLowerCase("pt-BR")
            .includes(normalizedQuery);
        });
        const counts = {
          all: activeTables.length,
          available: activeTables.filter((item) => displayStatus(item) === "available").length,
          occupied: activeTables.filter((item) => displayStatus(item) === "occupied").length,
          attention: activeTables.filter((item) => displayStatus(item) === "attention").length,
          closing: activeTables.filter((item) => displayStatus(item) === "closing").length,
          reserved: activeTables.filter((item) => displayStatus(item) === "reserved").length,
          turnover: activeTables.filter((item) =>
            ["needs_cleaning", "cleaning"].includes(displayStatus(item)),
          ).length,
        };
        const advancedFilterCount =
          Number(roomFilter !== "all") +
          Number(Boolean(data.activeShift) && sectionFilter !== "all");
        const totalActiveSalonCents = data.openTabs.reduce((sum, open) => sum + open.totalCents, 0);
        const activeOpenTabs = data.openTabs.filter((open) => open.status === "open");
        const totalSeats = allActiveTables.reduce((sum, item) => sum + item.seats, 0);
        const occupiedTablesList = activeTables.filter((item) =>
          ["occupied", "attention", "closing"].includes(displayStatus(item)),
        );
        const occupiedTableIds = new Set(
          occupiedTablesList.flatMap((item) => {
            const group = groupForTable(item.id);
            return group ? groupMembers(group.id) : [item.id];
          }),
        );
        const occupiedSeats = data.openTabs
          .filter((open) => open.tableId && occupiedTableIds.has(open.tableId))
          .reduce((sum, open) => sum + open.guestCount, 0);
        const tableOccupancyRate =
          counts.all > 0 ? Math.round((occupiedTablesList.length / counts.all) * 100) : 0;
        const seatOccupancyRate =
          totalSeats > 0 ? Math.min(100, Math.round((occupiedSeats / totalSeats) * 100)) : 0;
        const avgTicketPerTableCents =
          occupiedTablesList.length > 0
            ? Math.round(totalActiveSalonCents / occupiedTablesList.length)
            : 0;

        const currentStaffMember = data.staff.find(
          (person) => person.identityId === scope.identityId,
        );
        const activeUserName = currentStaffMember?.displayName ?? "Operador";

        const roleConfigMap: Record<
          string,
          { title: string; badge: string; tone: string; description: string }
        > = {
          owner: {
            title: "Proprietário",
            badge: "Acesso Total",
            tone: "brand",
            description: "Visão gerencial completa, métricas ao vivo e controle de turnos/layout.",
          },
          manager: {
            title: "Gerente de Operação",
            badge: "Gestão do Salão",
            tone: "brand",
            description: "Supervisão do turno, liberação de descontos/estornos e gestão de praças.",
          },
          cashier: {
            title: "Operador de Caixa",
            badge: "Fechamento & PDV",
            tone: "warning",
            description:
              "Foco em mesas em fechamento, divisão de contas e recebimento de pagamentos.",
          },
          waiter: {
            title: "Garçom / Atendente",
            badge: "Atendimento de Pista",
            tone: "info",
            description: "Lançamento ágil de pedidos, atendimento de chamados e apoio às praças.",
          },
          kitchen: {
            title: "Cozinha / KDS",
            badge: "Produção",
            tone: "danger",
            description: "Visualização de status de preparo e despacho de pedidos prontos.",
          },
          inventory: {
            title: "Estoque / Compras",
            badge: "Suprimentos",
            tone: "neutral",
            description: "Acompanhamento de consumo e suprimentos do salão.",
          },
          finance: {
            title: "Financeiro",
            badge: "Auditoria",
            tone: "brand",
            description: "Auditoria de vendas, faturamento e recebimentos.",
          },
          delivery: {
            title: "Expedição Delivery",
            badge: "Entregas",
            tone: "info",
            description: "Despacho de pedidos de entrega e balcão.",
          },
          platform: {
            title: "Administrador da Plataforma",
            badge: "Master",
            tone: "brand",
            description: "Acesso irrestrito a todas as rotas e funções.",
          },
        };
        const roleConfig = roleConfigMap[scope.profileId] ?? {
          title: "Operador",
          badge: "Salão",
          tone: "neutral",
          description: "Operação e acompanhamento das mesas do salão.",
        };
        const joinTableIds = [
          ...new Set(
            joinSelection.flatMap((id) => {
              const group = groupForTable(id);
              return group ? groupMembers(group.id) : [id];
            }),
          ),
        ];
        const joinTables = joinTableIds.flatMap((id) => {
          const item = data.tables.find((candidate) => candidate.id === id);
          return item ? [item] : [];
        });
        const joinTabs = data.openTabs.filter(
          (open) => open.tableId && joinTableIds.includes(open.tableId),
        );
        const joinAnchorOptions = joinTabs.length
          ? joinTabs.flatMap((open) => (open.tableId ? [open.tableId] : []))
          : joinTableIds;
        const callKindLabel = {
          assistance: "Ajuda",
          bill: "Pediu a conta",
          water: "Água",
          other: "Chamado",
        } as const;
        const callOwner = (identityId: string | null) =>
          data.staff.find((person) => person.identityId === identityId)?.displayName ??
          "Equipe do salão";
        const elapsedLabel = (date: string) => {
          const minutes = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60_000));
          return minutes < 1 ? "agora" : `há ${minutes} min`;
        };
        const visibleRootIds = new Set(filteredTables.map((item) => item.id));
        const floorPlanItems = allActiveTables.map((item) => {
          const itemGroup = groupForTable(item.id);
          const rootId = itemGroup?.anchorTableId ?? item.id;
          const root = data.tables.find((candidate) => candidate.id === rootId) ?? item;
          const memberIds = itemGroup ? groupMembers(itemGroup.id) : [item.id];
          const groupTabs = data.openTabs.filter(
            (candidate) => candidate.tableId && memberIds.includes(candidate.tableId),
          );
          const status = displayStatus(root);
          const assignment = operationalAssignmentForTable(item.id);
          const groupResponsible = itemGroup?.responsibleIdentityId
            ? data.staff.find((person) => person.identityId === itemGroup.responsibleIdentityId)
            : undefined;
          const effectiveResponsible = groupResponsible ?? assignment?.primary;
          const shiftLayout = data.shiftTableLayouts.find(
            (candidate) => candidate.tableId === item.id,
          );
          const shiftTransfer = transferForTable(item.id);
          const serviceCall = serviceCallForTable(item.id);
          const servicePhase = servicePhaseForTable(item.id);
          const effectiveRoomId = shiftLayout?.roomId ?? item.roomId;
          return {
            id: item.id,
            operationId: rootId,
            label: item.label,
            seats: item.seats,
            areaId: effectiveRoomId,
            areaLabel:
              data.rooms.find((candidate) => candidate.id === effectiveRoomId)?.name ??
              "Sem ambiente",
            status,
            layoutX: shiftLayout?.x ?? item.layoutX,
            layoutY: shiftLayout?.y ?? item.layoutY,
            responsible: effectiveResponsible?.displayName,
            valueLabel:
              status === "attention" && serviceCall
                ? serviceCall.status === "acknowledged" && serviceCall.acknowledgedAt
                  ? callOwner(serviceCall.acknowledgedByIdentityId) +
                    " · " +
                    elapsedLabel(serviceCall.acknowledgedAt)
                  : `${callKindLabel[serviceCall.kind]} · ${elapsedLabel(serviceCall.createdAt)}`
                : shiftTransfer
                  ? (assignment?.section.name ?? "Praça temporária") +
                    " · até " +
                    new Date(shiftTransfer.expiresAt).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : status === "occupied"
                    ? itemGroup && item.id !== rootId
                      ? "Integrada ao grupo"
                      : servicePhase
                        ? `${servicePhasePresentation[servicePhase.phase]} · ${elapsedLabel(servicePhase.since)}`
                        : formatMoney(
                            groupTabs.reduce((sum, groupTab) => sum + groupTab.totalCents, 0),
                          )
                    : effectiveResponsible
                      ? `${item.seats} lug. · ${effectiveResponsible.displayName}`
                      : `${item.seats} ${item.seats === 1 ? "lugar" : "lugares"}`,
            groupId: itemGroup?.id,
            groupLabel: itemGroup
              ? `${memberIds.length} mesas · ${groupTabs.length} ${groupTabs.length === 1 ? "comanda" : "comandas"}`
              : undefined,
            accountCount: itemGroup ? groupTabs.length : undefined,
            hidden: !visibleRootIds.has(rootId),
            disabledReason:
              joinMode && item.status === "reserved"
                ? "Confirme ou libere a reserva antes da junção."
                : undefined,
          };
        });
        const floorPlanZones = data.rooms.flatMap((room) =>
          room.layoutPolygon ? [{ id: room.id, label: room.name, points: room.layoutPolygon }] : [],
        );
        const activeCalls = [...data.serviceCalls].sort(
          (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
        );
        const turnoverTables = activeTables.filter((item) =>
          ["needs_cleaning", "cleaning"].includes(item.status),
        );
        const readyTableIds = new Set(
          data.tablePhases
            .filter((phase) => phase.phase === "ready")
            .map((phase) => groupForTable(phase.tableId)?.anchorTableId ?? phase.tableId),
        );
        const readyTables = activeTables.filter((item) => readyTableIds.has(item.id));
        const expiringTransferKeys = new Set<string>();
        const expiringTransfers = data.shiftTableTransfers.filter((transfer) => {
          const remaining = new Date(transfer.expiresAt).getTime() - Date.now();
          const groupId = groupForTable(transfer.tableId)?.id;
          const key = groupId ?? transfer.id;
          if (remaining <= 0 || remaining > 15 * 60_000 || expiringTransferKeys.has(key)) {
            return false;
          }
          expiringTransferKeys.add(key);
          return true;
        });
        const priorityCount =
          activeCalls.length +
          expiringTransfers.length +
          turnoverTables.length +
          readyTables.length;
        const handoverGroups = [
          ...data.openTabs
            .reduce(
              (groups, open) => {
                const key = open.responsibleIdentityId ?? "unassigned";
                const current = groups.get(key) ?? {
                  key,
                  sourceResponsibleIdentityId: open.responsibleIdentityId,
                  count: 0,
                  totalCents: 0,
                };
                current.count += 1;
                current.totalCents += open.totalCents;
                groups.set(key, current);
                return groups;
              },
              new Map<
                string,
                {
                  key: string;
                  sourceResponsibleIdentityId: string | null;
                  count: number;
                  totalCents: number;
                }
              >(),
            )
            .values(),
        ];
        const filterStorageKey = `giromesa:salon-filter:${scope.organizationId}:${scope.unitId}`;

        function saveCurrentFilter() {
          localStorage.setItem(
            filterStorageKey,
            JSON.stringify({ filterStatus, roomFilter, sectionFilter, view }),
          );
          setFeedback("Filtro operacional salvo neste dispositivo.");
        }

        function applySavedFilter() {
          try {
            const saved = JSON.parse(localStorage.getItem(filterStorageKey) ?? "null") as {
              filterStatus?: FloorFilter;
              roomFilter?: string;
              sectionFilter?: string;
              view?: "map" | "list" | "floor";
            } | null;
            if (!saved) {
              setFeedback("Nenhum filtro salvo neste dispositivo.", "info");
              return;
            }
            if (
              [
                "all",
                "available",
                "occupied",
                "attention",
                "closing",
                "reserved",
                "turnover",
              ].includes(saved.filterStatus ?? "")
            ) {
              setFilterStatus(saved.filterStatus ?? "all");
            }
            if (saved.roomFilter) setRoomFilter(saved.roomFilter);
            if (saved.sectionFilter) setSectionFilter(saved.sectionFilter);
            setView(saved.view === "floor" ? "floor" : saved.view === "list" ? "list" : "map");
            setFeedback("Filtro salvo aplicado.");
          } catch {
            localStorage.removeItem(filterStorageKey);
            setFeedback("O filtro salvo estava inválido e foi removido.", "info");
          }
        }

        async function openTab(targetTable = table) {
          if (!targetTable || busy) return;
          const serviceMode =
            operationalAssignmentForTable(targetTable.id)?.section.serviceMode ?? data.serviceMode;
          const usesQuickFlow = usesQuickServiceMode(serviceMode);
          setBusy(true);
          setFeedback("");
          try {
            const body = { tableId: targetTable.id, guestCount: usesQuickFlow ? 1 : guests };
            await scope.dispatch(
              "pos.tab.open_requested",
              pilotMutation("open-tab", { body }),
              (key) => api.pilot.openTab(scope.organizationId, scope.unitId, body, key),
            );
            setFeedback(
              targetTable.status === "reserved"
                ? "Chegada confirmada. Uma comanda vazia foi aberta para a reserva."
                : usesQuickFlow
                  ? "Comanda aberta em um toque. O pedido já está disponível."
                  : "Atendimento aberto. O cardápio já está disponível.",
            );
            setSelectedTableId(targetTable.id);
            floor.retry();
          } catch (error) {
            setErrorFeedback(error, "Não foi possível abrir a comanda.");
          } finally {
            setBusy(false);
          }
        }

        async function updateTurnover(status: "cleaning" | "available", targetTable = table) {
          if (!targetTable || busy) return;
          setBusy(true);
          try {
            await scope.dispatch(
              "pos.table.turnover_requested",
              pilotMutation("table-turnover", { tableId: targetTable.id, status }),
              () =>
                api.pilot.updateTableTurnover(
                  scope.organizationId,
                  scope.unitId,
                  targetTable.id,
                  status,
                ),
            );
            setFeedback(
              status === "cleaning"
                ? `${targetTable.label}: limpeza assumida.`
                : `${targetTable.label}: limpeza concluída e mesa liberada.`,
              "success",
            );
            if (status === "available") setSelectedTableId(null);
            floor.retry();
          } catch (cause) {
            setFeedback(
              cause instanceof Error ? cause.message : "Não foi possível atualizar a mesa.",
            );
          } finally {
            setBusy(false);
          }
        }

        function selectTable(targetTable: (typeof data.tables)[number]) {
          const targetGroup = groupForTable(targetTable.id);
          const memberIds = targetGroup ? groupMembers(targetGroup.id) : [targetTable.id];
          const open = data.openTabs.find(
            (candidate) =>
              candidate.id === targetGroup?.primaryTabId ||
              (candidate.tableId && memberIds.includes(candidate.tableId)),
          );
          setSelectedTableId(targetTable.id);
          setSelectedTabId(open?.id ?? null);
          const mode =
            operationalAssignmentForTable(targetTable.id)?.section.serviceMode ?? data.serviceMode;
          if (!open && displayStatus(targetTable) === "available" && usesQuickServiceMode(mode)) {
            void openTab(targetTable);
          }
        }

        async function toggleSectionCoverage(
          shiftSectionId: string,
          sectionName: string,
          active: boolean,
        ) {
          if (!data.activeShift || busy) return;
          setBusy(true);
          setFeedback("");
          try {
            await api.pilot.updateShiftSectionCoverage(
              scope.organizationId,
              scope.unitId,
              data.activeShift.id,
              shiftSectionId,
              active,
            );
            setFeedback(
              active
                ? `Você agora apoia a praça ${sectionName}.`
                : `Cobertura da praça ${sectionName} encerrada.`,
            );
            floor.retry();
          } catch (error) {
            setErrorFeedback(error, "Não foi possível atualizar a cobertura.");
          } finally {
            setBusy(false);
          }
        }

        function openTransferDialog() {
          if (!table || !selectedBaseSection) return;
          const target = data.shiftSections.find(
            (section) => section.id !== selectedBaseSection.id,
          );
          if (!target) {
            setFeedback("Crie ao menos duas praças no turno para remanejar uma mesa.", "info");
            return;
          }
          setTransferTargetSectionId(target.id);
          setTransferDialogOpen(true);
        }

        async function transferSelectedTable() {
          if (!data.activeShift || !table || !transferTargetSectionId || busy) return;
          setBusy(true);
          setFeedback("");
          try {
            await api.pilot.transferShiftTable(
              scope.organizationId,
              scope.unitId,
              data.activeShift.id,
              table.id,
              {
                targetShiftSectionId: transferTargetSectionId,
                durationMinutes: transferDurationMinutes,
                transferOpenTab,
                reason: transferReason.trim(),
              },
            );
            setTransferDialogOpen(false);
            setFeedback(
              `${selectedGroup ? `Grupo com ${selectedGroupTableIds.length} mesas` : table.label} remanejado até ${new Date(Date.now() + transferDurationMinutes * 60_000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`,
            );
            floor.retry();
          } catch (error) {
            setErrorFeedback(error, "Não foi possível remanejar a mesa.");
          } finally {
            setBusy(false);
          }
        }

        async function endSelectedTableTransfer() {
          if (!data.activeShift || !table || busy) return;
          setBusy(true);
          setFeedback("");
          try {
            await api.pilot.endShiftTableTransfer(
              scope.organizationId,
              scope.unitId,
              data.activeShift.id,
              table.id,
            );
            setFeedback(
              selectedGroup
                ? "O grupo voltou às praças originais do turno."
                : `${table.label} voltou para a praça original do turno.`,
            );
            floor.retry();
          } catch (error) {
            setErrorFeedback(error, "Não foi possível encerrar o remanejamento.");
          } finally {
            setBusy(false);
          }
        }

        async function saveFloorLayout(
          positions: FloorPlanPosition[],
          zones: FloorPlanZonePosition[],
        ) {
          setBusy(true);
          setFeedback("");
          try {
            await api.pilot.updateFloorLayout(scope.organizationId, scope.unitId, {
              tables: positions.map(({ tableId, x, y }) => ({ tableId, x, y })),
              rooms: zones.filter((zone) =>
                data.rooms.some((room) => room.id === zone.roomId && room.active),
              ),
            });
            setFeedback("Planta publicada para toda a equipe desta unidade.");
            floor.retry();
            return true;
          } catch (error) {
            setErrorFeedback(error, "Não foi possível salvar a planta.");
            return false;
          } finally {
            setBusy(false);
          }
        }

        async function saveShiftLayout(positions: FloorPlanPosition[]) {
          if (!data.activeShift) return false;
          setBusy(true);
          setFeedback("");
          try {
            await api.pilot.updateShiftLayout(
              scope.organizationId,
              scope.unitId,
              data.activeShift.id,
              {
                tables: positions.flatMap(({ tableId, roomId, x, y }) =>
                  roomId ? [{ tableId, roomId, x, y }] : [],
                ),
              },
            );
            setFeedback(
              "Organização atualizada só para este turno. A planta física original foi preservada.",
            );
            floor.retry();
            return true;
          } catch (error) {
            setErrorFeedback(error, "Não foi possível reorganizar as mesas deste turno.");
            return false;
          } finally {
            setBusy(false);
          }
        }

        async function transitionCall(callId: string, next: "acknowledged" | "resolved") {
          setBusy(true);
          setFeedback("");
          try {
            await scope.dispatch(
              `pos.service_call.${next}_requested`,
              pilotMutation(next === "acknowledged" ? "acknowledge-call" : "resolve-call", {
                callId,
              }),
              (key) =>
                next === "acknowledged"
                  ? api.pilot.acknowledgeServiceCall(
                      scope.organizationId,
                      scope.unitId,
                      callId,
                      key,
                    )
                  : api.pilot.resolveServiceCall(scope.organizationId, scope.unitId, callId, key),
            );
            setFeedback(
              next === "acknowledged"
                ? "Chamado assumido e responsabilidade registrada."
                : "Chamado resolvido e retirado da fila.",
            );
            floor.retry();
            return true;
          } catch (error) {
            setErrorFeedback(error, "Não foi possível atualizar o chamado.");
            return false;
          } finally {
            setBusy(false);
          }
        }

        async function createServiceSection(event: FormEvent<HTMLFormElement>) {
          event.preventDefault();
          if (!serviceSectionName.trim() || !serviceSectionTableIds.length) return;
          setBusy(true);
          setFeedback("");
          try {
            await api.pilot.createServiceSection(scope.organizationId, scope.unitId, {
              name: serviceSectionName.trim(),
              color: serviceSectionColor,
              serviceMode: serviceSectionMode,
              tableIds: serviceSectionTableIds,
              defaultResponsibleIdentityId: serviceSectionDefaultResponsibleId || null,
            });
            setServiceSectionName("");
            setServiceSectionTableIds([]);
            setServiceSectionDefaultResponsibleId("");
            setFeedback("Modelo de praça salvo. Ele será reaproveitado nos próximos turnos.");
            floor.retry();
          } catch (error) {
            setErrorFeedback(error, "Não foi possível criar o modelo de praça.");
          } finally {
            setBusy(false);
          }
        }

        async function openShift(event: FormEvent<HTMLFormElement>) {
          event.preventDefault();
          setBusy(true);
          setFeedback("");
          try {
            await api.pilot.openOperationalShift(scope.organizationId, scope.unitId, {
              label: shiftLabel.trim() || undefined,
              serviceMode: shiftMode,
              copyPreviousAssignments,
            });
            setShiftLabel("");
            setFeedback("Turno aberto com as praças reutilizáveis e a última equipe disponível.");
            floor.retry();
          } catch (error) {
            setErrorFeedback(error, "Não foi possível abrir o turno.");
          } finally {
            setBusy(false);
          }
        }

        async function updateShiftAssignment(event: FormEvent<HTMLFormElement>) {
          event.preventDefault();
          if (!data.activeShift || !assignmentSectionId || !assignmentTableIds.length) return;
          setBusy(true);
          setFeedback("");
          try {
            await api.pilot.updateShiftSectionAssignment(
              scope.organizationId,
              scope.unitId,
              data.activeShift.id,
              assignmentSectionId,
              {
                tableIds: assignmentTableIds,
                primaryIdentityId: assignmentPrimaryId || null,
                supportIdentityIds: assignmentSupportIds,
              },
            );
            setFeedback("Praça do turno atualizada sem alterar os ambientes físicos.");
            floor.retry();
          } catch (error) {
            setErrorFeedback(error, "Não foi possível atualizar a praça do turno.");
          } finally {
            setBusy(false);
          }
        }

        async function closeShift({
          acknowledgeOpenTabs,
          handoverIdentityId: nextResponsibleIdentityId,
          handoverAssignments: nextAssignments,
          reason,
        }: {
          acknowledgeOpenTabs: boolean;
          handoverIdentityId?: string | null;
          handoverAssignments?: Array<{
            sourceResponsibleIdentityId: string | null;
            targetResponsibleIdentityId: string;
          }>;
          reason?: string;
        }) {
          if (!data.activeShift) return;
          setBusy(true);
          setFeedback("");
          try {
            await api.pilot.closeOperationalShift(
              scope.organizationId,
              scope.unitId,
              data.activeShift.id,
              {
                acknowledgeOpenTabs,
                handoverIdentityId: nextResponsibleIdentityId,
                handoverAssignments: nextAssignments,
                reason,
              },
            );
            setAssignmentSectionId("");
            setHandoverOpen(false);
            setFeedback(
              data.openTabs.length
                ? "Turno encerrado. A passagem das comandas abertas foi registrada."
                : "Turno encerrado sem comandas pendentes.",
            );
            floor.retry();
          } catch (error) {
            setErrorFeedback(error, "Não foi possível encerrar o turno.");
          } finally {
            setBusy(false);
          }
        }

        async function createRoom(event: FormEvent<HTMLFormElement>) {
          event.preventDefault();
          setBusy(true);
          setFeedback("");
          try {
            await api.pilot.createRoom(scope.organizationId, scope.unitId, {
              name: roomName.trim(),
            });
            setRoomName("");
            setFeedback("Ambiente criado. Agora adicione as mesas.");
            floor.retry();
          } catch (error) {
            setErrorFeedback(error, "Não foi possível criar o ambiente.");
          } finally {
            setBusy(false);
          }
        }

        async function createTables(event: FormEvent<HTMLFormElement>) {
          event.preventDefault();
          const selectedRoom = roomId || data.rooms[0]?.id;
          if (!selectedRoom) {
            setFeedback("Crie um ambiente antes de adicionar mesas.", "info");
            return;
          }
          setBusy(true);
          setFeedback("");
          try {
            await api.pilot.createTables(scope.organizationId, scope.unitId, selectedRoom, {
              tables: tableNames.map((label) => ({ label, seats: tableSeats })),
            });
            if (tableMode === "single") setTableLabel("");
            else setTableStart((current) => current + tableQuantity);
            setFeedback(
              tableNames.length === 1
                ? "Mesa adicionada ao mapa do salão."
                : `${tableNames.length} mesas adicionadas ao mapa do salão.`,
            );
            floor.retry();
          } catch (error) {
            setErrorFeedback(error, "Não foi possível criar as mesas.");
          } finally {
            setBusy(false);
          }
        }

        function openJoinDialog() {
          if (joinSelection.length < 2) return;
          if (joinTables.some((item) => item.status === "reserved")) {
            setFeedback("Resolva a reserva antes de juntar essa mesa ao atendimento.", "info");
            return;
          }
          setJoinAnchorId(joinAnchorOptions[0] ?? "");
          setJoinResponsibleIdentityId(
            joinTabs.find((open) => open.responsibleIdentityId)?.responsibleIdentityId ??
              scope.identityId,
          );
          setJoinAccountMode(
            data.activeShift
              ? joinTabs.length
                ? "physical_only"
                : "layout_only"
              : "physical_only",
          );
          setJoinDialogOpen(true);
        }

        async function confirmJoin() {
          if (!joinAnchorId || joinTableIds.length < 2) return;
          if (joinAccountMode === "layout_only") {
            if (!data.activeShift) {
              setFeedback(
                "Abra um turno para mover mesas sem alterar a planta permanente.",
                "info",
              );
              return;
            }
            const joinedLayout = buildJoinedShiftLayout(
              floorPlanItems,
              joinTableIds,
              joinAnchorId,
              [],
              floorPlanZones,
            );
            if (joinedLayout.unplacedIds.length) {
              setFeedback(
                "Não há espaço livre suficiente ao redor da mesa principal. Use Mover neste turno para ajustar manualmente.",
                "info",
              );
              return;
            }
            setBusy(true);
            try {
              await api.pilot.updateShiftLayout(
                scope.organizationId,
                scope.unitId,
                data.activeShift.id,
                {
                  tables: joinedLayout.positions.map((p) => ({
                    tableId: p.tableId,
                    roomId:
                      p.roomId ??
                      floorPlanItems.find((f) => f.id === p.tableId)?.areaId ??
                      data.rooms[0]?.id ??
                      "",
                    x: p.x,
                    y: p.y,
                  })),
                },
              );
              setFeedback(
                "Mesas aproximadas somente neste turno. Comandas, responsáveis e praças não mudaram.",
              );
              setJoinDialogOpen(false);
              setJoinMode(false);
              setJoinSelection([]);
              setSelectedTableId(joinAnchorId);
              setFloorFocusId(joinAnchorId);
              floor.retry();
            } catch (error) {
              setErrorFeedback(error, "Não foi possível aproximar as mesas neste turno.");
            } finally {
              setBusy(false);
            }
            return;
          }
          const targetTabId = joinTabs.find((open) => open.tableId === joinAnchorId)?.id;
          if (joinAccountMode === "single_tab" && joinTabs.length > 0 && !targetTabId) {
            setFeedback("Escolha como principal uma mesa com comanda aberta.", "info");
            return;
          }
          const body = {
            tableIds: joinTableIds,
            anchorTableId: joinAnchorId,
            mode: joinAccountMode,
            ...(targetTabId ? { targetTabId } : {}),
            ...(joinResponsibleIdentityId
              ? { responsibleIdentityId: joinResponsibleIdentityId }
              : {}),
          };
          setBusy(true);
          try {
            await scope.dispatch(
              "pos.table_group.create_requested",
              pilotMutation("group-tables", { body }),
              (key) => api.pilot.groupTables(scope.organizationId, scope.unitId, body, key),
            );
            setFeedback(
              joinAccountMode === "single_tab"
                ? "Mesas agrupadas com uma única comanda."
                : "Mesas agrupadas fisicamente com comandas separadas.",
            );
            setJoinDialogOpen(false);
            setJoinMode(false);
            setJoinSelection([]);
            setSelectedTableId(joinAnchorId);
            setSelectedTabId(targetTabId ?? null);
            floor.retry();
          } catch (error) {
            setErrorFeedback(error, "Não foi possível juntar as mesas.");
          } finally {
            setBusy(false);
          }
        }

        async function detachFromGroup() {
          if (!selectedGroup || !detachTableId) return;
          setBusy(true);
          try {
            await scope.dispatch(
              "pos.table_group.detach_requested",
              pilotMutation("detach-table-group", {
                groupId: selectedGroup.id,
                tableId: detachTableId,
              }),
              (key) =>
                api.pilot.detachTableGroup(
                  scope.organizationId,
                  scope.unitId,
                  selectedGroup.id,
                  detachTableId,
                  key,
                ),
            );
            setFeedback(
              "Mesa retirada do grupo. A comanda separada, quando existente, foi preservada.",
            );
            setDetachTableId("");
            floor.retry();
          } catch (error) {
            setErrorFeedback(error, "Não foi possível separar a mesa.");
          } finally {
            setBusy(false);
          }
        }

        async function dissolveGroup() {
          if (!selectedGroup) return;
          setBusy(true);
          try {
            await scope.dispatch(
              "pos.table_group.dissolve_requested",
              pilotMutation("dissolve-table-group", { groupId: selectedGroup.id }),
              (key) =>
                api.pilot.dissolveTableGroup(
                  scope.organizationId,
                  scope.unitId,
                  selectedGroup.id,
                  key,
                ),
            );
            setFeedback("Agrupamento desfeito. As comandas existentes foram preservadas.");
            setSelectedTableId(null);
            floor.retry();
          } catch (error) {
            setErrorFeedback(error, "Separe os itens antes de desfazer um grupo com consumo.");
          } finally {
            setBusy(false);
          }
        }

        return (
          <div className="salon-shell" data-salon-operation-shell>
            <div className="salon-fullscreen-bar">
              <span>
                <i aria-hidden="true" />
                <strong>Modo operação</strong>
                <small>Todo o atendimento permanece sobre a planta.</small>
              </span>
              <Button onClick={() => void document.exitFullscreen()} size="sm" variant="ghost">
                Sair da operação
              </Button>
            </div>
            <div
              aria-live="polite"
              className="gm-observability-row"
              role={floor.refreshError ? "alert" : "status"}
            >
              <span>
                <StatusDot
                  pulse={floor.refreshing}
                  tone={floor.refreshError ? "danger" : floor.refreshing ? "warning" : "success"}
                />
                <small>
                  {floor.refreshError
                    ? "Falha ao atualizar; exibindo a última confirmação."
                    : floor.refreshing
                      ? "Sincronizando o salão…"
                      : floor.lastSuccessfulAt
                        ? `Confirmado às ${new Date(floor.lastSuccessfulAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
                        : "Aguardando confirmação…"}
                </small>
              </span>
              {floor.refreshError && (
                <Button onClick={floor.retry} size="sm" variant="ghost">
                  Atualizar novamente
                </Button>
              )}
            </div>
            {priorityCount > 0 && (
              <details
                className="service-priority-queue"
                onToggle={(event) => setPriorityQueueOpen(event.currentTarget.open)}
                open={priorityQueueOpen}
              >
                <summary>
                  <span>
                    <small>Fazer agora</small>
                    <strong>Prioridades da operação</strong>
                  </span>
                  <span className="service-priority-queue__count">
                    <strong>{priorityCount}</strong>
                    <small>{priorityCount === 1 ? "pendência" : "pendências"}</small>
                  </span>
                </summary>
                <div className="service-priority-queue__items">
                  {readyTables.map((readyTable) => {
                    const phase = servicePhaseForTable(readyTable.id);
                    return (
                      <button
                        className="priority-task priority-task--warning"
                        key={`ready-${readyTable.id}`}
                        onClick={() => selectTable(readyTable)}
                        type="button"
                      >
                        <span>
                          <strong>{readyTable.label} · pedido pronto</strong>
                          <small>
                            {phase
                              ? `Aguardando para servir ${elapsedLabel(phase.since)}`
                              : "Abrir mesa"}
                          </small>
                        </span>
                        <strong>Abrir mesa</strong>
                      </button>
                    );
                  })}
                  {turnoverTables.map((turnoverTable) => (
                    <article
                      className="priority-task priority-task--warning"
                      key={turnoverTable.id}
                    >
                      <span>
                        <strong>
                          {turnoverTable.label} ·{" "}
                          {turnoverTable.status === "cleaning"
                            ? "em limpeza"
                            : "aguardando limpeza"}
                        </strong>
                        <small>A mesa permanece indisponível até a confirmação.</small>
                      </span>
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void updateTurnover(
                            turnoverTable.status === "needs_cleaning" ? "cleaning" : "available",
                            turnoverTable,
                          )
                        }
                        size="sm"
                        variant="secondary"
                      >
                        {turnoverTable.status === "needs_cleaning" ? "Assumir" : "Liberar mesa"}
                      </Button>
                    </article>
                  ))}
                  {expiringTransfers.map((transfer) => {
                    const group = groupForTable(transfer.tableId);
                    const targetTableId = group?.anchorTableId ?? transfer.tableId;
                    const targetTable = data.tables.find(
                      (candidate) => candidate.id === targetTableId,
                    );
                    const minutes = Math.max(
                      1,
                      Math.ceil((new Date(transfer.expiresAt).getTime() - Date.now()) / 60_000),
                    );
                    return (
                      <button
                        className="priority-task priority-task--warning"
                        key={group?.id ?? transfer.id}
                        onClick={() => {
                          setSelectedTableId(targetTableId);
                          setView("floor");
                          setFloorFocusId(targetTableId);
                        }}
                        type="button"
                      >
                        <span>
                          <strong>
                            {group
                              ? `Grupo com ${groupMembers(group.id).length} mesas`
                              : (targetTable?.label ?? "Mesa")}{" "}
                            · remanejamento vence
                          </strong>
                          <small>
                            Em {minutes} min · abrir para devolver ou renovar a cobertura
                          </small>
                        </span>
                        <strong>Abrir na planta</strong>
                      </button>
                    );
                  })}
                  {activeCalls.map((call) => {
                    const tableLabel =
                      data.tables.find((candidate) => candidate.id === call.tableId)?.label ??
                      "Mesa";
                    const elapsedMinutes = Math.max(
                      0,
                      Math.floor((Date.now() - new Date(call.createdAt).getTime()) / 60_000),
                    );
                    const overdue = elapsedMinutes >= call.slaMinutes;
                    const acknowledgedBy = callOwner(call.acknowledgedByIdentityId);
                    return (
                      <article
                        className={overdue ? "priority-task priority-task--late" : "priority-task"}
                        key={call.id}
                      >
                        <span>
                          <strong>
                            {tableLabel} · {callKindLabel[call.kind]}
                          </strong>
                          <small>
                            {call.status === "acknowledged" && call.acknowledgedAt
                              ? "Assumido por " +
                                acknowledgedBy +
                                " " +
                                elapsedLabel(call.acknowledgedAt)
                              : `Aguardando há ${elapsedMinutes} min`}{" "}
                            · SLA {call.slaMinutes} min
                          </small>
                        </span>
                        <Button
                          disabled={busy}
                          onClick={() => {
                            const next = call.status === "open" ? "acknowledged" : "resolved";
                            void transitionCall(call.id, next).then((confirmed) => {
                              if (!confirmed || next !== "acknowledged") return;
                              setSelectedTableId(call.tableId);
                              setSelectedTabId(
                                call.tabId ??
                                  data.openTabs.find((open) => open.tableId === call.tableId)?.id ??
                                  null,
                              );
                            });
                          }}
                          size="sm"
                          title={
                            call.status === "open"
                              ? "Assumir chamado e abrir atendimento"
                              : "Marcar chamado como resolvido"
                          }
                          variant={overdue ? "danger" : "secondary"}
                        >
                          {call.status === "open" ? "Assumir e abrir" : "Resolver"}
                        </Button>
                      </article>
                    );
                  })}
                </div>
              </details>
            )}

            {/* Cockpit gerencial fica fora do caminho padrão do atendimento. */}
            {canConfigure && (
              <div className="salon-cockpit-bar">
                <div className="salon-role-indicator">
                  <div className="salon-role-indicator__avatar">
                    <Icon name="user" size={16} />
                  </div>
                  <div className="salon-role-indicator__info">
                    <div className="salon-role-indicator__header">
                      <strong>{activeUserName}</strong>
                      <span className={`salon-role-tag salon-role-tag--${roleConfig.tone}`}>
                        {roleConfig.title} · {roleConfig.badge}
                      </span>
                    </div>
                    <small>{roleConfig.description}</small>
                  </div>
                </div>
                <button
                  className="salon-cockpit-toggle"
                  onClick={() => setShowMetricsCockpit((curr) => !curr)}
                  type="button"
                >
                  <Icon name="dashboard" size={14} />
                  <span>
                    {showMetricsCockpit ? "Ocultar métricas do salão" : "Métricas em tempo real"}
                  </span>
                </button>
              </div>
            )}

            {canConfigure && showMetricsCockpit && (
              <div className="salon-metrics-cockpit">
                <div className="salon-metric-card">
                  <div className="salon-metric-card__header">
                    <span>Faturamento em aberto</span>
                    <Icon name="cash" size={16} />
                  </div>
                  <strong>{formatMoney(totalActiveSalonCents)}</strong>
                  <small>{activeOpenTabs.length} comanda(s) ativas no salão</small>
                </div>

                <div className="salon-metric-card">
                  <div className="salon-metric-card__header">
                    <span>Ocupação do salão</span>
                    <Icon name="salon" size={16} />
                  </div>
                  <div className="salon-metric-card__row">
                    <strong>{tableOccupancyRate}%</strong>
                    <span className="salon-metric-card__subval">
                      {occupiedTablesList.length}/{counts.all} mesas
                    </span>
                  </div>
                  <div className="salon-occupancy-bar">
                    <div
                      className="salon-occupancy-bar__fill"
                      style={{ width: `${tableOccupancyRate}%` }}
                    />
                  </div>
                  <small>
                    {occupiedSeats}/{totalSeats} lugares ocupados ({seatOccupancyRate}%)
                  </small>
                </div>

                <div className="salon-metric-card">
                  <div className="salon-metric-card__header">
                    <span>Ticket médio / mesa</span>
                    <Icon name="catalog" size={16} />
                  </div>
                  <strong>{formatMoney(avgTicketPerTableCents)}</strong>
                  <small>Por mesa ocupada no turno</small>
                </div>

                <div className="salon-metric-card salon-metric-card--alert">
                  <div className="salon-metric-card__header">
                    <span>Atenção imediata</span>
                    <Icon name="clock" size={16} />
                  </div>
                  <div className="salon-metric-card__alerts">
                    {counts.closing > 0 && (
                      <span className="salon-metric-pill salon-metric-pill--warning">
                        <strong>{counts.closing}</strong> pedindo conta
                      </span>
                    )}
                    {counts.attention > 0 && (
                      <span className="salon-metric-pill salon-metric-pill--danger">
                        <strong>{counts.attention}</strong> chamando garçom
                      </span>
                    )}
                    {counts.closing === 0 && counts.attention === 0 && counts.turnover === 0 && (
                      <span className="salon-metric-pill salon-metric-pill--success">
                        Operação em dia (sem pendências)
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="salon-command-bar salon-command-bar--real">
              <SalonSearch
                onChange={setQuery}
                onSelect={(option) => {
                  const selected = activeTables.find((item) => item.id === option.id);
                  setQuery("");
                  setFloorFocusId(option.id);
                  if (selected) selectTable(selected);
                }}
                options={activeTables.map((item) => {
                  const room = data.rooms.find((candidate) => candidate.id === item.roomId)?.name;
                  const assignment = operationalAssignmentForTable(item.id);
                  const group = groupForTable(item.id);
                  const memberLabels = group
                    ? groupMembers(group.id)
                        .flatMap(
                          (id) => data.tables.find((candidate) => candidate.id === id)?.label ?? [],
                        )
                        .join(" ")
                    : "";
                  return {
                    id: item.id,
                    label: item.label,
                    meta: `${room ?? "Sem ambiente"} · ${assignment?.section.name ?? "Sem praça"} · ${item.seats} ${item.seats === 1 ? "lugar" : "lugares"}`,
                    keywords: `${memberLabels} ${room ?? ""} ${assignment?.section.name ?? ""} ${assignment?.primary?.displayName ?? ""}`,
                  };
                })}
                placeholder="Buscar mesa, ambiente ou praça"
                value={query}
              />
              <details className="salon-filter-menu">
                <summary>
                  <Icon name="list" size={15} />
                  <span>Filtros</span>
                  {advancedFilterCount > 0 && <b>{advancedFilterCount}</b>}
                </summary>
                <div className="salon-filter-menu__panel">
                  <label className="salon-select">
                    <span>Ambiente</span>
                    <select
                      onChange={(event) => setRoomFilter(event.target.value)}
                      value={roomFilter}
                    >
                      <option value="all">Todos os ambientes</option>
                      {data.rooms
                        .filter((item) => item.active)
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="salon-select">
                    <span>Praça do turno</span>
                    <select
                      onChange={(event) => setSectionFilter(event.target.value)}
                      value={sectionFilter}
                    >
                      <option value="all">Todas as praças</option>
                      {data.activeShift && <option value="mine">Minhas praças e coberturas</option>}
                      {data.shiftSections.map((section) => (
                        <option key={section.id} value={section.id}>
                          {section.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="salon-filter-menu__actions">
                    <Button onClick={saveCurrentFilter} size="sm" variant="ghost">
                      Salvar visão
                    </Button>
                    <Button onClick={applySavedFilter} size="sm" variant="ghost">
                      Aplicar salva
                    </Button>
                    {advancedFilterCount > 0 && (
                      <Button
                        onClick={() => {
                          setRoomFilter("all");
                          setSectionFilter("all");
                        }}
                        size="sm"
                        variant="ghost"
                      >
                        Limpar
                      </Button>
                    )}
                  </div>
                </div>
              </details>
              <fieldset className="salon-view-toggle">
                <legend className="gm-sr-only">Visualização</legend>
                <button
                  aria-pressed={view === "map"}
                  onClick={() => setView("map")}
                  type="button"
                  title="Visão em cartões"
                >
                  <Icon name="grid" size={14} />
                  <span>Painel</span>
                </button>
                <button
                  aria-pressed={view === "floor"}
                  onClick={() => setView("floor")}
                  type="button"
                  title="Planta baixa 2D"
                >
                  <Icon name="salon" size={14} />
                  <span>Planta</span>
                </button>
                <button
                  aria-pressed={view === "list"}
                  onClick={() => setView("list")}
                  type="button"
                  title="Lista rápida de alto giro"
                >
                  <Icon name="list" size={14} />
                  <span>Lista</span>
                </button>
              </fieldset>
              <Button
                aria-label="Atalhos de teclado"
                onClick={() => setShortcutsModalOpen(true)}
                size="sm"
                title="Atalhos de teclado [?]"
                variant="ghost"
              >
                <Icon name="clock" size={14} />
                <span>Atalhos [?]</span>
              </Button>
              {(canConfigure || canReorganizeTurn) && (
                <details className="salon-more-menu">
                  <summary aria-label="Mais ações do salão">•••</summary>
                  <div>
                    {canConfigure && (
                      <Button
                        aria-controls="salon-configuration"
                        aria-expanded={setupOpen}
                        onClick={() => setSetupOpen(true)}
                        size="sm"
                        variant="ghost"
                      >
                        <Icon name="settings" size={16} />
                        Organizar salão
                      </Button>
                    )}
                    <Button
                      aria-pressed={joinMode}
                      onClick={() => {
                        setJoinMode((current) => !current);
                        setJoinSelection([]);
                      }}
                      size="sm"
                      variant={joinMode ? "secondary" : "ghost"}
                    >
                      {joinMode ? "Cancelar junção" : "Juntar mesas"}
                    </Button>
                  </div>
                </details>
              )}
            </div>

            {canConfigure && (
              <Modal
                className="salon-config-modal"
                isOpen={setupOpen}
                onClose={() => setSetupOpen(false)}
                size="xl"
                title="Configurar atendimento"
              >
                <div
                  className="floor-setup floor-management floor-management--modal"
                  id="salon-configuration"
                >
                  <p className="floor-management__intro">
                    O espaço físico é permanente. Praças e responsáveis pertencem ao turno.
                  </p>
                  <fieldset className="segmented floor-setup__scope">
                    <legend className="gm-sr-only">Tipo de configuração</legend>
                    <button
                      aria-pressed={setupSection === "space"}
                      onClick={() => setSetupSection("space")}
                      type="button"
                    >
                      Espaço físico
                    </button>
                    <button
                      aria-pressed={setupSection === "shift"}
                      onClick={() => setSetupSection("shift")}
                      type="button"
                    >
                      Turno e praças
                    </button>
                  </fieldset>
                  {setupSection === "space" ? (
                    <div className="quick-actions-grid floor-management__forms floor-management__forms--real">
                      <form className="action-form" onSubmit={(event) => void createRoom(event)}>
                        <h3>Novo ambiente físico</h3>
                        <label>
                          Nome
                          <input
                            minLength={2}
                            onChange={(event) => setRoomName(event.target.value)}
                            required
                            value={roomName}
                          />
                        </label>
                        <Button disabled={busy || roomName.trim().length < 2} type="submit">
                          Criar ambiente
                        </Button>
                      </form>
                      <form
                        className="action-form action-form--tables"
                        onSubmit={(event) => void createTables(event)}
                      >
                        <h3>Adicionar mesas</h3>
                        <fieldset className="table-create-mode">
                          <legend>Quantidade</legend>
                          <button
                            aria-pressed={tableMode === "single"}
                            onClick={() => setTableMode("single")}
                            type="button"
                          >
                            Uma mesa
                          </button>
                          <button
                            aria-pressed={tableMode === "batch"}
                            onClick={() => setTableMode("batch")}
                            type="button"
                          >
                            Em sequência
                          </button>
                        </fieldset>
                        {tableMode === "single" ? (
                          <label className="action-form__wide">
                            Identificação
                            <input
                              maxLength={60}
                              minLength={1}
                              onChange={(event) => setTableLabel(event.target.value)}
                              placeholder="Ex.: Mesa 12"
                              required
                              value={tableLabel}
                            />
                          </label>
                        ) : (
                          <>
                            <label className="action-form__wide">
                              Prefixo
                              <input
                                maxLength={50}
                                onChange={(event) => setTablePrefix(event.target.value)}
                                required
                                value={tablePrefix}
                              />
                            </label>
                            <label>
                              Iniciar em
                              <input
                                min={1}
                                onChange={(event) => setTableStart(Number(event.target.value))}
                                required
                                type="number"
                                value={tableStart}
                              />
                            </label>
                            <label>
                              Quantidade
                              <input
                                max={MAX_TABLE_BATCH}
                                min={1}
                                onChange={(event) => setTableQuantity(Number(event.target.value))}
                                required
                                type="number"
                                value={tableQuantity}
                              />
                            </label>
                            <p aria-live="polite" className="table-batch-preview">
                              <strong>Prévia</strong>
                              <span>
                                {batchNames.length
                                  ? `${batchNames.slice(0, 4).join(", ")}${batchNames.length > 4 ? ` +${batchNames.length - 4}` : ""}`
                                  : "Revise o prefixo, início e quantidade."}
                              </span>
                            </p>
                          </>
                        )}
                        <label>
                          Lugares por mesa
                          <input
                            max={100}
                            min={1}
                            onChange={(event) => setTableSeats(Number(event.target.value))}
                            required
                            type="number"
                            value={tableSeats}
                          />
                        </label>
                        <label>
                          Ambiente
                          <select
                            onChange={(event) => setRoomId(event.target.value)}
                            required
                            value={roomId || data.rooms[0]?.id || ""}
                          >
                            <option disabled value="">
                              Crie um ambiente
                            </option>
                            {data.rooms
                              .filter((item) => item.active)
                              .map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name}
                                </option>
                              ))}
                          </select>
                        </label>
                        <Button
                          disabled={busy || !tableNames.length || data.rooms.length === 0}
                          type="submit"
                        >
                          {tableMode === "batch"
                            ? `Criar ${tableNames.length} mesas`
                            : "Criar mesa"}
                        </Button>
                      </form>
                    </div>
                  ) : (
                    <div className="quick-actions-grid floor-management__forms floor-management__forms--shift">
                      <form
                        className="action-form action-form--service-section"
                        onSubmit={(event) => void createServiceSection(event)}
                      >
                        <h3>Modelo reutilizável de praça</h3>
                        <label>
                          Nome
                          <input
                            maxLength={120}
                            minLength={2}
                            onChange={(event) => setServiceSectionName(event.target.value)}
                            placeholder="Ex.: Praça A"
                            required
                            value={serviceSectionName}
                          />
                        </label>
                        <label>
                          Cor
                          <input
                            aria-label="Cor da praça"
                            onChange={(event) => setServiceSectionColor(event.target.value)}
                            type="color"
                            value={serviceSectionColor}
                          />
                        </label>
                        <label>
                          Perfil de serviço
                          <select
                            onChange={(event) =>
                              setServiceSectionMode(event.target.value as ServiceMode)
                            }
                            value={serviceSectionMode}
                          >
                            <option value="full_service">Serviço completo</option>
                            <option value="quick_service">Giro rápido</option>
                            <option value="bar">Bar e comandas</option>
                            <option value="hybrid">Híbrido</option>
                          </select>
                        </label>
                        <label>
                          Responsável padrão
                          <select
                            onChange={(event) =>
                              setServiceSectionDefaultResponsibleId(event.target.value)
                            }
                            value={serviceSectionDefaultResponsibleId}
                          >
                            <option value="">Definir a cada turno</option>
                            {data.staff.map((person) => (
                              <option key={person.identityId} value={person.identityId}>
                                {person.displayName}
                              </option>
                            ))}
                          </select>
                        </label>
                        <fieldset className="floor-setup__tables action-form__wide">
                          <legend>Mesas padrão</legend>
                          {data.tables
                            .filter(
                              (item) =>
                                item.active &&
                                !data.serviceSectionTables.some((row) => row.tableId === item.id),
                            )
                            .map((item) => (
                              <label key={item.id}>
                                <input
                                  checked={serviceSectionTableIds.includes(item.id)}
                                  onChange={() =>
                                    setServiceSectionTableIds((current) =>
                                      current.includes(item.id)
                                        ? current.filter((id) => id !== item.id)
                                        : [...current, item.id],
                                    )
                                  }
                                  type="checkbox"
                                />
                                <span>
                                  {item.label} ·{" "}
                                  {data.rooms.find((room) => room.id === item.roomId)?.name}
                                </span>
                              </label>
                            ))}
                        </fieldset>
                        <Button
                          disabled={
                            busy || !serviceSectionName.trim() || !serviceSectionTableIds.length
                          }
                          type="submit"
                        >
                          Salvar modelo de praça
                        </Button>
                      </form>

                      {data.activeShift ? (
                        <form
                          className="action-form action-form--shift"
                          onSubmit={(event) => void updateShiftAssignment(event)}
                        >
                          <h3>Organizar turno ativo</h3>
                          <p className="field-hint">
                            <strong>{data.activeShift.label}</strong> ·{" "}
                            {data.activeShift.serviceMode === "full_service"
                              ? "Serviço completo"
                              : data.activeShift.serviceMode === "quick_service"
                                ? "Giro rápido"
                                : data.activeShift.serviceMode === "bar"
                                  ? "Bar e comandas"
                                  : "Híbrido"}
                          </p>
                          <label>
                            Praça do turno
                            <select
                              onChange={(event) => {
                                const nextId = event.target.value;
                                setAssignmentSectionId(nextId);
                                setAssignmentTableIds(
                                  data.shiftSectionTables
                                    .filter((row) => row.shiftSectionId === nextId)
                                    .map((row) => row.tableId),
                                );
                                setAssignmentPrimaryId(
                                  data.shiftSectionStaff.find(
                                    (row) =>
                                      row.shiftSectionId === nextId && row.role === "primary",
                                  )?.identityId ?? "",
                                );
                                setAssignmentSupportIds(
                                  data.shiftSectionStaff
                                    .filter(
                                      (row) =>
                                        row.shiftSectionId === nextId && row.role === "support",
                                    )
                                    .map((row) => row.identityId),
                                );
                              }}
                              required
                              value={assignmentSectionId}
                            >
                              <option value="">Selecione</option>
                              {data.shiftSections.map((section) => (
                                <option key={section.id} value={section.id}>
                                  {section.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Titular
                            <select
                              onChange={(event) => setAssignmentPrimaryId(event.target.value)}
                              value={assignmentPrimaryId}
                            >
                              <option value="">Sem titular</option>
                              {data.staff.map((person) => (
                                <option key={person.identityId} value={person.identityId}>
                                  {person.displayName}
                                </option>
                              ))}
                            </select>
                          </label>
                          <fieldset className="floor-setup__tables action-form__wide">
                            <legend>Apoio</legend>
                            {data.staff
                              .filter((person) => person.identityId !== assignmentPrimaryId)
                              .map((person) => (
                                <label key={person.identityId}>
                                  <input
                                    checked={assignmentSupportIds.includes(person.identityId)}
                                    onChange={() =>
                                      setAssignmentSupportIds((current) =>
                                        current.includes(person.identityId)
                                          ? current.filter((id) => id !== person.identityId)
                                          : [...current, person.identityId],
                                      )
                                    }
                                    type="checkbox"
                                  />
                                  <span>{person.displayName}</span>
                                </label>
                              ))}
                          </fieldset>
                          <fieldset className="floor-setup__tables action-form__wide">
                            <legend>Mesas neste turno</legend>
                            {data.tables
                              .filter((item) => item.active)
                              .map((item) => {
                                const otherSection = data.shiftSectionTables.find(
                                  (row) =>
                                    row.tableId === item.id &&
                                    row.shiftSectionId !== assignmentSectionId,
                                );
                                return (
                                  <label key={item.id}>
                                    <input
                                      checked={assignmentTableIds.includes(item.id)}
                                      disabled={Boolean(otherSection)}
                                      onChange={() =>
                                        setAssignmentTableIds((current) =>
                                          current.includes(item.id)
                                            ? current.filter((id) => id !== item.id)
                                            : [...current, item.id],
                                        )
                                      }
                                      type="checkbox"
                                    />
                                    <span>{item.label}</span>
                                  </label>
                                );
                              })}
                          </fieldset>
                          <Button
                            disabled={busy || !assignmentSectionId || !assignmentTableIds.length}
                            type="submit"
                          >
                            Atualizar praça do turno
                          </Button>
                          <Button
                            disabled={busy}
                            onClick={() => {
                              if (data.openTabs.length) {
                                setSetupOpen(false);
                                setHandoverAssignments({});
                                setHandoverOpen(true);
                              } else void closeShift({ acknowledgeOpenTabs: false });
                            }}
                            type="button"
                            variant="ghost"
                          >
                            Encerrar turno
                          </Button>
                        </form>
                      ) : (
                        <form className="action-form" onSubmit={(event) => void openShift(event)}>
                          <h3>Abrir turno</h3>
                          <label>
                            Identificação opcional
                            <input
                              maxLength={120}
                              onChange={(event) => setShiftLabel(event.target.value)}
                              placeholder="Ex.: Jantar de sexta"
                              value={shiftLabel}
                            />
                          </label>
                          <label>
                            Perfil predominante
                            <select
                              onChange={(event) => setShiftMode(event.target.value as ServiceMode)}
                              value={shiftMode}
                            >
                              <option value="full_service">Serviço completo</option>
                              <option value="quick_service">Giro rápido</option>
                              <option value="bar">Bar e comandas</option>
                              <option value="hybrid">Híbrido</option>
                            </select>
                          </label>
                          <label className="action-form__check">
                            <input
                              checked={copyPreviousAssignments}
                              onChange={(event) => setCopyPreviousAssignments(event.target.checked)}
                              type="checkbox"
                            />
                            <span>Reaproveitar a equipe do turno anterior</span>
                          </label>
                          <p className="field-hint">
                            {data.serviceSections.length} modelo(s) de praça serão carregados
                            automaticamente.
                          </p>
                          <Button
                            disabled={busy || data.serviceSections.length === 0}
                            type="submit"
                          >
                            Abrir turno
                          </Button>
                        </form>
                      )}
                    </div>
                  )}
                </div>
              </Modal>
            )}

            <Modal
              isOpen={joinDialogOpen}
              onClose={() => setJoinDialogOpen(false)}
              size="lg"
              title="Organizar mesas selecionadas"
            >
              <div className="table-group-dialog">
                <div className="table-group-dialog__summary">
                  <span>
                    <strong>{joinTables.length} mesas</strong>
                    <small>{joinTables.reduce((sum, item) => sum + item.seats, 0)} lugares</small>
                  </span>
                  <span>
                    <strong>{joinTabs.length} comandas abertas</strong>
                    <small>
                      {formatMoney(joinTabs.reduce((sum, open) => sum + open.totalCents, 0))}
                    </small>
                  </span>
                </div>
                <div className="table-group-dialog__tables">
                  {joinTables.map((item) => (
                    <span key={item.id}>
                      <strong>{item.label}</strong>
                      <small>
                        {item.seats} {item.seats === 1 ? "lugar" : "lugares"} ·{" "}
                        {tableStatusPresentation(displayStatus(item)).label}
                      </small>
                    </span>
                  ))}
                </div>
                {new Set(
                  joinTables.map(
                    (item) => operationalAssignmentForTable(item.id)?.section.id ?? "unassigned",
                  ),
                ).size > 1 && (
                  <div className="join-cross-room-notice" role="note">
                    <strong>Mesas de praças diferentes</strong>
                    <span>
                      Praça é a divisão da equipe; ambiente é o espaço físico. A escolha abaixo
                      define exatamente o que muda e preserva a origem no histórico.
                    </span>
                  </div>
                )}
                <fieldset className="table-group-mode">
                  <legend>Como deseja operar o atendimento?</legend>
                  <label aria-disabled={!data.activeShift}>
                    <input
                      checked={joinAccountMode === "layout_only"}
                      disabled={!data.activeShift}
                      onChange={() => setJoinAccountMode("layout_only")}
                      type="radio"
                    />
                    <span>
                      <strong>Aproximar apenas neste turno</strong>
                      <small>
                        Move as mesas no espaço físico temporário, sem criar grupo e sem alterar
                        comandas, praças ou responsáveis.
                      </small>
                    </span>
                  </label>
                  <label>
                    <input
                      checked={joinAccountMode === "physical_only"}
                      onChange={() => setJoinAccountMode("physical_only")}
                      type="radio"
                    />
                    <span>
                      <strong>Agrupar com comandas separadas</strong>
                      <small>
                        Cria um grupo operacional; pedidos e pagamentos continuam em cada mesa.
                      </small>
                    </span>
                  </label>
                  <label>
                    <input
                      checked={joinAccountMode === "single_tab"}
                      onChange={() => setJoinAccountMode("single_tab")}
                      type="radio"
                    />
                    <span>
                      <strong>Usar uma única comanda</strong>
                      <small>Pedidos, pessoas e valores passam para a comanda principal.</small>
                    </span>
                  </label>
                </fieldset>
                <label className="compact-field">
                  Mesa principal
                  <select
                    onChange={(event) => setJoinAnchorId(event.target.value)}
                    value={joinAnchorId}
                  >
                    {joinAnchorOptions.map((id) => {
                      const item = data.tables.find((candidate) => candidate.id === id);
                      return item ? (
                        <option key={id} value={id}>
                          {item.label}
                        </option>
                      ) : null;
                    })}
                  </select>
                </label>
                {joinAccountMode !== "layout_only" && (
                  <label className="compact-field">
                    Responsável pelo grupo
                    <select
                      onChange={(event) => setJoinResponsibleIdentityId(event.target.value)}
                      value={joinResponsibleIdentityId}
                    >
                      {data.staff.map((person) => (
                        <option key={person.identityId} value={person.identityId}>
                          {person.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {joinTabs.length > 1 && joinAccountMode === "single_tab" && (
                  <p className="field-hint">
                    A unificação só é confirmada sem pagamentos parciais. Caso exista pagamento,
                    mantenha comandas separadas ou finalize a conciliação primeiro.
                  </p>
                )}
                <div className="table-group-dialog__actions">
                  <Button onClick={() => setJoinDialogOpen(false)} variant="ghost">
                    Voltar
                  </Button>
                  <Button disabled={busy} onClick={() => void confirmJoin()}>
                    {busy
                      ? "Juntando…"
                      : joinAccountMode === "layout_only"
                        ? "Aproximar neste turno"
                        : joinAccountMode === "single_tab"
                          ? "Juntar e unificar comandas"
                          : "Criar grupo separado"}
                  </Button>
                </div>
              </div>
            </Modal>

            <Modal
              isOpen={transferDialogOpen}
              onClose={() => setTransferDialogOpen(false)}
              size="md"
              title={
                selectedGroup
                  ? `Remanejar grupo com ${selectedGroupTableIds.length} mesas`
                  : table
                    ? `Remanejar ${table.label}`
                    : "Remanejar mesa"
              }
            >
              <div className="operational-transfer-form">
                <p>
                  {selectedGroup
                    ? "As mesas permanecem nos ambientes físicos e cada uma volta à sua praça original ao final do prazo."
                    : "A mesa permanece no mesmo ambiente físico e volta automaticamente para a praça original ao final do prazo."}
                </p>
                <label>
                  Praça temporária
                  <select
                    onChange={(event) => setTransferTargetSectionId(event.target.value)}
                    value={transferTargetSectionId}
                  >
                    {data.shiftSections
                      .filter((section) => section.id !== selectedBaseSection?.id)
                      .map((section) => (
                        <option key={section.id} value={section.id}>
                          {section.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Duração
                  <select
                    onChange={(event) => setTransferDurationMinutes(Number(event.target.value))}
                    value={transferDurationMinutes}
                  >
                    <option value={15}>15 minutos</option>
                    <option value={30}>30 minutos</option>
                    <option value={60}>1 hora</option>
                    <option value={120}>2 horas</option>
                    <option value={240}>4 horas</option>
                    <option value={720}>Até 12 horas</option>
                  </select>
                </label>
                <label>
                  Motivo
                  <input
                    maxLength={500}
                    minLength={3}
                    onChange={(event) => setTransferReason(event.target.value)}
                    value={transferReason}
                  />
                </label>
                {(tab || selectedGroupTabs.length > 0) && (
                  <label className="action-form__check">
                    <input
                      checked={transferOpenTab}
                      onChange={(event) => setTransferOpenTab(event.target.checked)}
                      type="checkbox"
                    />
                    <span>
                      Passar também {selectedGroup ? "as comandas do grupo" : "a comanda atual"} ao
                      titular da nova praça
                    </span>
                  </label>
                )}
                <div className="table-group-dialog__actions">
                  <Button onClick={() => setTransferDialogOpen(false)} variant="ghost">
                    Cancelar
                  </Button>
                  <Button
                    disabled={busy || transferReason.trim().length < 3}
                    onClick={() => void transferSelectedTable()}
                  >
                    {selectedGroup ? "Remanejar grupo" : "Confirmar remanejamento"}
                  </Button>
                </div>
              </div>
            </Modal>

            <Modal
              isOpen={handoverOpen}
              onClose={() => setHandoverOpen(false)}
              size="md"
              title="Passagem de turno"
            >
              <div className="operational-transfer-form">
                <div className="handover-summary">
                  <span>
                    <strong>{data.openTabs.length}</strong>
                    <small>comandas abertas</small>
                  </span>
                  <span>
                    <strong>
                      {formatMoney(data.openTabs.reduce((sum, open) => sum + open.totalCents, 0))}
                    </strong>
                    <small>em atendimento</small>
                  </span>
                </div>
                <fieldset className="handover-assignments">
                  <legend>Distribuir por responsável atual</legend>
                  {handoverGroups.map((group) => {
                    const currentName = group.sourceResponsibleIdentityId
                      ? (data.staff.find(
                          (person) => person.identityId === group.sourceResponsibleIdentityId,
                        )?.displayName ?? "Responsável atual")
                      : "Sem responsável";
                    return (
                      <label key={group.key}>
                        <span>
                          <strong>{currentName}</strong>
                          <small>
                            {group.count} comanda(s) · {formatMoney(group.totalCents)}
                          </small>
                        </span>
                        <select
                          aria-label={`Próximo responsável pelas comandas de ${currentName}`}
                          onChange={(event) =>
                            setHandoverAssignments((current) => ({
                              ...current,
                              [group.key]: event.target.value,
                            }))
                          }
                          value={handoverAssignments[group.key] ?? ""}
                        >
                          <option value="">Manter como está</option>
                          {data.staff.map((person) => (
                            <option key={person.identityId} value={person.identityId}>
                              Passar para {person.displayName}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
                </fieldset>
                <label>
                  Registro da passagem
                  <input
                    maxLength={500}
                    minLength={3}
                    onChange={(event) => setHandoverReason(event.target.value)}
                    value={handoverReason}
                  />
                </label>
                <p className="field-hint">
                  Pedidos, pagamentos e comandas não serão encerrados. A próxima equipe continua do
                  ponto exato em que o turno terminou.
                </p>
                <div className="table-group-dialog__actions">
                  <Button onClick={() => setHandoverOpen(false)} variant="ghost">
                    Voltar
                  </Button>
                  <Button
                    disabled={busy || handoverReason.trim().length < 3}
                    onClick={() =>
                      void closeShift({
                        acknowledgeOpenTabs: true,
                        handoverAssignments: handoverGroups.flatMap((group) => {
                          const targetResponsibleIdentityId = handoverAssignments[group.key];
                          return targetResponsibleIdentityId &&
                            targetResponsibleIdentityId !== group.sourceResponsibleIdentityId
                            ? [
                                {
                                  sourceResponsibleIdentityId: group.sourceResponsibleIdentityId,
                                  targetResponsibleIdentityId,
                                },
                              ]
                            : [];
                        }),
                        reason: handoverReason.trim(),
                      })
                    }
                  >
                    Registrar e encerrar turno
                  </Button>
                </div>
              </div>
            </Modal>

            {/* Move Table Dialog */}
            {table && tab && (
              <MoveTableDialog
                availableTables={activeTables.map((t) => {
                  const isOcc = data.openTabs.some((openTab) => openTab.tableId === t.id);
                  const occTab = data.openTabs.find((openTab) => openTab.tableId === t.id);
                  return {
                    id: t.id,
                    label: t.label,
                    seats: t.seats,
                    roomName: data.rooms.find((r) => r.id === t.roomId)?.name ?? "Salão",
                    isOccupied: isOcc,
                    totalCents: occTab?.totalCents,
                  };
                })}
                currentTableLabel={table.label}
                isOpen={moveTableOpen}
                onClose={() => setMoveTableOpen(false)}
                onMoveTable={(targetId) => handleMoveEntireTable(targetId, table.id)}
              />
            )}

            {feedback && (
              <Toast
                duration={feedback.tone === "danger" ? 0 : 4_500}
                message={feedback.message}
                onDismiss={() => setFeedback("")}
                title="Atualização do salão"
                tone={feedback.tone}
              />
            )}

            <div className="ops-layout salon-layout--command-center">
              <section className="ops-board salon-floor">
                <div className="salon-floor__toolbar">
                  <fieldset className="segmented segmented--scroll">
                    <legend className="gm-sr-only">Filtrar estado</legend>
                    {(
                      [
                        ["all", "Todas", counts.all],
                        ["available", "Livres", counts.available],
                        ["occupied", "Ocupadas", counts.occupied],
                        ["attention", "Chamando", counts.attention],
                        ["closing", "Pediu conta", counts.closing],
                        ["reserved", "Reservadas", counts.reserved],
                        ["turnover", "Limpeza", counts.turnover],
                      ] as const
                    ).map(([id, label, count]) => (
                      <button
                        aria-pressed={filterStatus === id}
                        key={id}
                        onClick={() => setFilterStatus(id)}
                        type="button"
                      >
                        {label} <small>{count}</small>
                      </button>
                    ))}
                  </fieldset>
                </div>

                {joinMode && (
                  <div className="join-banner" role="status">
                    <div className="salon-service-modal__context">
                      <strong>Selecione mesas ou grupos completos</strong>
                      <span>{joinSelection.length} selecionado(s)</span>
                    </div>
                    <Button disabled={joinSelection.length < 2} onClick={openJoinDialog} size="sm">
                      Configurar junção
                    </Button>
                  </div>
                )}

                {filteredTables.length === 0 ? (
                  <EmptyState
                    icon={<Icon name="salon" size={28} />}
                    title="Nenhuma mesa encontrada"
                    description="Ajuste a busca ou os filtros para voltar ao mapa."
                  />
                ) : view === "floor" ? (
                  <FloorPlan
                    canEdit={data.activeShift ? canReorganizeTurn : canConfigure}
                    editRequestKey={floorEditRequestKey}
                    editActionLabel={data.activeShift ? "Reorganizar turno" : "Editar planta"}
                    editableZoneIds={
                      data.activeShift
                        ? []
                        : data.rooms.filter((room) => room.active).map((room) => room.id)
                    }
                    editingDescription={
                      data.activeShift
                        ? "Arraste mesas entre ambientes; a mudança vale apenas neste turno."
                        : "Arraste mesas e limites para editar a planta física permanente."
                    }
                    focusId={floorFocusId}
                    items={floorPlanItems}
                    joinMode={joinMode}
                    layoutScope={data.activeShift ? "shift" : "permanent"}
                    onSavePositions={data.activeShift ? saveShiftLayout : saveFloorLayout}
                    saveActionLabel={data.activeShift ? "Aplicar no turno" : "Salvar planta"}
                    onSelect={(operationId) => {
                      const selected = data.tables.find(
                        (candidate) => candidate.id === operationId,
                      );
                      if (!selected) return;
                      if (joinMode) {
                        setJoinSelection((current) =>
                          current.includes(operationId)
                            ? current.filter((id) => id !== operationId)
                            : [...current, operationId],
                        );
                        return;
                      }
                      selectTable(selected);
                    }}
                    selectedIds={
                      joinMode ? joinSelection : selectedTableId ? [selectedTableId] : []
                    }
                    stations={[]}
                    viewportStorageKey={`giromesa:floor:${scope.organizationId}:${scope.unitId}`}
                    zones={floorPlanZones}
                  />
                ) : view === "list" ? (
                  <div className="salon-fast-list-container">
                    <div className="salon-fast-list-header">
                      <span>Mesa / Capacidade</span>
                      <span>Ambiente & Praça</span>
                      <span>Responsável</span>
                      <span>Status & Alerta</span>
                      <span>Tempo</span>
                      <span className="salon-text-right">Consumo</span>
                      <span className="salon-text-right">Ação</span>
                    </div>
                    <div className="salon-fast-list-body">
                      {filteredTables.map((item) => {
                        const itemGroup = groupForTable(item.id);
                        const memberIds = itemGroup ? groupMembers(itemGroup.id) : [item.id];
                        const memberTables = memberIds.flatMap((id) => {
                          const member = data.tables.find((candidate) => candidate.id === id);
                          return member ? [member] : [];
                        });
                        const groupTabs = data.openTabs.filter(
                          (candidate) => candidate.tableId && memberIds.includes(candidate.tableId),
                        );
                        const status = displayStatus(item);
                        const presentation = tableStatusPresentation(status);
                        const room =
                          data.rooms.find((candidate) => candidate.id === item.roomId)?.name ??
                          "Geral";
                        const assignment = operationalAssignmentForTable(item.id);
                        const serviceCall = serviceCallForTable(item.id);
                        const servicePhase = servicePhaseForTable(item.id);
                        const totalCents = groupTabs.reduce((sum, t) => sum + t.totalCents, 0);
                        const elapsedMinutes = serviceCall?.createdAt
                          ? elapsedLabel(serviceCall.createdAt)
                          : groupTabs.length > 0
                            ? `${groupTabs.reduce((s, t) => s + t.guestCount, 0) || 1} pes.`
                            : "—";
                        const isSelected = selectedTableId === item.id;

                        return (
                          // biome-ignore lint/a11y/useSemanticElements: the row contains a nested action button.
                          <div
                            className={`salon-fast-list-row salon-fast-list-row--${presentation.className} ${isSelected ? "selected" : ""}`}
                            key={item.id}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter" && event.key !== " ") return;
                              event.preventDefault();
                              if (joinMode) {
                                setJoinSelection((current) =>
                                  current.includes(item.id)
                                    ? current.filter((id) => id !== item.id)
                                    : [...current, item.id],
                                );
                                return;
                              }
                              selectTable(item);
                            }}
                            onClick={() => {
                              if (joinMode) {
                                setJoinSelection((current) =>
                                  current.includes(item.id)
                                    ? current.filter((id) => id !== item.id)
                                    : [...current, item.id],
                                );
                                return;
                              }
                              selectTable(item);
                            }}
                            role="button"
                            tabIndex={0}
                          >
                            <div className="salon-fast-list-cell salon-fast-list-cell--id">
                              <strong>
                                {memberTables.map((member) => member.label).join(" + ")}
                              </strong>
                              <small>
                                {memberTables.reduce((sum, member) => sum + member.seats, 0)}{" "}
                                lugares
                              </small>
                            </div>

                            <div className="salon-fast-list-cell">
                              <span>{room}</span>
                              <small>{assignment?.section.name ?? "Sem praça"}</small>
                            </div>

                            <div className="salon-fast-list-cell">
                              <span>{assignment?.primary?.displayName ?? "Equipe"}</span>
                            </div>

                            <div className="salon-fast-list-cell">
                              <span className="salon-status-chip">
                                <StatusDot pulse={presentation.pulse} tone={presentation.tone} />
                                <small>{presentation.label}</small>
                              </span>
                              {serviceCall && (
                                <span className="salon-call-pill">
                                  <Icon name="alerts" size={11} />
                                  {callKindLabel[serviceCall.kind]}
                                </span>
                              )}
                              {!serviceCall && servicePhase && (
                                <small>{servicePhasePresentation[servicePhase.phase]}</small>
                              )}
                            </div>

                            <div className="salon-fast-list-cell">
                              <small>
                                {servicePhase ? elapsedLabel(servicePhase.since) : elapsedMinutes}
                              </small>
                            </div>

                            <div className="salon-fast-list-cell salon-text-right">
                              <strong>{totalCents > 0 ? formatMoney(totalCents) : "—"}</strong>
                              {groupTabs.length > 1 && <small>{groupTabs.length} comandas</small>}
                            </div>

                            <div className="salon-fast-list-cell salon-text-right">
                              <Button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  selectTable(item);
                                }}
                                size="sm"
                                variant={
                                  status === "attention"
                                    ? "danger"
                                    : status === "closing"
                                      ? "primary"
                                      : status === "available"
                                        ? "ghost"
                                        : "secondary"
                                }
                              >
                                {status === "available"
                                  ? "Abrir"
                                  : status === "attention"
                                    ? "Atender"
                                    : status === "closing"
                                      ? "Fechar"
                                      : "Atendimento"}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className={`real-table-grid real-table-grid--${view}`}>
                    {filteredTables.map((item) => {
                      const itemGroup = groupForTable(item.id);
                      const memberIds = itemGroup ? groupMembers(itemGroup.id) : [item.id];
                      const memberTables = memberIds.flatMap((id) => {
                        const member = data.tables.find((candidate) => candidate.id === id);
                        return member ? [member] : [];
                      });
                      const groupTabs = data.openTabs.filter(
                        (candidate) => candidate.tableId && memberIds.includes(candidate.tableId),
                      );
                      const status = displayStatus(item);
                      const presentation = tableStatusPresentation(status);
                      const room = data.rooms.find(
                        (candidate) => candidate.id === item.roomId,
                      )?.name;
                      const serviceCall = serviceCallForTable(item.id);
                      const totalCents = groupTabs.reduce(
                        (sum, groupTab) => sum + groupTab.totalCents,
                        0,
                      );
                      const isSelected = selectedTableId === item.id;

                      return (
                        <button
                          aria-pressed={isSelected}
                          className={`real-table real-table--${presentation.className} ${joinSelection.includes(item.id) ? "table-tile--joining" : ""} ${isSelected ? "selected" : ""}`}
                          key={item.id}
                          onClick={() => {
                            if (joinMode) {
                              setJoinSelection((current) =>
                                current.includes(item.id)
                                  ? current.filter((id) => id !== item.id)
                                  : [...current, item.id],
                              );
                              return;
                            }
                            selectTable(item);
                          }}
                          type="button"
                        >
                          <div className="real-table__header">
                            <span className="real-table__label">
                              {memberTables.map((member) => member.label).join(" + ")}
                            </span>
                            <span className="real-table__seats">
                              {memberTables.reduce((sum, member) => sum + member.seats, 0)} lugares
                            </span>
                          </div>

                          <div className="real-table__meta-row">
                            <span className="real-table__room">{room ?? "Salão"}</span>
                            {groupTabs.length > 0 && (
                              <span className="real-table__time" title="Pessoas na mesa">
                                <Icon name="user" size={11} />
                                <small>
                                  {groupTabs.reduce((sum, t) => sum + t.guestCount, 0) || 1}{" "}
                                  {groupTabs.reduce((sum, t) => sum + t.guestCount, 0) === 1
                                    ? "pessoa"
                                    : "pessoas"}
                                </small>
                              </span>
                            )}
                          </div>

                          <div className="real-table__status">
                            <StatusDot pulse={presentation.pulse} tone={presentation.tone} />
                            <small>{presentation.label}</small>
                            {serviceCall && (
                              <span className="real-table__call-badge">
                                {callKindLabel[serviceCall.kind]}
                              </span>
                            )}
                          </div>

                          <div className="real-table__footer">
                            <div className="real-table__value">
                              {groupTabs.length ? (
                                <>
                                  <strong>{formatMoney(totalCents)}</strong>
                                  {itemGroup?.mode === "physical_only" && groupTabs.length > 1 && (
                                    <small> · {groupTabs.length} contas</small>
                                  )}
                                </>
                              ) : (
                                <span>{presentation.label}</span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>

            <Modal
              className="salon-service-modal"
              description={
                table && tab ? (
                  <div className="salon-service-modal__summary">
                    <span>
                      {floorPlanItems.find((item) => item.id === table.id)?.areaLabel ??
                        "Sem ambiente"}
                      <span aria-hidden="true"> · </span>
                      {selectedServiceMode === "full_service"
                        ? "Serviço completo"
                        : selectedServiceMode === "quick_service"
                          ? "Giro rápido"
                          : selectedServiceMode === "bar"
                            ? "Bar e comandas"
                            : "Operação híbrida"}
                    </span>
                    <div>
                      <Badge tone={selectedCall?.kind === "bill" ? "warning" : "info"}>
                        {selectedCall?.kind === "bill" ? "Conta solicitada" : "Em atendimento"}
                      </Badge>
                      <span>
                        {tab.guestCount} {tab.guestCount === 1 ? "pessoa" : "pessoas"}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{selectedTabResponsible?.displayName ?? "Sem responsável"}</span>
                      <span aria-hidden="true">·</span>
                      <span>{selectedTabOpenedMinutes} min</span>
                      <span aria-hidden="true">·</span>
                      <strong>Total: {formatMoney(tab.totalCents)}</strong>
                    </div>
                  </div>
                ) : undefined
              }
              isOpen={Boolean(table)}
              onClose={() => setSelectedTableId(null)}
              size="xl"
              title={table?.label ?? "Atendimento da mesa"}
            >
              <div className="table-drawer salon-workspace salon-workspace--modal">
                {table && (
                  <>
                    <div className="table-operation-strip">
                      <div>
                        <span>
                          <small>Ambiente físico</small>
                          <strong>
                            {floorPlanItems.find((item) => item.id === table.id)?.areaLabel ??
                              "Sem ambiente"}
                          </strong>
                        </span>
                        <span>
                          <small>Praça do turno</small>
                          <strong>{selectedAssignment?.section.name ?? "Sem praça"}</strong>
                        </span>
                        <span>
                          <small>Responsável</small>
                          <strong>
                            {selectedGroupResponsible?.displayName ??
                              selectedAssignment?.primary?.displayName ??
                              "Equipe"}
                          </strong>
                        </span>
                        {selectedCall && (
                          <span className="table-operation-strip__call">
                            <small>{callKindLabel[selectedCall.kind]}</small>
                            <strong>
                              {selectedCall.status === "acknowledged" && selectedCall.acknowledgedAt
                                ? "Assumido por " +
                                  callOwner(selectedCall.acknowledgedByIdentityId) +
                                  " " +
                                  elapsedLabel(selectedCall.acknowledgedAt)
                                : `Aguardando ${elapsedLabel(selectedCall.createdAt)}`}
                            </strong>
                          </span>
                        )}
                      </div>
                      <nav aria-label="Ações rápidas da mesa">
                        {selectedCall && (
                          <Button
                            disabled={busy}
                            onClick={() =>
                              void transitionCall(
                                selectedCall.id,
                                selectedCall.status === "open" ? "acknowledged" : "resolved",
                              )
                            }
                            size="sm"
                            variant={selectedCall.status === "open" ? "secondary" : "ghost"}
                          >
                            {selectedCall.status === "open"
                              ? "Assumir chamado"
                              : "Resolver chamado"}
                          </Button>
                        )}

                        {tab && (
                          <Button onClick={() => setMoveTableOpen(true)} size="sm" variant="ghost">
                            <Icon name="salon" size={14} />
                            <span>Mudar Mesa</span>
                          </Button>
                        )}
                        {canReorganizeTurn && (
                          <details className="table-more-actions">
                            <summary>Mais ações</summary>
                            <div>
                              {data.activeShift && (
                                <Button
                                  onClick={() => {
                                    setSelectedTableId(null);
                                    setView("floor");
                                    setFloorFocusId(table.id);
                                    setFloorEditRequestKey((current) => current + 1);
                                  }}
                                  size="sm"
                                  variant="ghost"
                                >
                                  Mover neste turno
                                </Button>
                              )}
                              {data.activeShift && selectedBaseSection && !selectedTransfer && (
                                <Button onClick={openTransferDialog} size="sm" variant="ghost">
                                  Ajustar praça
                                </Button>
                              )}
                              <Button
                                onClick={() => {
                                  setSelectedTableId(null);
                                  setView("floor");
                                  setJoinMode(true);
                                  setJoinSelection([selectedGroup?.anchorTableId ?? table.id]);
                                  setFloorFocusId(selectedGroup?.anchorTableId ?? table.id);
                                }}
                                size="sm"
                                variant="ghost"
                              >
                                Organizar com outra mesa
                              </Button>
                            </div>
                          </details>
                        )}
                      </nav>
                    </div>
                    {scope.profileId === "waiter" &&
                      selectedAssignment &&
                      selectedAssignment.primary?.identityId !== scope.identityId && (
                        <div className="cross-room-service-notice" role="note">
                          <strong>
                            {selectedSectionRole === "support"
                              ? `Apoiando ${selectedAssignment.section.name}`
                              : tab?.responsibleIdentityId === scope.identityId
                                ? "Visita assumida em outra praça"
                                : "Mesa de outra praça"}
                          </strong>
                          <span>
                            {selectedAssignment.section.name}
                            {selectedAssignment.primary
                              ? ` · titular ${selectedAssignment.primary.displayName}. `
                              : " · sem titular. "}
                            {selectedSectionRole === "support"
                              ? "Você recebe o contexto de toda a praça durante este turno."
                              : tab?.responsibleIdentityId === scope.identityId
                                ? "Você responde por esta visita; a divisão original do turno não muda."
                                : "Apoie toda a praça ou assuma apenas esta visita no botão abaixo da comanda."}
                          </span>
                          {selectedSectionRole !== "primary" && (
                            <div className="cross-room-service-notice__actions">
                              <Button
                                disabled={busy}
                                onClick={() =>
                                  void toggleSectionCoverage(
                                    selectedAssignment.section.id,
                                    selectedAssignment.section.name,
                                    selectedSectionRole !== "support",
                                  )
                                }
                                size="sm"
                                variant={selectedSectionRole === "support" ? "ghost" : "secondary"}
                              >
                                {selectedSectionRole === "support"
                                  ? "Encerrar apoio"
                                  : "Apoiar esta praça"}
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    {selectedTransfer && canReorganizeTurn && (
                      <div className="temporary-table-assignment" role="note">
                        <span>
                          <strong>
                            {`Remanejada para ${selectedAssignment?.section.name ?? "outra praça"}`}
                          </strong>
                          <small>
                            {`Retorno automático às ${new Date(selectedTransfer.expiresAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}. A comanda atual mantém o responsável até uma nova passagem.`}
                          </small>
                        </span>
                        <Button
                          disabled={busy}
                          onClick={() => void endSelectedTableTransfer()}
                          size="sm"
                          variant="ghost"
                        >
                          Desfazer remanejamento
                        </Button>
                      </div>
                    )}
                    {selectedGroup && (
                      <div className="group-workspace-bar group-workspace-bar--real">
                        <span>
                          <strong>
                            {selectedGroup.mode === "single_tab"
                              ? "Comanda única"
                              : "Comandas separadas"}
                          </strong>
                          <small>
                            {selectedGroupTableIds.length} mesas agrupadas
                            {selectedGroupResponsible
                              ? ` · ${selectedGroupResponsible.displayName} responsável`
                              : ""}
                          </small>
                        </span>
                        <div className="group-workspace-bar__actions">
                          {selectedGroupTableIds.length > 1 && (
                            <>
                              <select
                                aria-label="Mesa a retirar do grupo"
                                onChange={(event) => setDetachTableId(event.target.value)}
                                value={detachTableId}
                              >
                                <option value="">Separar mesa…</option>
                                {selectedGroupTableIds
                                  .filter((id) => id !== selectedGroup.anchorTableId)
                                  .map((id) => {
                                    const member = data.tables.find(
                                      (candidate) => candidate.id === id,
                                    );
                                    return member ? (
                                      <option key={id} value={id}>
                                        {member.label}
                                      </option>
                                    ) : null;
                                  })}
                              </select>
                              <Button
                                disabled={busy || !detachTableId}
                                onClick={() => void detachFromGroup()}
                                size="sm"
                                variant="ghost"
                              >
                                Retirar
                              </Button>
                            </>
                          )}
                          <Button
                            disabled={busy}
                            onClick={() => void dissolveGroup()}
                            size="sm"
                            variant="ghost"
                          >
                            Desfazer grupo
                          </Button>
                        </div>
                      </div>
                    )}

                    {selectedGroup?.mode === "physical_only" && selectedGroupTabs.length > 1 && (
                      <fieldset className="group-account-tabs">
                        <legend>Comandas do grupo</legend>
                        {selectedGroupTabs.map((groupTab) => {
                          const accountTable = data.tables.find(
                            (candidate) => candidate.id === groupTab.tableId,
                          );
                          return (
                            <button
                              aria-pressed={tab?.id === groupTab.id}
                              key={groupTab.id}
                              onClick={() => setSelectedTabId(groupTab.id)}
                              type="button"
                            >
                              <span>{accountTable?.label ?? groupTab.label ?? "Comanda"}</span>
                              <strong>{formatMoney(groupTab.totalCents)}</strong>
                            </button>
                          );
                        })}
                      </fieldset>
                    )}

                    {tab ? (
                      <TabWorkspace
                        compactHeading
                        initialView={selectedCall?.kind === "bill" ? "account" : "order"}
                        key={tab.id}
                        scope={scope}
                        tabId={tab.id}
                        floor={data}
                        onChanged={floor.retry}
                      />
                    ) : table.status === "needs_cleaning" || table.status === "cleaning" ? (
                      <Card className="table-start">
                        <div>
                          <p className="eyebrow">Giro da mesa</p>
                          <h2>
                            {table.status === "needs_cleaning"
                              ? "Mesa aguardando limpeza"
                              : "Limpeza em andamento"}
                          </h2>
                          <span>
                            A mesa só volta a receber clientes depois da confirmação da equipe.
                          </span>
                        </div>
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void updateTurnover(
                              table.status === "needs_cleaning" ? "cleaning" : "available",
                            )
                          }
                        >
                          {busy
                            ? "Atualizando…"
                            : table.status === "needs_cleaning"
                              ? "Assumir limpeza"
                              : "Concluir e liberar mesa"}
                        </Button>
                      </Card>
                    ) : (
                      <Card className="table-start">
                        <div>
                          <p className="eyebrow">{table.label}</p>
                          <h2>
                            {table.status === "reserved"
                              ? "Confirmar chegada"
                              : selectedUsesQuickFlow
                                ? "Abrir comanda rápida"
                                : "Iniciar atendimento"}
                          </h2>
                          <span>
                            {table.status === "reserved"
                              ? "A confirmação abre uma nova comanda vazia; nenhum item é herdado da reserva."
                              : selectedUsesQuickFlow
                                ? "Sem etapas obrigatórias de recepção: abre e vai direto ao pedido."
                                : "A comanda abre vazia e o cardápio aparece imediatamente."}
                          </span>
                        </div>
                        {!selectedUsesQuickFlow && (
                          <label className="compact-field">
                            Pessoas
                            <input
                              min={1}
                              max={500}
                              onChange={(event) => setGuests(Number(event.target.value))}
                              type="number"
                              value={guests}
                            />
                          </label>
                        )}
                        <Button
                          disabled={busy || (!selectedUsesQuickFlow && guests < 1)}
                          onClick={() => void openTab()}
                        >
                          {busy
                            ? "Abrindo…"
                            : table.status === "reserved"
                              ? "Confirmar chegada e pedir"
                              : selectedUsesQuickFlow
                                ? "Abrir e pedir"
                                : "Abrir atendimento e pedir"}
                        </Button>
                      </Card>
                    )}
                  </>
                )}
              </div>
            </Modal>
            <Modal
              isOpen={shortcutsModalOpen}
              onClose={() => setShortcutsModalOpen(false)}
              size="md"
              title="Atalhos de Teclado Operacionais"
            >
              <div className="salon-shortcuts-dialog">
                <p className="field-hint">
                  Agilize a operação no salão e no caixa utilizando os atalhos abaixo:
                </p>
                <div className="salon-shortcuts-grid">
                  <div className="salon-shortcut-item">
                    <kbd>/</kbd> ou <kbd>F</kbd>
                    <span>Buscar mesa, ambiente ou comanda</span>
                  </div>
                  <div className="salon-shortcut-item">
                    <kbd>V</kbd>
                    <span>Alternar visão (Painel ↔ Planta ↔ Lista)</span>
                  </div>
                  <div className="salon-shortcut-item">
                    <kbd>J</kbd>
                    <span>Ativar / desativar modo junção</span>
                  </div>
                  <div className="salon-shortcut-item">
                    <kbd>1</kbd> a <kbd>6</kbd>
                    <span>Filtrar status (Todas, Livres, Ocupadas...)</span>
                  </div>
                  <div className="salon-shortcut-item">
                    <kbd>Esc</kbd>
                    <span>Fechar gavetas e modais abertos</span>
                  </div>
                  <div className="salon-shortcut-item">
                    <kbd>?</kbd>
                    <span>Abrir esta janela de atalhos</span>
                  </div>
                </div>
                <div className="table-group-dialog__actions">
                  <Button onClick={() => setShortcutsModalOpen(false)}>Entendido</Button>
                </div>
              </div>
            </Modal>
          </div>
        );
      }}
    </RemoteGate>
  );
}
