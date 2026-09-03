import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  Input,
  Label,
  Modal,
  NativeSelect,
  StatusDot,
  Toast,
} from "@giromesa/ui";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiClientError, api } from "../../api";
import { pilotMutation, QueuedOperationalMutationError } from "../../operational-dispatch";
import {
  type PilotScope,
  parsePilotFloor,
  RemoteGate,
  type ServiceMode,
  serviceModeLabel,
  summarizeOperationalLoad,
  useRemote,
  usesQuickServiceMode,
} from "../../operations.shared";
import { routeHref } from "../../router";
import { formatMoney } from "../../rules";
import { TabWorkspace } from "../counter/CounterWorkspace";
import {
  buildJoinedShiftLayout,
  FloorPlan,
  type FloorPlanElement,
  type FloorPlanPosition,
} from "./FloorPlan";
import { MoveTableDialog } from "./MoveTableDialog";
import { SalonSearch } from "./SalonSearch";
import { ServiceModePicker } from "./ServiceModePicker";
import {
  buildSalonPreflight,
  buildTableTimeline,
  DEFAULT_SALON_ROLE_CONFIG,
  resolveShiftServiceMode,
  SALON_ROLE_CONFIG,
  tableNextAction,
} from "./salon-operations";
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

type SalonTableAccessLevel =
  | "summary"
  | "full"
  | "overview"
  | "operate"
  | "financial"
  | "manage"
  | null;

type SalonViewContext = {
  view: "map" | "list";
  selectedTableId: string | null;
  filterStatus: FloorFilter;
  roomFilter: string;
  sectionFilter: string;
  query: string;
};

const floorFilters: FloorFilter[] = [
  "all",
  "available",
  "occupied",
  "attention",
  "closing",
  "reserved",
  "turnover",
];

export function parseSalonViewContext(
  raw: string | null,
  fallbackView: SalonViewContext["view"],
  fallbackSectionFilter: string,
): SalonViewContext {
  const fallback: SalonViewContext = {
    view: fallbackView,
    selectedTableId: null,
    filterStatus: "all",
    roomFilter: "all",
    sectionFilter: fallbackSectionFilter,
    query: "",
  };
  if (!raw) return fallback;
  if (raw === "map" || raw === "list") return { ...fallback, view: raw };
  if (raw === "floor") return { ...fallback, view: "map" };
  try {
    const saved = JSON.parse(raw) as Partial<SalonViewContext>;
    return {
      view: saved.view === "list" ? "list" : "map",
      selectedTableId: typeof saved.selectedTableId === "string" ? saved.selectedTableId : null,
      filterStatus: floorFilters.includes(saved.filterStatus ?? "all")
        ? (saved.filterStatus ?? "all")
        : "all",
      roomFilter: typeof saved.roomFilter === "string" ? saved.roomFilter : "all",
      sectionFilter:
        typeof saved.sectionFilter === "string" ? saved.sectionFilter : fallback.sectionFilter,
      query: typeof saved.query === "string" ? saved.query : "",
    };
  } catch {
    return fallback;
  }
}

export function salonTableIdFromHash(hash: string): string | null {
  const query = hash.split("?", 2)[1];
  const tableId = query ? new URLSearchParams(query).get("table")?.trim() : undefined;
  return tableId || null;
}

export function requiredOperationalRevision(value: number | null, resource: "planta" | "turno") {
  if (value === null || !Number.isSafeInteger(value) || value < 1) {
    const resourceLabel = resource === "planta" ? "da planta" : "do turno";
    throw new Error(
      `A revisão ${resourceLabel} não foi carregada. Atualize o salão antes de salvar.`,
    );
  }
  return value;
}

export async function runFloorRevisionMutation<T>(
  currentRevision: number | null,
  loadLatestRevision: () => Promise<number | null>,
  mutate: (expectedRevision: number) => Promise<T>,
) {
  const expectedRevision = requiredOperationalRevision(currentRevision, "planta");
  try {
    return await mutate(expectedRevision);
  } catch (error) {
    if (
      !(error instanceof ApiClientError) ||
      error.status !== 409 ||
      error.code !== "FLOOR_LAYOUT_VERSION_CONFLICT"
    ) {
      throw error;
    }
    const latestRevision = requiredOperationalRevision(await loadLatestRevision(), "planta");
    return mutate(latestRevision);
  }
}

export function canOpenTableWorkspace(accessLevel: SalonTableAccessLevel, tabId?: string | null) {
  return Boolean(tabId) && !["summary", "overview", null].includes(accessLevel);
}

export function buildTableGroupReason(
  reasonCode:
    | "large_party"
    | "sit_together"
    | "accessibility"
    | "operational_reorganization"
    | "other",
  reasonNote: string,
) {
  return {
    reasonCode,
    ...(reasonNote.trim() ? { reasonNote: reasonNote.trim() } : {}),
  };
}

export function findPriorityServiceCall<T extends { kind: string; tableId: string }>(
  calls: readonly T[],
  tableIds: readonly string[],
) {
  const relevant = calls.filter((call) => tableIds.includes(call.tableId));
  return relevant.find((call) => call.kind === "bill") ?? relevant[0];
}

export function summarizeSalonAttention<
  T extends {
    createdAt: string;
    slaMinutes: number;
    printStatus?: "failed" | "confirmation_required" | string | null;
  },
>(calls: readonly T[], now = Date.now()) {
  return calls.reduce(
    (summary, call) => {
      const createdAt = new Date(call.createdAt).getTime();
      if (Number.isFinite(createdAt) && now >= createdAt + call.slaMinutes * 60_000) {
        summary.overdue += 1;
      }
      if (call.printStatus === "failed") summary.failedPrints += 1;
      if (call.printStatus === "confirmation_required") {
        summary.printConfirmations += 1;
      }
      return summary;
    },
    { overdue: 0, failedPrints: 0, printConfirmations: 0 },
  );
}

export function structuralMergePolicy<
  T extends { structuralMergeAllowed?: boolean | null; structuralMergeReason?: string | null },
>(tabs: readonly T[]) {
  const blocked = tabs.find((tab) => tab.structuralMergeAllowed === false);
  return {
    allowed: !blocked,
    reason:
      blocked?.structuralMergeReason ??
      "Esta comanda já possui movimentação financeira e deve permanecer separada.",
  };
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

function closeFloatingMenus(root: ParentNode | null, target?: Node) {
  root
    ?.querySelectorAll<HTMLDetailsElement>("details[data-salon-floating-menu][open]")
    .forEach((menu) => {
      if (!target || !menu.contains(target)) menu.open = false;
    });
}

export function RealSalonPage({ scope }: { scope: PilotScope }) {
  const salonShellRef = useRef<HTMLDivElement>(null);
  const viewStorageKey = `giromesa:salon-view:${scope.organizationId}:${scope.unitId}:${scope.profileId}`;
  const defaultView = "map";
  const defaultSectionFilter = scope.profileId === "waiter" ? "mine" : "all";
  const [restoredViewContext] = useState(() => {
    try {
      return parseSalonViewContext(
        typeof window === "undefined" ? null : window.localStorage.getItem(viewStorageKey),
        defaultView,
        defaultSectionFilter,
      );
    } catch {
      return parseSalonViewContext(null, defaultView, defaultSectionFilter);
    }
  });
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
      floor.refreshSilently,
      Math.max(0, nextTransferBoundary - Date.now()) + 250,
    );
    return () => globalThis.clearTimeout(timer);
  }, [nextTransferBoundary, floor.refreshSilently]);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(
    (typeof window === "undefined" ? null : salonTableIdFromHash(window.location.hash)) ??
      restoredViewContext.selectedTableId,
  );
  const [filterStatus, setFilterStatus] = useState<FloorFilter>(restoredViewContext.filterStatus);
  const [roomFilter, setRoomFilter] = useState(restoredViewContext.roomFilter);
  const [sectionFilter, setSectionFilter] = useState(restoredViewContext.sectionFilter);
  const [query, setQuery] = useState(restoredViewContext.query);
  const [view, setView] = useState<"map" | "list">(restoredViewContext.view);
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [workspaceMode, setWorkspaceMode] = useState<"operate" | "shift" | "template">("operate");
  const [shiftEditorTool, setShiftEditorTool] = useState<"assign" | "move">("assign");
  const [showMetricsCockpit, setShowMetricsCockpit] = useState(false);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const [moveTableOpen, setMoveTableOpen] = useState(false);
  const canReorganizeTurn = ["owner", "manager", "waiter"].includes(scope.profileId);

  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      window.localStorage.setItem(
        viewStorageKey,
        JSON.stringify({
          view,
          selectedTableId,
          filterStatus,
          roomFilter,
          sectionFilter,
          query,
        } satisfies SalonViewContext),
      );
    } catch {
      // This device simply does not retain the operational context.
    }
  }, [filterStatus, query, roomFilter, sectionFilter, selectedTableId, view, viewStorageKey]);

  useEffect(() => {
    const updateConnection = () => {
      const connected = navigator.onLine;
      setOnline(connected);
      if (connected) floor.refreshSilently();
    };
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, [floor.refreshSilently]);

  useEffect(() => {
    if (
      floor.state.status === "ready" &&
      selectedTableId &&
      !floor.state.data.tables.some((item) => item.id === selectedTableId)
    ) {
      setSelectedTableId(null);
      setSelectedTabId(null);
    }
  }, [floor.state, selectedTableId]);

  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      closeFloatingMenus(salonShellRef.current, target);
    }

    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeFloatingMenus(salonShellRef.current);
      }

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
        setView((current) => (current === "map" ? "list" : "map"));
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
  const [undoAction, setUndoAction] = useState<{
    message: string;
    successMessage?: string;
    run: () => Promise<unknown>;
  } | null>(null);
  const [feedback, setFeedbackState] = useState<{
    message: string;
    tone: "success" | "danger" | "info";
  } | null>(null);
  const [roomName, setRoomName] = useState("");
  const [managedRoomId, setManagedRoomId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [tableMode, setTableMode] = useState<"single" | "batch">("single");
  const [tableLabel, setTableLabel] = useState("");
  const [tablePrefix, setTablePrefix] = useState("Mesa");
  const [tableStart, setTableStart] = useState(1);
  const [tableQuantity, setTableQuantity] = useState(4);
  const [tableSeats, setTableSeats] = useState(4);
  const [managedTableId, setManagedTableId] = useState("");
  const [managedTableLabel, setManagedTableLabel] = useState("");
  const [managedTableSeats, setManagedTableSeats] = useState(4);
  const [managedTableRoomId, setManagedTableRoomId] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const [joinMode, setJoinMode] = useState(false);
  const [joinSelection, setJoinSelection] = useState<string[]>([]);
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const [joinAccountMode, setJoinAccountMode] = useState<
    "layout_only" | "physical_only" | "single_tab"
  >("single_tab");
  const [joinAnchorId, setJoinAnchorId] = useState("");
  const [joinResponsibleIdentityId, setJoinResponsibleIdentityId] = useState("");
  const [joinReasonCode, setJoinReasonCode] = useState<
    "large_party" | "sit_together" | "accessibility" | "operational_reorganization" | "other"
  >("large_party");
  const [joinReasonNote, setJoinReasonNote] = useState("");
  const [selectedTabId, setSelectedTabId] = useState<string | null>(null);

  useEffect(() => {
    const syncSelectedTable = () => {
      const tableId = salonTableIdFromHash(window.location.hash);
      if (!tableId) return;
      setSelectedTableId(tableId);
      setSelectedTabId(null);
      window.history.replaceState(null, "", routeHref("salon"));
    };
    syncSelectedTable();
    window.addEventListener("hashchange", syncSelectedTable);
    return () => window.removeEventListener("hashchange", syncSelectedTable);
  }, []);

  const [detachTableId, setDetachTableId] = useState("");
  const [floorFocusId, setFloorFocusId] = useState<string | null>(null);
  const [floorEditRequestKey, setFloorEditRequestKey] = useState(0);
  const [setupSection, setSetupSection] = useState<"space" | "shift">("space");
  const [shiftSetupStep, setShiftSetupStep] = useState<"sections" | "team" | "open">("sections");
  const [serviceSectionEditorOpen, setServiceSectionEditorOpen] = useState(false);
  const [managedServiceSectionId, setManagedServiceSectionId] = useState("");
  const [serviceSectionName, setServiceSectionName] = useState("");
  const [serviceSectionColor, setServiceSectionColor] = useState("#176B4D");
  const [serviceSectionMode, setServiceSectionMode] = useState<ServiceMode>("hybrid");
  const [serviceSectionTableIds, setServiceSectionTableIds] = useState<string[]>([]);
  const [serviceSectionDefaultResponsibleId, setServiceSectionDefaultResponsibleId] = useState("");
  const [serviceSectionTableQuery, setServiceSectionTableQuery] = useState("");
  const [serviceSectionRoomFilter, setServiceSectionRoomFilter] = useState("all");
  const [shiftLabel, setShiftLabel] = useState("");
  const [copyPreviousAssignments, setCopyPreviousAssignments] = useState(true);
  const [assignmentSectionId, setAssignmentSectionId] = useState("");
  const [assignmentPrimaryId, setAssignmentPrimaryId] = useState("");
  const [assignmentSupportIds, setAssignmentSupportIds] = useState<string[]>([]);
  const [assignmentTableIds, setAssignmentTableIds] = useState<string[]>([]);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [transferTargetSectionId, setTransferTargetSectionId] = useState("");
  const [transferDurationMinutes, setTransferDurationMinutes] = useState(60);
  const [transferOpenTab, setTransferOpenTab] = useState(true);
  const [transferReasonCode, setTransferReasonCode] = useState<
    "service_rebalance" | "staff_coverage" | "operational_reorganization" | "other"
  >("operational_reorganization");
  const [transferReason, setTransferReason] = useState("Remanejamento durante a operação");
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [handoverAssignments, setHandoverAssignments] = useState<Record<string, string>>({});
  const [handoverReason, setHandoverReason] = useState("Passagem para a próxima equipe");
  function setFeedback(message: string, tone: "success" | "danger" | "info" = "success") {
    setUndoAction(null);
    setFeedbackState(message ? { message, tone } : null);
  }

  function setErrorFeedback(error: unknown, fallback: string) {
    if (
      error instanceof ApiClientError &&
      error.status === 409 &&
      ["FLOOR_LAYOUT_VERSION_CONFLICT", "SHIFT_LAYOUT_VERSION_CONFLICT"].includes(error.code)
    ) {
      const resource = error.code === "FLOOR_LAYOUT_VERSION_CONFLICT" ? "planta" : "turno";
      setFeedback(
        `A configuração do ${resource} mudou em outro terminal. Atualize, revise e salve novamente.`,
        "info",
      );
      setUndoAction({
        message: `Atualizar ${resource}`,
        successMessage: `${resource === "planta" ? "Planta" : "Turno"} atualizado. Revise antes de salvar novamente.`,
        run: async () => {
          if (!(await floor.refresh()))
            throw new Error(`Não foi possível atualizar o ${resource}.`);
        },
      });
      return;
    }
    const queued = error instanceof QueuedOperationalMutationError;
    setFeedback(error instanceof Error ? error.message : fallback, queued ? "info" : "danger");
    if (queued || (error instanceof ApiClientError && error.retryable)) {
      setUndoAction({
        message: online ? "Atualizar estado" : "Aguardar conexão",
        successMessage: "Estado operacional atualizado.",
        run: async () => {
          if (!navigator.onLine) throw new Error("O terminal continua sem conexão.");
          if (!(await floor.refresh())) throw new Error("A operação ainda não respondeu.");
        },
      });
    }
  }

  async function runUndoAction() {
    const action = undoAction;
    if (!action || busy) return;
    setUndoAction(null);
    setBusy(true);
    try {
      await action.run();
      setFeedback(action.successMessage ?? "Ação desfeita com segurança.");
      floor.retry();
    } catch (error) {
      setErrorFeedback(error, "Não foi possível desfazer a ação.");
    } finally {
      setBusy(false);
    }
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
        const legacyAccessLevel =
          scope.profileId === "owner" || scope.profileId === "manager"
            ? "manage"
            : scope.profileId === "cashier"
              ? "financial"
              : scope.profileId === "waiter"
                ? "operate"
                : "overview";
        const accessForTable = (target: (typeof data.tables)[number]) =>
          target.accessLevel ?? data.accessLevel ?? legacyAccessLevel;
        const canOperateTable = (target: (typeof data.tables)[number]) =>
          !["summary", "overview"].includes(accessForTable(target));
        const canSeeTableFinancials = (target: (typeof data.tables)[number]) =>
          ["full", "financial", "manage"].includes(accessForTable(target));
        const canEditSpace =
          data.capabilities?.canManageFloor ??
          (scope.profileId === "owner" || scope.profileId === "manager");
        const canManageShift =
          data.capabilities?.canManageShift ??
          (scope.profileId === "owner" || scope.profileId === "manager");
        const canConfigure = canEditSpace || canManageShift;
        const canReorganizeTurn =
          data.capabilities?.canReorganizeTables ??
          ["owner", "manager", "waiter"].includes(scope.profileId);
        const selectedCanOperate = table ? canOperateTable(table) : false;
        const selectedCanSeeFinancials = table ? canSeeTableFinancials(table) : false;
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
        const selectedPhase = table ? servicePhaseForTable(table.id) : undefined;
        const selectedReadyOrderIds = table
          ? [
              ...new Set(
                data.tablePhases
                  .filter(
                    (phase) =>
                      phase.phase === "ready" &&
                      (selectedGroup ? selectedGroupTableIds : [table.id]).includes(phase.tableId),
                  )
                  .flatMap((phase) => phase.readyOrderIds),
              ),
            ]
          : [];
        const selectedTimeline = table
          ? buildTableTimeline({
              table,
              tab,
              phase: selectedPhase,
              call: selectedCall,
              transfer: selectedTransfer,
            })
          : [];
        const selectedNextAction = table
          ? tableNextAction({
              status: displayStatus(table),
              hasTab: Boolean(tab),
              canOperate: selectedCanOperate,
              phase: selectedPhase?.phase,
              callKind: selectedCall?.kind,
            })
          : "";
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

        const roleConfig = SALON_ROLE_CONFIG[scope.profileId] ?? DEFAULT_SALON_ROLE_CONFIG;
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
        const joiningFreeTables = joinTabs.length === 0;
        const mergePolicy = structuralMergePolicy(joinTabs);
        const effectiveJoinAccountMode =
          joinAccountMode === "single_tab" && !mergePolicy.allowed
            ? "physical_only"
            : joinAccountMode;
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
          const activeLayout = workspaceMode === "template" ? undefined : shiftLayout;
          const effectiveRoomId = activeLayout?.roomId ?? item.roomId;
          const previewSection = data.shiftSections.find(
            (section) => section.id === assignmentSectionId,
          );
          const paintingSection = workspaceMode === "shift" && previewSection;
          const previewIncludesTable = assignmentTableIds.includes(item.id);
          const templateMembership = data.serviceSectionTables.find(
            (row) => row.tableId === item.id && row.sectionId !== managedServiceSectionId,
          );
          const templateSection = data.serviceSections.find(
            (section) => section.id === templateMembership?.sectionId,
          );
          const templateIncludesTable = serviceSectionTableIds.includes(item.id);
          const templatePainting = workspaceMode === "template";
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
            layoutX: activeLayout?.x ?? item.layoutX,
            layoutY: activeLayout?.y ?? item.layoutY,
            width: item.width,
            height: item.height,
            rotation: activeLayout?.rotation ?? item.rotation,
            shape: item.shape,
            sectionColor: templatePainting
              ? templateIncludesTable
                ? serviceSectionColor
                : templateSection?.color
              : paintingSection
                ? previewIncludesTable
                  ? previewSection.color
                  : assignment?.section.id === previewSection.id
                    ? undefined
                    : assignment?.section.color
                : assignment?.section.color,
            sectionLabel: templatePainting
              ? templateIncludesTable
                ? serviceSectionName
                : templateSection?.name
              : paintingSection
                ? previewIncludesTable
                  ? previewSection.name
                  : assignment?.section.id === previewSection.id
                    ? undefined
                    : assignment?.section.name
                : assignment?.section.name,
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
                        : canSeeTableFinancials(item)
                          ? formatMoney(
                              groupTabs.reduce((sum, groupTab) => sum + groupTab.totalCents, 0),
                            )
                          : `${groupTabs.reduce((sum, groupTab) => sum + groupTab.guestCount, 0)} pessoas`
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
              templatePainting && templateSection
                ? `Já pertence à praça ${templateSection.name}.`
                : joinMode && item.status === "reserved"
                  ? "Confirme ou libere a reserva antes da junção."
                  : undefined,
          };
        });
        const floorPlanZones = data.rooms.flatMap((room) =>
          room.layoutPolygon ? [{ id: room.id, label: room.name, points: room.layoutPolygon }] : [],
        );
        const floorPlanElements: FloorPlanElement[] = data.layoutElements.map((element) => ({
          ...element,
          label: element.label ?? undefined,
        }));
        const activeCalls = [...data.serviceCalls].sort(
          (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
        );
        const attentionSummary = summarizeSalonAttention(activeCalls);
        const turnoverTables = activeTables.filter((item) =>
          ["needs_cleaning", "cleaning"].includes(item.status),
        );
        const blockingShiftTables = allActiveTables.filter((item) =>
          ["occupied", "needs_cleaning", "cleaning"].includes(item.status),
        );
        const shiftClosureBlockers = [
          { count: data.openTabs.length, singular: "comanda aberta", plural: "comandas abertas" },
          { count: activeCalls.length, singular: "chamado pendente", plural: "chamados pendentes" },
          {
            count: blockingShiftTables.length,
            singular: "mesa em atendimento ou limpeza",
            plural: "mesas em atendimento ou limpeza",
          },
          {
            count: data.shiftTableTransfers.length,
            singular: "remanejamento ativo",
            plural: "remanejamentos ativos",
          },
        ].filter((item) => item.count > 0);
        const canCloseShift = shiftClosureBlockers.length === 0;
        const shiftClosureSummary = shiftClosureBlockers
          .map((item) => `${item.count} ${item.count === 1 ? item.singular : item.plural}`)
          .join(" · ");
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
        const preflight = buildSalonPreflight(data);
        const preflightReady = preflight.filter((item) => item.ready).length;
        const preflightBlocked = preflight.some((item) => item.blocking && !item.ready);
        const nextPreflightItem = preflight.find((item) => !item.ready);
        const operationalLoad = summarizeOperationalLoad(data);
        const shiftSectionAssignments = data.shiftSections.map((section) => ({
          section,
          tableCount: data.shiftSectionTables.filter((row) => row.shiftSectionId === section.id)
            .length,
          primary: data.staff.find(
            (person) =>
              person.identityId ===
              data.shiftSectionStaff.find(
                (row) => row.shiftSectionId === section.id && row.role === "primary",
              )?.identityId,
          ),
        }));
        const serviceSectionSummaries = data.serviceSections.map((section) => {
          const tableIds = data.serviceSectionTables
            .filter((row) => row.sectionId === section.id)
            .map((row) => row.tableId);
          return {
            section,
            tableIds,
            defaultResponsible: data.staff.find(
              (person) => person.identityId === section.defaultResponsibleIdentityId,
            ),
          };
        });
        const serviceSectionAssignedTableIds = new Set(
          data.serviceSectionTables.map((row) => row.tableId),
        );
        const serviceSectionOtherTableIds = new Set(
          data.serviceSectionTables
            .filter((row) => row.sectionId !== managedServiceSectionId)
            .map((row) => row.tableId),
        );
        const normalizedServiceSectionQuery = serviceSectionTableQuery
          .trim()
          .toLocaleLowerCase("pt-BR");
        const selectableServiceSectionTables = activeTables.filter(
          (item) => !serviceSectionOtherTableIds.has(item.id),
        );
        const visibleServiceSectionTables = selectableServiceSectionTables.filter((item) => {
          if (serviceSectionRoomFilter !== "all" && item.roomId !== serviceSectionRoomFilter) {
            return false;
          }
          if (!normalizedServiceSectionQuery) return true;
          const room = data.rooms.find((candidate) => candidate.id === item.roomId)?.name ?? "";
          return `${item.label} ${room}`
            .toLocaleLowerCase("pt-BR")
            .includes(normalizedServiceSectionQuery);
        });
        const effectiveShiftMode = resolveShiftServiceMode(data.serviceSections);
        const reusableSectionsWithResponsible = data.serviceSections.filter(
          (section) => section.defaultResponsibleIdentityId,
        ).length;
        const reusableUnassignedTables = activeTables.filter(
          (item) => !serviceSectionAssignedTableIds.has(item.id),
        ).length;
        const selectedShiftSection = shiftSectionAssignments.find(
          ({ section }) => section.id === assignmentSectionId,
        );
        const ownSectionIds = new Set(
          data.shiftSectionStaff
            .filter((row) => row.identityId === scope.identityId)
            .map((row) => row.shiftSectionId),
        );
        const ownTableIds = new Set(
          data.shiftSectionTables
            .filter((row) => ownSectionIds.has(row.shiftSectionId))
            .map((row) => row.tableId),
        );
        const ownCalls = activeCalls.filter((call) => ownTableIds.has(call.tableId)).length;
        const ownReady = readyTables.filter((item) => ownTableIds.has(item.id)).length;
        const roleFocus =
          scope.profileId === "cashier"
            ? {
                label: "Fila do caixa",
                detail: `${counts.closing} conta(s) · ${attentionSummary.failedPrints + attentionSummary.printConfirmations} impressão(ões)`,
              }
            : scope.profileId === "waiter"
              ? {
                  label: "Minha operação",
                  detail: `${ownTableIds.size} mesa(s) · ${ownReady} pronta(s) · ${ownCalls} chamado(s)`,
                }
              : scope.profileId === "receptionist"
                ? {
                    label: "Recepção",
                    detail: `${counts.available} livre(s) · ${counts.reserved} reservada(s)`,
                  }
                : scope.profileId === "busser"
                  ? {
                      label: "Giro do salão",
                      detail: `${counts.turnover} mesa(s) aguardando liberação`,
                    }
                  : {
                      label: "Operação geral",
                      detail: `${priorityCount} prioridade(s) · ${tableOccupancyRate}% ocupado`,
                    };
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

        function loadAssignmentSection(sectionId: string) {
          setAssignmentSectionId(sectionId);
          setAssignmentTableIds(
            data.shiftSectionTables
              .filter((row) => row.shiftSectionId === sectionId)
              .map((row) => row.tableId),
          );
          setAssignmentPrimaryId(
            data.shiftSectionStaff.find(
              (row) => row.shiftSectionId === sectionId && row.role === "primary",
            )?.identityId ?? "",
          );
          setAssignmentSupportIds(
            data.shiftSectionStaff
              .filter((row) => row.shiftSectionId === sectionId && row.role === "support")
              .map((row) => row.identityId),
          );
        }

        function openShiftSetup() {
          setSetupSection("shift");
          setShiftSetupStep(data.activeShift ? "team" : "sections");
          setSetupOpen(true);
          if (!assignmentSectionId) {
            loadAssignmentSection(data.shiftSections[0]?.id ?? "");
          }
        }

        function openSpaceSetup() {
          setWorkspaceMode("operate");
          setJoinMode(false);
          setJoinSelection([]);
          setSetupSection("space");
          setSetupOpen(true);
        }

        function openShiftReview() {
          openShiftSetup();
          if (!preflightBlocked) setShiftSetupStep("open");
        }

        function openHandover() {
          setSetupOpen(false);
          setHandoverAssignments({});
          setHandoverOpen(true);
        }

        function goToPreflightItem(itemId?: string) {
          if (!itemId) {
            if (data.activeShift) {
              setSetupOpen(false);
              setWorkspaceMode("operate");
            } else {
              setSetupSection("shift");
              setShiftSetupStep("open");
            }
            return;
          }
          if (itemId === "space") {
            setSetupSection("space");
            return;
          }
          setSetupSection("shift");
          setShiftSetupStep(itemId === "staff" ? "team" : "sections");
        }

        function resetServiceSectionEditor() {
          setManagedServiceSectionId("");
          setServiceSectionName("");
          setServiceSectionColor("#176B4D");
          setServiceSectionMode("hybrid");
          setServiceSectionTableIds([]);
          setServiceSectionDefaultResponsibleId("");
          setServiceSectionTableQuery("");
          setServiceSectionRoomFilter("all");
        }

        function startNewServiceSection() {
          resetServiceSectionEditor();
          setServiceSectionEditorOpen(true);
        }

        function editServiceSection(serviceSectionId: string) {
          const section = data.serviceSections.find(
            (candidate) => candidate.id === serviceSectionId,
          );
          if (!section) return;
          setManagedServiceSectionId(section.id);
          setServiceSectionName(section.name);
          setServiceSectionColor(section.color);
          setServiceSectionMode(section.serviceMode);
          setServiceSectionTableIds(
            data.serviceSectionTables
              .filter((row) => row.sectionId === section.id)
              .map((row) => row.tableId),
          );
          setServiceSectionDefaultResponsibleId(section.defaultResponsibleIdentityId ?? "");
          setServiceSectionTableQuery("");
          setServiceSectionRoomFilter("all");
          setServiceSectionEditorOpen(true);
        }

        function openServiceSectionFloorSelection() {
          if (serviceSectionName.trim().length < 2) {
            setFeedback("Informe o nome da praça antes de selecionar mesas na planta.", "info");
            return;
          }
          setFilterStatus("all");
          setRoomFilter("all");
          setSectionFilter("all");
          setSetupOpen(false);
          setWorkspaceMode("template");
          setFloorEditRequestKey((current) => current + 1);
        }

        function switchWorkspaceMode(mode: "operate" | "shift") {
          if (mode === "shift" && (!canReorganizeTurn || !data.activeShift)) return;
          setWorkspaceMode(mode);
          setJoinMode(false);
          setJoinSelection([]);
          if (mode !== "operate") {
            if (mode === "shift") {
              setShiftEditorTool(canManageShift ? "assign" : "move");
              if (canManageShift) {
                loadAssignmentSection(assignmentSectionId || data.shiftSections[0]?.id || "");
              }
            }
            setFloorEditRequestKey((current) => current + 1);
          }
        }

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
              view?: string;
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
            setView(saved.view === "list" ? "list" : "map");
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
            await floor.refresh();
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
          if (
            canOperateTable(targetTable) &&
            !open &&
            displayStatus(targetTable) === "available" &&
            usesQuickServiceMode(mode)
          ) {
            void openTab(targetTable);
          }
        }

        async function toggleSectionCoverage(
          shiftSectionId: string,
          sectionName: string,
          active: boolean,
        ) {
          if (!data.activeShift || busy) return;
          const shiftId = data.activeShift.id;
          setBusy(true);
          setFeedback("");
          try {
            await api.pilot.updateShiftSectionCoverage(
              scope.organizationId,
              scope.unitId,
              shiftId,
              shiftSectionId,
              active,
            );
            setFeedback(
              active
                ? `Você agora apoia a praça ${sectionName}.`
                : `Cobertura da praça ${sectionName} encerrada.`,
            );
            setUndoAction(() => ({
              message: active ? "Desfazer entrada no apoio" : "Restaurar apoio da praça",
              run: () =>
                api.pilot.updateShiftSectionCoverage(
                  scope.organizationId,
                  scope.unitId,
                  shiftId,
                  shiftSectionId,
                  !active,
                ),
            }));
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
                reasonCode: transferReasonCode,
                ...(transferReason.trim() ? { reasonNote: transferReason.trim() } : {}),
              },
            );
            setTransferDialogOpen(false);
            setFeedback(
              `${selectedGroup ? `Grupo com ${selectedGroupTableIds.length} mesas` : table.label} remanejado até ${new Date(Date.now() + transferDurationMinutes * 60_000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`,
            );
            const shiftId = data.activeShift.id;
            const transferredTableId = table.id;
            setUndoAction(() => ({
              message: "Desfazer remanejamento",
              run: () =>
                api.pilot.endShiftTableTransfer(
                  scope.organizationId,
                  scope.unitId,
                  shiftId,
                  transferredTableId,
                ),
            }));
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

        async function saveManagedTable(event: FormEvent<HTMLFormElement>) {
          event.preventDefault();
          const selected = allActiveTables.find((item) => item.id === managedTableId);
          if (!selected || !managedTableRoomId) return;
          setBusy(true);
          setFeedback("");
          try {
            await api.pilot.updateTable(scope.organizationId, scope.unitId, selected.id, {
              expectedRevision: requiredOperationalRevision(data.floorRevision, "planta"),
              roomId: managedTableRoomId,
              label: managedTableLabel.trim(),
              seats: managedTableSeats,
              width: selected.width ?? 122,
              height: selected.height ?? 76,
              rotation: selected.rotation ?? 0,
              shape: selected.shape ?? "rectangle",
            });
            setFeedback(`${managedTableLabel.trim()} atualizada para toda a equipe.`);
            await floor.refresh();
          } catch (error) {
            setErrorFeedback(error, "Não foi possível atualizar a mesa.");
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
                expectedRevision: requiredOperationalRevision(data.shiftRevision, "turno"),
                tables: positions.flatMap(({ tableId, roomId, x, y, rotation }) =>
                  roomId ? [{ tableId, roomId, x, y, rotation }] : [],
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

        async function archiveManagedTable() {
          const selected = allActiveTables.find((item) => item.id === managedTableId);
          if (
            !selected ||
            busy ||
            !window.confirm(`Arquivar ${selected.label}? O histórico operacional será preservado.`)
          ) {
            return;
          }
          setBusy(true);
          setFeedback("");
          try {
            await api.pilot.archiveTable(
              scope.organizationId,
              scope.unitId,
              selected.id,
              requiredOperationalRevision(data.floorRevision, "planta"),
            );
            setManagedTableId("");
            setManagedTableLabel("");
            setManagedTableSeats(4);
            setManagedTableRoomId("");
            setFeedback("Mesa arquivada. O histórico operacional foi preservado.");
            await floor.refresh();
          } catch (error) {
            setErrorFeedback(
              error,
              "Não foi possível arquivar. Mesas ocupadas, reservadas, agrupadas ou atribuídas ao turno precisam ser liberadas antes.",
            );
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

        async function serveReadyOrders(orderIds: string[]) {
          if (busy || orderIds.length === 0) return;
          setBusy(true);
          setFeedback("");
          try {
            for (const orderId of orderIds) {
              await scope.dispatch(
                "pos.kds.handoff_requested",
                pilotMutation("handoff-kds-order", { orderId, target: "served" }, "cloud-only"),
                (key) =>
                  api.pilot.handoffKds(
                    scope.organizationId,
                    scope.unitId,
                    orderId,
                    "served",
                    undefined,
                    key,
                  ),
              );
            }
            setFeedback(
              orderIds.length === 1
                ? "Pedido marcado como servido."
                : `${orderIds.length} pedidos marcados como servidos.`,
            );
          } catch (error) {
            setErrorFeedback(error, "Não foi possível marcar todos os pedidos como servidos.");
          } finally {
            floor.retry();
            setBusy(false);
          }
        }

        async function saveServiceSection(event?: FormEvent<HTMLFormElement>) {
          event?.preventDefault();
          if (!serviceSectionName.trim() || !serviceSectionTableIds.length) return false;
          setBusy(true);
          setFeedback("");
          try {
            const body = {
              name: serviceSectionName.trim(),
              color: serviceSectionColor,
              serviceMode: serviceSectionMode,
              tableIds: serviceSectionTableIds,
              defaultResponsibleIdentityId: serviceSectionDefaultResponsibleId || null,
            };
            if (managedServiceSectionId) {
              await api.pilot.updateServiceSection(
                scope.organizationId,
                scope.unitId,
                managedServiceSectionId,
                body,
              );
            } else {
              await api.pilot.createServiceSection(scope.organizationId, scope.unitId, body);
            }
            setFeedback(
              managedServiceSectionId
                ? "Modelo de praça atualizado. O turno atual preserva a configuração iniciada."
                : "Modelo de praça salvo para os próximos turnos.",
            );
            resetServiceSectionEditor();
            setServiceSectionEditorOpen(false);
            floor.retry();
            return true;
          } catch (error) {
            setErrorFeedback(error, "Não foi possível salvar o modelo de praça.");
            return false;
          } finally {
            setBusy(false);
          }
        }

        async function archiveServiceSection(serviceSectionId: string, name: string) {
          if (
            !window.confirm(
              `Arquivar a praça ${name}? O turno atual não será alterado e as mesas ficarão disponíveis para outros modelos futuros.`,
            )
          ) {
            return;
          }
          setBusy(true);
          setFeedback("");
          try {
            await api.pilot.archiveServiceSection(
              scope.organizationId,
              scope.unitId,
              serviceSectionId,
            );
            if (managedServiceSectionId === serviceSectionId) {
              resetServiceSectionEditor();
              setServiceSectionEditorOpen(false);
            }
            setFeedback("Modelo de praça arquivado. O turno atual permanece inalterado.");
            floor.retry();
          } catch (error) {
            setErrorFeedback(error, "Não foi possível arquivar o modelo de praça.");
          } finally {
            setBusy(false);
          }
        }

        async function openShift(event: FormEvent<HTMLFormElement>) {
          event.preventDefault();
          if (preflightBlocked) {
            setFeedback(
              "Conclua os itens obrigatórios da prontidão antes de abrir o turno.",
              "info",
            );
            return;
          }
          setBusy(true);
          setFeedback("");
          try {
            await api.pilot.openOperationalShift(scope.organizationId, scope.unitId, {
              label: shiftLabel.trim() || undefined,
              serviceMode: effectiveShiftMode,
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

        async function updateShiftAssignment(event?: FormEvent<HTMLFormElement>) {
          event?.preventDefault();
          if (!data.activeShift || !assignmentSectionId) return;
          if (
            assignmentTableIds.length === 0 &&
            (data.shiftSectionTables.some((row) => row.shiftSectionId === assignmentSectionId) ||
              assignmentPrimaryId ||
              assignmentSupportIds.length > 0) &&
            !window.confirm(
              "Esvaziar esta praÃ§a no turno? As mesas serÃ£o removidas da praÃ§a e a equipe continuarÃ¡ configurada.",
            )
          ) {
            return;
          }
          setBusy(true);
          setFeedback("");
          try {
            const movedTableIds = new Set(assignmentTableIds);
            await api.pilot.updateShiftSections(
              scope.organizationId,
              scope.unitId,
              data.activeShift.id,
              {
                expectedRevision: requiredOperationalRevision(data.shiftRevision, "turno"),
                assignments: data.shiftSections.map((section) => {
                  const currentTableIds = data.shiftSectionTables
                    .filter((row) => row.shiftSectionId === section.id)
                    .map((row) => row.tableId);
                  const currentStaff = data.shiftSectionStaff.filter(
                    (row) => row.shiftSectionId === section.id,
                  );
                  if (section.id === assignmentSectionId) {
                    return {
                      shiftSectionId: section.id,
                      tableIds: assignmentTableIds,
                      primaryIdentityId: assignmentPrimaryId || null,
                      supportIdentityIds: assignmentSupportIds,
                    };
                  }
                  return {
                    shiftSectionId: section.id,
                    tableIds: currentTableIds.filter((tableId) => !movedTableIds.has(tableId)),
                    primaryIdentityId:
                      currentStaff.find((row) => row.role === "primary")?.identityId ?? null,
                    supportIdentityIds: currentStaff
                      .filter((row) => row.role === "support")
                      .map((row) => row.identityId),
                  };
                }),
              },
            );
            setFeedback(
              "Praças do turno atualizadas em conjunto, sem alterar os ambientes físicos.",
            );
            floor.retry();
          } catch (error) {
            setErrorFeedback(error, "Não foi possível atualizar a praça do turno.");
          } finally {
            setBusy(false);
          }
        }

        async function closeShift({
          acknowledgeOpenTabs,
          returnableDecision,
          handoverIdentityId: nextResponsibleIdentityId,
          handoverAssignments: nextAssignments,
          reason,
        }: {
          acknowledgeOpenTabs: boolean;
          returnableDecision?: "acknowledge";
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
                returnableDecision,
                handoverIdentityId: nextResponsibleIdentityId,
                handoverAssignments: nextAssignments,
                reason,
              },
            );
            setAssignmentSectionId("");
            setHandoverOpen(false);
            setFeedback(
              acknowledgeOpenTabs
                ? "Passagem de turno registrada. A próxima equipe continua as pendências."
                : "Turno encerrado sem pendências operacionais.",
            );
            floor.retry();
          } catch (error) {
            if (
              error instanceof ApiClientError &&
              error.code === "SHIFT_HAS_OPEN_RETURNABLE_CUSTODY"
            ) {
              if (error.details?.policy === "block") {
                setFeedback(
                  "Transfira ou confirme a devolução em Estoque > Vasilhames antes de encerrar o turno.",
                  "danger",
                );
                return;
              }
              if (returnableDecision === "acknowledge") {
                setErrorFeedback(error, "Não foi possível encerrar o turno após a confirmação.");
                return;
              }
              if (
                window.confirm(
                  "Há custódias de vasilhames sem destinatário. Deseja encerrar o turno e mantê-las pendentes em Estoque > Vasilhames?",
                )
              ) {
                await closeShift({
                  acknowledgeOpenTabs,
                  returnableDecision: "acknowledge",
                  handoverIdentityId: nextResponsibleIdentityId,
                  handoverAssignments: nextAssignments,
                  reason,
                });
                return;
              }
              setFeedback("Encerramento cancelado. As custódias continuam pendentes.", "info");
              return;
            }
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
            const mutateRoom = (expectedRevision: number) =>
              managedRoomId
                ? api.pilot.updateRoom(scope.organizationId, scope.unitId, managedRoomId, {
                    name: roomName.trim(),
                    sortOrder: Math.max(
                      0,
                      data.rooms.findIndex((candidate) => candidate.id === managedRoomId),
                    ),
                    expectedRevision,
                  })
                : api.pilot.createRoom(scope.organizationId, scope.unitId, {
                    name: roomName.trim(),
                    sortOrder: data.rooms.length,
                    expectedRevision,
                  });
            await runFloorRevisionMutation(
              data.floorRevision,
              async () =>
                parsePilotFloor(await api.pilot.floor(scope.organizationId, scope.unitId))
                  .floorRevision,
              mutateRoom,
            );
            setRoomName("");
            setManagedRoomId("");
            setFeedback(
              managedRoomId
                ? "Ambiente renomeado para toda a equipe."
                : "Ambiente criado. Agora adicione as mesas.",
            );
            await floor.refresh();
          } catch (error) {
            setErrorFeedback(error, "Não foi possível criar o ambiente.");
          } finally {
            setBusy(false);
          }
        }

        async function archiveRoom() {
          if (!managedRoomId || busy) return;
          const selectedRoom = data.rooms.find((candidate) => candidate.id === managedRoomId);
          if (
            !selectedRoom ||
            !window.confirm(
              `Arquivar ${selectedRoom.name}? O ambiente só pode ser arquivado depois que todas as mesas dele forem movidas ou arquivadas.`,
            )
          ) {
            return;
          }
          setBusy(true);
          setFeedback("");
          try {
            await api.pilot.archiveRoom(
              scope.organizationId,
              scope.unitId,
              managedRoomId,
              requiredOperationalRevision(data.floorRevision, "planta"),
            );
            setManagedRoomId("");
            setRoomName("");
            setFeedback("Ambiente arquivado. O histórico da operação foi preservado.");
            floor.retry();
          } catch (error) {
            setErrorFeedback(
              error,
              "Não foi possível arquivar. Mova ou arquive primeiro as mesas ativas deste ambiente.",
            );
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
              expectedRevision: requiredOperationalRevision(data.floorRevision, "planta"),
              tables: tableNames.map((label) => ({
                label,
                seats: tableSeats,
                width: 122,
                height: 76,
                rotation: 0,
                shape: "rectangle" as const,
              })),
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
          if (joinTables.some((item) => !canOperateTable(item))) {
            setFeedback(
              "A seleção inclui uma mesa fora do seu atendimento. Peça ao coordenador da operação para concluir a junção.",
              "info",
            );
            return;
          }
          if (joinTables.some((item) => item.status === "reserved")) {
            setFeedback("Resolva a reserva antes de juntar essa mesa ao atendimento.", "info");
            return;
          }
          setJoinAnchorId(joinAnchorOptions[0] ?? "");
          setJoinResponsibleIdentityId(
            joinTabs.find((open) => open.responsibleIdentityId)?.responsibleIdentityId ??
              scope.identityId,
          );
          setJoinReasonCode(joinTabs.length > 1 ? "sit_together" : "large_party");
          setJoinReasonNote("");
          setFeedback("");
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
          if (joinReasonCode === "other" && joinReasonNote.trim().length < 3) {
            setFeedback("Descreva o motivo da junção quando selecionar Outro.", "info");
            return;
          }
          if (effectiveJoinAccountMode === "layout_only") {
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
              floorPlanElements,
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
                  expectedRevision: requiredOperationalRevision(data.shiftRevision, "turno"),
                  tables: joinedLayout.positions.map((p) => ({
                    tableId: p.tableId,
                    roomId:
                      p.roomId ??
                      floorPlanItems.find((f) => f.id === p.tableId)?.areaId ??
                      data.rooms[0]?.id ??
                      "",
                    x: p.x,
                    y: p.y,
                    rotation: p.rotation,
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
          if (effectiveJoinAccountMode === "single_tab" && joinTabs.length > 0 && !targetTabId) {
            setFeedback("Escolha como principal uma mesa com comanda aberta.", "info");
            return;
          }
          const body = {
            tableIds: joinTableIds,
            anchorTableId: joinAnchorId,
            mode: effectiveJoinAccountMode,
            ...buildTableGroupReason(joinReasonCode, joinReasonNote),
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
              effectiveJoinAccountMode === "single_tab"
                ? joiningFreeTables
                  ? "Mesas agrupadas. Ao abrir qualquer uma, a comanda será única para o grupo."
                  : "Mesas agrupadas com uma única comanda."
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
          <div className="salon-shell" ref={salonShellRef}>
            <section aria-label="Central da operação" className="salon-command-center">
              <header
                aria-live="polite"
                className="salon-command-center__header"
                role={floor.refreshError ? "alert" : "status"}
              >
                <div className="salon-command-center__identity">
                  <span className="salon-role-indicator__avatar" aria-hidden="true">
                    <Icon name="user" size={16} />
                  </span>
                  <span>
                    <small>
                      {activeUserName} · {roleConfig.title}
                    </small>
                    <strong>{roleFocus.label}</strong>
                    <small>{roleFocus.detail}</small>
                  </span>
                </div>
                <div className="salon-command-center__health">
                  <span>
                    <StatusDot
                      pulse={floor.refreshing}
                      tone={
                        !online || floor.refreshError
                          ? "danger"
                          : floor.refreshing
                            ? "warning"
                            : "success"
                      }
                    />
                    <small>
                      {!online
                        ? "Sem conexão · dados preservados"
                        : floor.refreshError
                          ? "Dados anteriores"
                          : floor.refreshing
                            ? "Sincronizando…"
                            : floor.lastSuccessfulAt
                              ? `Confirmado ${new Date(floor.lastSuccessfulAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
                              : "Aguardando…"}
                    </small>
                  </span>
                  {attentionSummary.overdue > 0 && (
                    <Badge tone="danger">{attentionSummary.overdue} SLA vencido</Badge>
                  )}
                  {attentionSummary.failedPrints > 0 && (
                    <Badge tone="danger">{attentionSummary.failedPrints} falha de impressão</Badge>
                  )}
                  {attentionSummary.printConfirmations > 0 && (
                    <Badge tone="warning">
                      {attentionSummary.printConfirmations} saída a confirmar
                    </Badge>
                  )}
                  {canConfigure && (
                    <Button
                      onClick={() => {
                        if (data.activeShift || preflight[0]?.ready) openShiftSetup();
                        else {
                          setSetupSection("space");
                          setSetupOpen(true);
                        }
                      }}
                      size="sm"
                      variant={preflightReady === preflight.length ? "ghost" : "secondary"}
                    >
                      Prontidão {preflightReady}/{preflight.length}
                    </Button>
                  )}
                  {canConfigure && (
                    <Button
                      onClick={() => setShowMetricsCockpit((current) => !current)}
                      size="sm"
                      variant="ghost"
                    >
                      <Icon name="dashboard" size={14} />
                      {showMetricsCockpit ? "Ocultar indicadores" : "Indicadores"}
                    </Button>
                  )}
                  {(floor.refreshError || !online) && (
                    <Button onClick={floor.retry} size="sm" variant="ghost">
                      Atualizar planta
                    </Button>
                  )}
                </div>
              </header>
              {canManageShift && (
                <section aria-label="Controle do turno" className="salon-shift-control">
                  <span>
                    <small>{data.activeShift ? "Turno atual" : "Atendimento"}</small>
                    <strong>{data.activeShift?.label ?? "Nenhum turno aberto"}</strong>
                    <small id="salon-shift-close-status">
                      {!data.activeShift
                        ? "Abra o turno para distribuir praças e equipe."
                        : canCloseShift
                          ? "Sem pendências: o turno pode ser encerrado."
                          : `${shiftClosureSummary}. Resolva tudo para encerrar ou faça a passagem.`}
                    </small>
                  </span>
                  <div className="salon-shift-control__actions">
                    {!data.activeShift ? (
                      <Button onClick={openShiftReview} size="sm">
                        Abrir turno
                      </Button>
                    ) : (
                      <>
                        <Button onClick={openHandover} size="sm" variant="secondary">
                          Passar turno
                        </Button>
                        <Button
                          aria-describedby="salon-shift-close-status"
                          disabled={busy || !canCloseShift}
                          onClick={() =>
                            window.confirm(
                              "Encerrar o turno sem pendências? Uma nova operação exigirá a abertura de outro turno.",
                            ) && void closeShift({ acknowledgeOpenTabs: false })
                          }
                          size="sm"
                          variant="danger"
                        >
                          Encerrar turno
                        </Button>
                      </>
                    )}
                  </div>
                </section>
              )}
              {(!online || floor.refreshError) && (
                <div className="salon-recovery-banner" role="alert">
                  <Icon name={online ? "refresh" : "alert-circle"} size={16} />
                  <span>
                    <strong>
                      {online ? "A planta precisa ser atualizada" : "Operação sem conexão"}
                    </strong>
                    <small>
                      {online
                        ? floor.refreshError
                        : "A última visão confirmada continua disponível. Comandos compatíveis ficam na fila idempotente do terminal."}
                    </small>
                  </span>
                  <Button disabled={!online || floor.refreshing} onClick={floor.retry} size="sm">
                    {floor.refreshing ? "Atualizando…" : "Atualizar planta"}
                  </Button>
                </div>
              )}
              {priorityCount > 0 && (
                <details
                  className="service-priority-queue"
                  id="salon-priority-queue"
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
                        <Button
                          className="priority-task priority-task--warning"
                          key={`ready-${readyTable.id}`}
                          onClick={() => selectTable(readyTable)}
                          type="button"
                          variant="secondary"
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
                        </Button>
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
                        <Button
                          className="priority-task priority-task--warning"
                          key={group?.id ?? transfer.id}
                          onClick={() => {
                            setSelectedTableId(targetTableId);
                            setView("map");
                          }}
                          type="button"
                          variant="secondary"
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
                          <strong>Localizar no painel</strong>
                        </Button>
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
                          className={
                            overdue ? "priority-task priority-task--late" : "priority-task"
                          }
                          key={call.id}
                        >
                          <span>
                            <strong>
                              {tableLabel} · {callKindLabel[call.kind]}
                            </strong>
                            <small>
                              {overdue ? "SLA vencido · " : ""}
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
                                    data.openTabs.find((open) => open.tableId === call.tableId)
                                      ?.id ??
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

              {canConfigure && showMetricsCockpit && (
                <div className="salon-metrics-cockpit">
                  <Card className="salon-metric-card">
                    <div className="salon-metric-card__header">
                      <span>Faturamento em aberto</span>
                      <Icon name="cash" size={16} />
                    </div>
                    <strong>{formatMoney(totalActiveSalonCents)}</strong>
                    <small>{activeOpenTabs.length} comanda(s) ativas no salão</small>
                  </Card>

                  <Card className="salon-metric-card">
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
                  </Card>

                  <Card className="salon-metric-card">
                    <div className="salon-metric-card__header">
                      <span>Ticket médio / mesa</span>
                      <Icon name="catalog" size={16} />
                    </div>
                    <strong>{formatMoney(avgTicketPerTableCents)}</strong>
                    <small>Por mesa ocupada no turno</small>
                  </Card>

                  <Card className="salon-metric-card salon-metric-card--alert">
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
                      {attentionSummary.overdue > 0 && (
                        <span className="salon-metric-pill salon-metric-pill--danger">
                          <strong>{attentionSummary.overdue}</strong> chamado(s) com SLA vencido
                        </span>
                      )}
                      {attentionSummary.failedPrints > 0 && (
                        <span className="salon-metric-pill salon-metric-pill--danger">
                          <strong>{attentionSummary.failedPrints}</strong> falha(s) de impressão
                        </span>
                      )}
                      {attentionSummary.printConfirmations > 0 && (
                        <span className="salon-metric-pill salon-metric-pill--warning">
                          <strong>{attentionSummary.printConfirmations}</strong> saída(s) físicas a
                          confirmar
                        </span>
                      )}
                      {counts.turnover > 0 && (
                        <span className="salon-metric-pill salon-metric-pill--info">
                          <strong>{counts.turnover}</strong> mesa(s) em giro/limpeza
                        </span>
                      )}
                      {counts.closing === 0 &&
                        counts.attention === 0 &&
                        counts.turnover === 0 &&
                        attentionSummary.failedPrints === 0 &&
                        attentionSummary.printConfirmations === 0 &&
                        attentionSummary.overdue === 0 && (
                          <span className="salon-metric-pill salon-metric-pill--success">
                            Operação em dia (sem pendências)
                          </span>
                        )}
                    </div>
                  </Card>
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
                            (id) =>
                              data.tables.find((candidate) => candidate.id === id)?.label ?? [],
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
                <details className="salon-filter-menu" data-salon-floating-menu>
                  <summary>
                    <Icon name="list" size={15} />
                    <span>Filtros</span>
                    {advancedFilterCount > 0 && <b>{advancedFilterCount}</b>}
                  </summary>
                  <div className="salon-filter-menu__panel">
                    <Label className="salon-select">
                      <span>Ambiente</span>
                      <NativeSelect
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
                      </NativeSelect>
                    </Label>
                    <Label className="salon-select">
                      <span>Praça do turno</span>
                      <NativeSelect
                        onChange={(event) => setSectionFilter(event.target.value)}
                        value={sectionFilter}
                      >
                        <option value="all">Todas as praças</option>
                        {data.activeShift && (
                          <option value="mine">Minhas praças e coberturas</option>
                        )}
                        {data.shiftSections.map((section) => (
                          <option key={section.id} value={section.id}>
                            {section.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </Label>
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
                  <Button
                    aria-pressed={view === "map"}
                    className="gm-pill"
                    onClick={() => setView("map")}
                    type="button"
                    title="Visão em cartões"
                  >
                    <Icon name="grid" size={14} />
                    <span>Painel</span>
                  </Button>
                  <Button
                    aria-pressed={view === "list"}
                    className="gm-pill"
                    onClick={() => setView("list")}
                    type="button"
                    title="Lista rápida de alto giro"
                  >
                    <Icon name="list" size={14} />
                    <span>Lista</span>
                  </Button>
                </fieldset>
                <Button
                  aria-label="Atalhos de teclado"
                  className="salon-command-shortcuts"
                  onClick={() => setShortcutsModalOpen(true)}
                  size="sm"
                  title="Atalhos de teclado [?]"
                  variant="ghost"
                >
                  <Icon name="clock" size={14} />
                  <span>Atalhos [?]</span>
                </Button>
                {canReorganizeTurn && (
                  <Button
                    aria-pressed={joinMode}
                    className="salon-join-action"
                    onClick={() => {
                      setJoinMode((current) => !current);
                      setJoinSelection([]);
                    }}
                    size="sm"
                    variant={joinMode ? "secondary" : "ghost"}
                  >
                    {joinMode ? "Cancelar junção" : "Juntar mesas"}
                  </Button>
                )}
              </div>

              {(canConfigure || data.capabilities?.canAccessAllTabs) && data.activeShift && (
                <details className="service-load-panel">
                  <summary>
                    <span>
                      <strong>Carga por praça e responsável</strong>
                      <small>Leitura operacional; qualquer redistribuição continua manual.</small>
                    </span>
                    <Badge tone="neutral">{operationalLoad.sections.length} praça(s)</Badge>
                  </summary>
                  <div className="service-load-panel__body">
                    <section>
                      <strong>Praças</strong>
                      <div className="service-load-grid">
                        {operationalLoad.sections.map((section) => (
                          <article key={section.id} style={{ borderLeftColor: section.color }}>
                            <strong>{section.name}</strong>
                            <small>
                              {section.occupied}/{section.tables} mesa(s) · {section.guests}{" "}
                              pessoa(s)
                            </small>
                            <small>
                              {section.calls} chamado(s)
                              {data.capabilities?.canAccessAllTabs
                                ? ` · ${formatMoney(section.totalCents)}`
                                : ""}
                            </small>
                          </article>
                        ))}
                      </div>
                    </section>
                    <section>
                      <strong>Equipe</strong>
                      <div className="service-load-grid">
                        {operationalLoad.staff.map((person) => (
                          <article key={person.identityId}>
                            <strong>{person.displayName}</strong>
                            <small>
                              {person.sections} praça(s) · {person.tabs} comanda(s) ·{" "}
                              {person.guests} pessoa(s)
                            </small>
                            {data.capabilities?.canAccessAllTabs && (
                              <small>{formatMoney(person.totalCents)} em aberto</small>
                            )}
                          </article>
                        ))}
                      </div>
                      {canManageShift && (
                        <Button onClick={openShiftSetup} size="sm" variant="ghost">
                          Ajustar distribuição
                        </Button>
                      )}
                    </section>
                  </div>
                </details>
              )}
            </section>

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
                  <section
                    className="salon-setup-assistant"
                    aria-labelledby="setup-readiness-title"
                  >
                    <header>
                      <span>
                        <small>Assistente de configuração</small>
                        <strong id="setup-readiness-title">
                          {data.activeShift ? "Prontidão do turno" : "Antes de abrir o turno"}
                        </strong>
                      </span>
                      <Badge tone={preflightBlocked ? "warning" : "success"}>
                        {preflightReady}/{preflight.length} concluídos
                      </Badge>
                    </header>
                    <div className="salon-setup-assistant__progress" aria-hidden="true">
                      <i style={{ width: `${(preflightReady / preflight.length) * 100}%` }} />
                    </div>
                    <div className="salon-next-action">
                      <span>
                        <small>Próxima ação</small>
                        <strong>
                          {nextPreflightItem
                            ? `${nextPreflightItem.label}: ${nextPreflightItem.detail}`
                            : data.activeShift
                              ? "Turno pronto para operar"
                              : "Revisar e abrir o turno"}
                        </strong>
                      </span>
                      {(nextPreflightItem || data.activeShift) && (
                        <Button
                          onClick={() => goToPreflightItem(nextPreflightItem?.id)}
                          size="sm"
                          type="button"
                        >
                          {nextPreflightItem ? "Continuar configuração" : "Operar salão"}
                        </Button>
                      )}
                    </div>
                    <ol>
                      {preflight.map((item) => (
                        <li className={item.ready ? "is-ready" : ""} key={item.id}>
                          <StatusDot
                            tone={item.ready ? "success" : item.blocking ? "danger" : "warning"}
                          />
                          <span>
                            <strong>{item.label}</strong>
                            <small>{item.detail}</small>
                          </span>
                        </li>
                      ))}
                    </ol>
                  </section>
                  <fieldset className="segmented floor-setup__scope">
                    <legend className="gm-sr-only">Tipo de configuração</legend>
                    <Button
                      aria-pressed={setupSection === "space"}
                      onClick={() => setSetupSection("space")}
                      type="button"
                    >
                      Espaço físico
                    </Button>
                    <Button
                      aria-pressed={setupSection === "shift"}
                      onClick={openShiftSetup}
                      type="button"
                    >
                      Turno e praças
                    </Button>
                  </fieldset>
                  {setupSection === "space" ? (
                    <div className="quick-actions-grid floor-management__forms floor-management__forms--real">
                      <form className="action-form" onSubmit={(event) => void createRoom(event)}>
                        <h3>{managedRoomId ? "Editar ambiente físico" : "Novo ambiente físico"}</h3>
                        <Label>
                          Gerenciar
                          <NativeSelect
                            onChange={(event) => {
                              const nextId = event.target.value;
                              setManagedRoomId(nextId);
                              setRoomName(
                                data.rooms.find((candidate) => candidate.id === nextId)?.name ?? "",
                              );
                            }}
                            value={managedRoomId}
                          >
                            <option value="">Criar novo ambiente</option>
                            {data.rooms
                              .filter((item) => item.active)
                              .map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name}
                                </option>
                              ))}
                          </NativeSelect>
                        </Label>
                        <Label>
                          Nome
                          <Input
                            minLength={2}
                            onChange={(event) => setRoomName(event.target.value)}
                            required
                            value={roomName}
                          />
                        </Label>
                        <Button disabled={busy || roomName.trim().length < 2} type="submit">
                          {busy ? "Salvando…" : managedRoomId ? "Salvar nome" : "Criar ambiente"}
                        </Button>
                        {managedRoomId && (
                          <Button
                            disabled={busy}
                            onClick={() => void archiveRoom()}
                            type="button"
                            variant="danger"
                          >
                            Arquivar ambiente
                          </Button>
                        )}
                      </form>
                      <form
                        className="action-form action-form--tables"
                        onSubmit={(event) => void createTables(event)}
                      >
                        <h3>Adicionar mesas</h3>
                        <fieldset className="table-create-mode">
                          <legend>Quantidade</legend>
                          <Button
                            aria-pressed={tableMode === "single"}
                            onClick={() => setTableMode("single")}
                            type="button"
                          >
                            Uma mesa
                          </Button>
                          <Button
                            aria-pressed={tableMode === "batch"}
                            onClick={() => setTableMode("batch")}
                            type="button"
                          >
                            Em sequência
                          </Button>
                        </fieldset>
                        {tableMode === "single" ? (
                          <Label className="action-form__wide">
                            Identificação
                            <Input
                              maxLength={60}
                              minLength={1}
                              onChange={(event) => setTableLabel(event.target.value)}
                              placeholder="Ex.: Mesa 12"
                              required
                              value={tableLabel}
                            />
                          </Label>
                        ) : (
                          <>
                            <Label className="action-form__wide">
                              Prefixo
                              <Input
                                maxLength={50}
                                onChange={(event) => setTablePrefix(event.target.value)}
                                required
                                value={tablePrefix}
                              />
                            </Label>
                            <Label>
                              Iniciar em
                              <Input
                                min={1}
                                onChange={(event) => setTableStart(Number(event.target.value))}
                                required
                                type="number"
                                value={tableStart}
                              />
                            </Label>
                            <Label>
                              Quantidade
                              <Input
                                max={MAX_TABLE_BATCH}
                                min={1}
                                onChange={(event) => setTableQuantity(Number(event.target.value))}
                                required
                                type="number"
                                value={tableQuantity}
                              />
                            </Label>
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
                        <Label>
                          Lugares por mesa
                          <Input
                            max={100}
                            min={1}
                            onChange={(event) => setTableSeats(Number(event.target.value))}
                            required
                            type="number"
                            value={tableSeats}
                          />
                        </Label>
                        <Label>
                          Ambiente
                          <NativeSelect
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
                          </NativeSelect>
                        </Label>
                        <Button
                          disabled={busy || !tableNames.length || data.rooms.length === 0}
                          type="submit"
                        >
                          {tableMode === "batch"
                            ? `Criar ${tableNames.length} mesas`
                            : "Criar mesa"}
                        </Button>
                      </form>
                      <form
                        className="action-form"
                        onSubmit={(event) => void saveManagedTable(event)}
                      >
                        <h3>Gerenciar mesa</h3>
                        <Label className="action-form__wide">
                          Mesa
                          <NativeSelect
                            onChange={(event) => {
                              const nextId = event.target.value;
                              const nextTable = allActiveTables.find((item) => item.id === nextId);
                              setManagedTableId(nextId);
                              setManagedTableLabel(nextTable?.label ?? "");
                              setManagedTableSeats(nextTable?.seats ?? 4);
                              setManagedTableRoomId(nextTable?.roomId ?? "");
                            }}
                            value={managedTableId}
                          >
                            <option value="">Selecione uma mesa</option>
                            {allActiveTables.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.label}
                              </option>
                            ))}
                          </NativeSelect>
                        </Label>
                        <Label className="action-form__wide">
                          Identificação
                          <Input
                            disabled={!managedTableId}
                            maxLength={60}
                            minLength={1}
                            onChange={(event) => setManagedTableLabel(event.target.value)}
                            required
                            value={managedTableLabel}
                          />
                        </Label>
                        <Label>
                          Lugares
                          <Input
                            disabled={!managedTableId}
                            max={100}
                            min={1}
                            onChange={(event) => setManagedTableSeats(Number(event.target.value))}
                            required
                            type="number"
                            value={managedTableSeats}
                          />
                        </Label>
                        <Label>
                          Ambiente
                          <NativeSelect
                            disabled={!managedTableId}
                            onChange={(event) => setManagedTableRoomId(event.target.value)}
                            required
                            value={managedTableRoomId}
                          >
                            <option disabled value="">
                              Selecione
                            </option>
                            {data.rooms
                              .filter((item) => item.active)
                              .map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name}
                                </option>
                              ))}
                          </NativeSelect>
                        </Label>
                        <Button
                          disabled={
                            busy ||
                            !managedTableId ||
                            !managedTableRoomId ||
                            !managedTableLabel.trim() ||
                            !Number.isInteger(managedTableSeats) ||
                            managedTableSeats < 1 ||
                            managedTableSeats > 100
                          }
                          type="submit"
                        >
                          {busy ? "Salvando…" : "Salvar mesa"}
                        </Button>
                        <Button
                          disabled={busy || !managedTableId}
                          onClick={() => void archiveManagedTable()}
                          type="button"
                          variant="danger"
                        >
                          Arquivar mesa
                        </Button>
                      </form>
                    </div>
                  ) : (
                    <div className="shift-setup-flow">
                      <nav aria-label="Etapas da preparação do turno" className="shift-setup-steps">
                        <Button
                          aria-current={shiftSetupStep === "sections" ? "step" : undefined}
                          onClick={() => setShiftSetupStep("sections")}
                          type="button"
                          variant="ghost"
                        >
                          <small>1</small> Revisar praças
                        </Button>
                        <Button
                          aria-current={shiftSetupStep === "team" ? "step" : undefined}
                          disabled={!data.serviceSections.length && !data.activeShift}
                          onClick={() => setShiftSetupStep("team")}
                          type="button"
                          variant="ghost"
                        >
                          <small>2</small> Distribuir equipe
                        </Button>
                        <Button
                          aria-current={shiftSetupStep === "open" ? "step" : undefined}
                          disabled={Boolean(data.activeShift) || preflightBlocked}
                          onClick={() => setShiftSetupStep("open")}
                          type="button"
                          variant="ghost"
                        >
                          <small>3</small> Abrir turno
                        </Button>
                      </nav>

                      {shiftSetupStep === "sections" && (
                        <section className="service-section-manager">
                          <header className="service-section-manager__header">
                            <span>
                              <small>Configuração permanente</small>
                              <h3>Praças reutilizáveis</h3>
                              <p>
                                Defina mesas, cor, atendimento e titular padrão. Alterações não
                                mudam o turno que já estiver aberto.
                              </p>
                            </span>
                            <Button onClick={startNewServiceSection} size="sm" type="button">
                              <Icon name="plus" size={14} /> Nova praça
                            </Button>
                          </header>

                          {serviceSectionSummaries.length ? (
                            <div className="service-section-list">
                              {serviceSectionSummaries.map(
                                ({ section, tableIds, defaultResponsible }) => (
                                  <article key={section.id}>
                                    <i
                                      aria-hidden="true"
                                      className="service-section-list__color"
                                      style={{ backgroundColor: section.color }}
                                    />
                                    <span>
                                      <strong>{section.name}</strong>
                                      <small>
                                        {tableIds.length} {tableIds.length === 1 ? "mesa" : "mesas"}
                                        {" · "}
                                        {serviceModeLabel(section.serviceMode)}
                                      </small>
                                    </span>
                                    <Badge tone={defaultResponsible ? "success" : "warning"}>
                                      {defaultResponsible?.displayName ?? "Sem titular padrão"}
                                    </Badge>
                                    <div>
                                      <Button
                                        onClick={() => editServiceSection(section.id)}
                                        size="sm"
                                        type="button"
                                        variant="ghost"
                                      >
                                        Editar
                                      </Button>
                                      <Button
                                        disabled={busy}
                                        onClick={() =>
                                          void archiveServiceSection(section.id, section.name)
                                        }
                                        size="sm"
                                        type="button"
                                        variant="ghost"
                                      >
                                        Arquivar
                                      </Button>
                                    </div>
                                  </article>
                                ),
                              )}
                            </div>
                          ) : (
                            <p className="shift-assignment-empty">
                              Nenhuma praça configurada. Crie a primeira para poder abrir o turno.
                            </p>
                          )}
                          {!serviceSectionEditorOpen && serviceSectionSummaries.length > 0 && (
                            <footer>
                              <Button onClick={() => setShiftSetupStep("team")} type="button">
                                {data.activeShift
                                  ? "Voltar à equipe do turno"
                                  : "Continuar para equipe"}
                              </Button>
                            </footer>
                          )}
                        </section>
                      )}

                      {shiftSetupStep === "sections" && serviceSectionEditorOpen && (
                        <form
                          className="action-form action-form--service-section service-section-editor"
                          onSubmit={(event) => void saveServiceSection(event)}
                        >
                          <header className="service-section-editor__header action-form__wide">
                            <span>
                              <small>
                                {managedServiceSectionId ? "Editar modelo" : "Nova praça"}
                              </small>
                              <h3>
                                {managedServiceSectionId
                                  ? serviceSectionName || "Praça"
                                  : "Configurar praça"}
                              </h3>
                            </span>
                            <Button
                              onClick={() => {
                                resetServiceSectionEditor();
                                setServiceSectionEditorOpen(false);
                              }}
                              size="sm"
                              type="button"
                              variant="ghost"
                            >
                              Cancelar
                            </Button>
                          </header>
                          <Label>
                            Nome
                            <Input
                              maxLength={120}
                              minLength={2}
                              onChange={(event) => setServiceSectionName(event.target.value)}
                              placeholder="Ex.: Praça A"
                              required
                              value={serviceSectionName}
                            />
                          </Label>
                          <div className="service-section-color">
                            <Label>
                              Cor da praça
                              <input
                                className="border-input bg-background"
                                aria-label="Cor da borda das mesas"
                                onChange={(event) => setServiceSectionColor(event.target.value)}
                                type="color"
                                value={serviceSectionColor}
                              />
                            </Label>
                            <span>
                              <i
                                aria-hidden="true"
                                className="service-section-color__preview"
                                style={{ borderColor: serviceSectionColor }}
                              >
                                Mesa
                              </i>
                              <small>Aparece na borda das mesas durante o turno.</small>
                            </span>
                          </div>
                          <ServiceModePicker
                            legend="Como esta praça atende?"
                            name="service-section-mode"
                            onChange={setServiceSectionMode}
                            value={serviceSectionMode}
                          />
                          <Label>
                            Titular padrão — opcional
                            <NativeSelect
                              onChange={(event) =>
                                setServiceSectionDefaultResponsibleId(event.target.value)
                              }
                              value={serviceSectionDefaultResponsibleId}
                            >
                              <option value="">Definir na preparação do turno</option>
                              {data.staff.map((person) => (
                                <option key={person.identityId} value={person.identityId}>
                                  {person.displayName}
                                </option>
                              ))}
                            </NativeSelect>
                          </Label>
                          <p className="field-hint action-form__wide">
                            Somente pessoas com convite aceito e acesso ativo nesta unidade aparecem
                            aqui. Ao reaproveitar a equipe anterior, ela será priorizada.
                          </p>
                          <fieldset className="service-section-table-picker action-form__wide">
                            <legend>Mesas da praça</legend>
                            <div className="service-section-table-picker__toolbar">
                              <Input
                                aria-label="Buscar mesa para a praça"
                                onChange={(event) =>
                                  setServiceSectionTableQuery(event.target.value)
                                }
                                placeholder="Buscar mesa ou ambiente"
                                value={serviceSectionTableQuery}
                              />
                              <NativeSelect
                                aria-label="Filtrar mesas por ambiente"
                                onChange={(event) =>
                                  setServiceSectionRoomFilter(event.target.value)
                                }
                                value={serviceSectionRoomFilter}
                              >
                                <option value="all">Todos os ambientes</option>
                                {data.rooms
                                  .filter((room) => room.active)
                                  .map((room) => (
                                    <option key={room.id} value={room.id}>
                                      {room.name}
                                    </option>
                                  ))}
                              </NativeSelect>
                              <Button
                                disabled={!visibleServiceSectionTables.length}
                                onClick={() => {
                                  const visibleIds = visibleServiceSectionTables.map(
                                    (item) => item.id,
                                  );
                                  const allSelected = visibleIds.every((id) =>
                                    serviceSectionTableIds.includes(id),
                                  );
                                  setServiceSectionTableIds((current) =>
                                    allSelected
                                      ? current.filter((id) => !visibleIds.includes(id))
                                      : [...new Set([...current, ...visibleIds])],
                                  );
                                }}
                                size="sm"
                                type="button"
                                variant="ghost"
                              >
                                {visibleServiceSectionTables.every((item) =>
                                  serviceSectionTableIds.includes(item.id),
                                ) && visibleServiceSectionTables.length
                                  ? "Desmarcar visíveis"
                                  : "Selecionar visíveis"}
                              </Button>
                            </div>
                            <div className="service-section-table-picker__summary">
                              <strong>{serviceSectionTableIds.length} selecionada(s)</strong>
                              <Button
                                onClick={openServiceSectionFloorSelection}
                                size="sm"
                                type="button"
                                variant="secondary"
                              >
                                <Icon name="salon" size={14} /> Selecionar na planta
                              </Button>
                            </div>
                            <div className="service-section-table-picker__rooms">
                              {data.rooms
                                .filter(
                                  (room) =>
                                    room.active &&
                                    visibleServiceSectionTables.some(
                                      (item) => item.roomId === room.id,
                                    ),
                                )
                                .map((room) => (
                                  <section key={room.id}>
                                    <strong>{room.name}</strong>
                                    <div>
                                      {visibleServiceSectionTables
                                        .filter((item) => item.roomId === room.id)
                                        .map((item) => (
                                          <Label key={item.id}>
                                            <input
                                              className="accent-primary"
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
                                            <span>{item.label}</span>
                                          </Label>
                                        ))}
                                    </div>
                                  </section>
                                ))}
                              {!visibleServiceSectionTables.length && (
                                <p className="field-hint">Nenhuma mesa disponível neste filtro.</p>
                              )}
                            </div>
                          </fieldset>
                          <footer className="service-section-editor__actions action-form__wide">
                            <span aria-live="polite">
                              {!serviceSectionName.trim()
                                ? "Informe o nome da praça."
                                : !serviceSectionTableIds.length
                                  ? "Selecione pelo menos uma mesa."
                                  : `${serviceSectionTableIds.length} mesa(s) prontas para salvar.`}
                            </span>
                            <Button
                              disabled={
                                busy || !serviceSectionName.trim() || !serviceSectionTableIds.length
                              }
                              type="submit"
                            >
                              {busy
                                ? "Salvando…"
                                : managedServiceSectionId
                                  ? "Salvar alterações"
                                  : "Criar praça"}
                            </Button>
                          </footer>
                        </form>
                      )}

                      {shiftSetupStep === "team" && data.activeShift && (
                        <form
                          className="action-form action-form--shift"
                          onSubmit={(event) => void updateShiftAssignment(event)}
                        >
                          <header className="shift-assignment__header">
                            <span>
                              <h3>Equipe das praças</h3>
                              <small>
                                {data.activeShift.label} ·{" "}
                                {serviceModeLabel(data.activeShift.serviceMode)}
                              </small>
                            </span>
                            <Badge
                              tone={
                                shiftSectionAssignments.every(({ primary }) => primary)
                                  ? "success"
                                  : "warning"
                              }
                            >
                              {shiftSectionAssignments.filter(({ primary }) => primary).length}/
                              {shiftSectionAssignments.length} com titular
                            </Badge>
                          </header>

                          <fieldset className="shift-section-picker action-form__wide">
                            <legend>1. Escolha a praça</legend>
                            <div>
                              {shiftSectionAssignments.map(({ section, tableCount, primary }) => (
                                <button
                                  aria-pressed={assignmentSectionId === section.id}
                                  key={section.id}
                                  onClick={() => loadAssignmentSection(section.id)}
                                  type="button"
                                >
                                  <i
                                    aria-hidden="true"
                                    className="shift-section-picker__color"
                                    style={{ backgroundColor: section.color }}
                                  />
                                  <span>
                                    <strong>{section.name}</strong>
                                    <small>
                                      {tableCount} {tableCount === 1 ? "mesa" : "mesas"}
                                    </small>
                                  </span>
                                  <b>{primary?.displayName ?? "Sem titular"}</b>
                                </button>
                              ))}
                            </div>
                          </fieldset>

                          {selectedShiftSection ? (
                            <section className="shift-assignment-editor action-form__wide">
                              <header>
                                <span>
                                  <small>2. Defina quem atende</small>
                                  <strong>{selectedShiftSection.section.name}</strong>
                                </span>
                                <Badge tone="neutral">
                                  {selectedShiftSection.tableCount} mesa(s)
                                </Badge>
                              </header>
                              <Label>
                                Garçom titular
                                <NativeSelect
                                  onChange={(event) => {
                                    const identityId = event.target.value;
                                    setAssignmentPrimaryId(identityId);
                                    setAssignmentSupportIds((current) =>
                                      current.filter((id) => id !== identityId),
                                    );
                                  }}
                                  value={assignmentPrimaryId}
                                >
                                  <option value="">Selecione o responsável</option>
                                  {data.staff.map((person) => (
                                    <option key={person.identityId} value={person.identityId}>
                                      {person.displayName}
                                    </option>
                                  ))}
                                </NativeSelect>
                              </Label>
                              {!data.staff.length && (
                                <p className="field-hint" role="status">
                                  Cadastre ou vincule a equipe antes de atribuir um titular.
                                </p>
                              )}

                              <details className="shift-assignment-details">
                                <summary>
                                  <span>Apoios opcionais</span>
                                  <Badge tone="neutral">{assignmentSupportIds.length}</Badge>
                                </summary>
                                <fieldset className="floor-setup__tables">
                                  <legend>Quem também pode atender esta praça?</legend>
                                  {data.staff
                                    .filter((person) => person.identityId !== assignmentPrimaryId)
                                    .map((person) => (
                                      <Label key={person.identityId}>
                                        <input
                                          className="accent-primary"
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
                                      </Label>
                                    ))}
                                </fieldset>
                              </details>

                              <details className="shift-assignment-details">
                                <summary>
                                  <span>Revisar mesas da praça</span>
                                  <Badge tone="neutral">{assignmentTableIds.length}</Badge>
                                </summary>
                                <p className="field-hint">
                                  Use somente para mover uma mesa entre praças neste turno.
                                </p>
                                <fieldset className="floor-setup__tables">
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
                                        <Label key={item.id}>
                                          <input
                                            className="accent-primary"
                                            checked={assignmentTableIds.includes(item.id)}
                                            onChange={() =>
                                              setAssignmentTableIds((current) =>
                                                current.includes(item.id)
                                                  ? current.filter((id) => id !== item.id)
                                                  : [...current, item.id],
                                              )
                                            }
                                            type="checkbox"
                                          />
                                          <span>
                                            {item.label} ·{" "}
                                            {
                                              data.rooms.find((room) => room.id === item.roomId)
                                                ?.name
                                            }
                                            {otherSection
                                              ? ` · mover de ${data.shiftSections.find((section) => section.id === otherSection.shiftSectionId)?.name ?? "outra praça"}`
                                              : ""}
                                          </span>
                                        </Label>
                                      );
                                    })}
                                </fieldset>
                              </details>

                              <Button disabled={busy || !assignmentPrimaryId} type="submit">
                                {busy ? "Salvando…" : "Salvar praça e equipe"}
                              </Button>
                            </section>
                          ) : (
                            <p className="shift-assignment-empty action-form__wide">
                              Crie uma praça reutilizável para distribuir a equipe deste turno.
                            </p>
                          )}
                        </form>
                      )}

                      {shiftSetupStep === "team" && !data.activeShift && (
                        <section className="shift-team-preview">
                          <header>
                            <span>
                              <small>Preparação da equipe</small>
                              <h3>Titulares padrão</h3>
                              <p>
                                Revise quem assume cada praça. A equipe anterior, quando válida,
                                terá prioridade na abertura.
                              </p>
                            </span>
                            <Badge
                              tone={
                                reusableSectionsWithResponsible === data.serviceSections.length
                                  ? "success"
                                  : "warning"
                              }
                            >
                              {reusableSectionsWithResponsible}/{data.serviceSections.length} com
                              titular
                            </Badge>
                          </header>
                          <div className="service-section-list">
                            {serviceSectionSummaries.map(
                              ({ section, tableIds, defaultResponsible }) => (
                                <article key={section.id}>
                                  <i
                                    aria-hidden="true"
                                    className="service-section-list__color"
                                    style={{ backgroundColor: section.color }}
                                  />
                                  <span>
                                    <strong>{section.name}</strong>
                                    <small>
                                      {tableIds.length} {tableIds.length === 1 ? "mesa" : "mesas"}
                                    </small>
                                  </span>
                                  <Badge tone={defaultResponsible ? "success" : "warning"}>
                                    {defaultResponsible?.displayName ?? "Definir no turno"}
                                  </Badge>
                                  <Button
                                    onClick={() => {
                                      editServiceSection(section.id);
                                      setShiftSetupStep("sections");
                                    }}
                                    size="sm"
                                    type="button"
                                    variant="ghost"
                                  >
                                    {defaultResponsible ? "Alterar" : "Definir titular"}
                                  </Button>
                                </article>
                              ),
                            )}
                          </div>
                          <footer>
                            <Button
                              onClick={() => setShiftSetupStep("sections")}
                              type="button"
                              variant="ghost"
                            >
                              Voltar
                            </Button>
                            <Button onClick={() => setShiftSetupStep("open")} type="button">
                              Revisar abertura
                            </Button>
                          </footer>
                        </section>
                      )}

                      {shiftSetupStep === "open" && !data.activeShift && (
                        <form
                          className="action-form shift-open-review"
                          onSubmit={(event) => void openShift(event)}
                        >
                          <header className="action-form__wide">
                            <small>Revisão final</small>
                            <h3>Abrir turno</h3>
                            <p>
                              Confira a cobertura abaixo. O atendimento geral foi definido
                              automaticamente pelas praças.
                            </p>
                          </header>
                          <Label>
                            Identificação opcional
                            <Input
                              maxLength={120}
                              onChange={(event) => setShiftLabel(event.target.value)}
                              placeholder="Ex.: Jantar de sexta"
                              value={shiftLabel}
                            />
                          </Label>
                          <div className="shift-open-review__mode">
                            <small>Atendimento do turno</small>
                            <strong>{serviceModeLabel(effectiveShiftMode)}</strong>
                            <span>
                              {effectiveShiftMode === "hybrid"
                                ? "As praças usam formas diferentes de atendimento."
                                : "Todas as praças usam o mesmo atendimento."}
                            </span>
                          </div>
                          <Label className="action-form__check">
                            <input
                              className="accent-primary"
                              checked={copyPreviousAssignments}
                              onChange={(event) => setCopyPreviousAssignments(event.target.checked)}
                              type="checkbox"
                            />
                            <span>
                              <strong>Reaproveitar a equipe do turno anterior</strong>
                              <small>
                                Na ausência de uma atribuição anterior válida, será usado o titular
                                padrão da praça.
                              </small>
                            </span>
                          </Label>
                          <div className="shift-open-summary action-form__wide">
                            <span>
                              <strong>{data.serviceSections.length}</strong>
                              <small>praças</small>
                            </span>
                            <span data-warning={reusableUnassignedTables > 0 || undefined}>
                              <strong>{activeTables.length - reusableUnassignedTables}</strong>
                              <small>de {activeTables.length} mesas cobertas</small>
                            </span>
                            <span
                              data-warning={
                                reusableSectionsWithResponsible < data.serviceSections.length ||
                                undefined
                              }
                            >
                              <strong>{reusableSectionsWithResponsible}</strong>
                              <small>de {data.serviceSections.length} com titular padrão</small>
                            </span>
                          </div>
                          <ul className="shift-open-checks action-form__wide">
                            {preflight.map((item) => (
                              <li data-ready={item.ready} key={item.id}>
                                <StatusDot
                                  tone={
                                    item.ready ? "success" : item.blocking ? "danger" : "warning"
                                  }
                                />
                                <span>
                                  <strong>{item.label}</strong>
                                  <small>{item.detail}</small>
                                </span>
                              </li>
                            ))}
                          </ul>
                          <footer className="service-section-editor__actions action-form__wide">
                            <Button
                              onClick={() => setShiftSetupStep("team")}
                              type="button"
                              variant="ghost"
                            >
                              Voltar
                            </Button>
                            <Button disabled={busy || preflightBlocked} type="submit">
                              {busy ? "Abrindo…" : "Abrir turno"}
                            </Button>
                          </footer>
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
                  <Label aria-disabled={!data.activeShift}>
                    <input
                      className="accent-primary"
                      checked={effectiveJoinAccountMode === "layout_only"}
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
                  </Label>
                  <Label>
                    <input
                      className="accent-primary"
                      checked={effectiveJoinAccountMode === "physical_only"}
                      onChange={() => setJoinAccountMode("physical_only")}
                      type="radio"
                    />
                    <span>
                      <strong>Agrupar com comandas separadas</strong>
                      <small>
                        Cria um grupo operacional; pedidos e pagamentos continuam em cada mesa.
                      </small>
                    </span>
                  </Label>
                  <Label>
                    <input
                      className="accent-primary"
                      checked={effectiveJoinAccountMode === "single_tab"}
                      disabled={!mergePolicy.allowed}
                      onChange={() => mergePolicy.allowed && setJoinAccountMode("single_tab")}
                      type="radio"
                    />
                    <span>
                      <strong>Usar uma única comanda</strong>
                      <small>
                        {mergePolicy.allowed
                          ? joiningFreeTables
                            ? "As mesas ficam agrupadas agora; a primeira abertura cria a comanda única do grupo."
                            : "Pedidos, pessoas e valores passam para a comanda principal."
                          : "Mesas juntas, comandas separadas. A movimentação financeira impede a unificação."}
                      </small>
                    </span>
                  </Label>
                </fieldset>
                <Label className="compact-field">
                  Mesa principal
                  <NativeSelect
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
                  </NativeSelect>
                </Label>
                <Label className="compact-field">
                  Motivo da junção
                  <NativeSelect
                    onChange={(event) =>
                      setJoinReasonCode(event.target.value as typeof joinReasonCode)
                    }
                    value={joinReasonCode}
                  >
                    <option value="large_party">Grupo ou família grande</option>
                    <option value="sit_together">
                      Clientes já em consumo querem sentar juntos
                    </option>
                    <option value="accessibility">Necessidade de acessibilidade</option>
                    <option value="operational_reorganization">Ajuste operacional do salão</option>
                    <option value="other">Outro</option>
                  </NativeSelect>
                </Label>
                {(joinReasonCode === "other" || joinReasonNote) && (
                  <Label className="compact-field">
                    Detalhe do motivo
                    <Input
                      maxLength={500}
                      minLength={3}
                      onChange={(event) => setJoinReasonNote(event.target.value)}
                      required={joinReasonCode === "other"}
                      value={joinReasonNote}
                    />
                  </Label>
                )}
                {!mergePolicy.allowed && (
                  <p className="field-hint" role="status">
                    {mergePolicy.reason} Mesas juntas, comandas separadas.
                  </p>
                )}
                {effectiveJoinAccountMode !== "layout_only" && (
                  <Label className="compact-field">
                    Coordenador deste atendimento
                    <NativeSelect
                      onChange={(event) => setJoinResponsibleIdentityId(event.target.value)}
                      value={joinResponsibleIdentityId}
                    >
                      {data.staff.map((person) => (
                        <option key={person.identityId} value={person.identityId}>
                          {person.displayName}
                        </option>
                      ))}
                    </NativeSelect>
                  </Label>
                )}
                {effectiveJoinAccountMode !== "layout_only" && (
                  <p className="field-hint">
                    O coordenador assume decisões do grupo nesta visita. As praças originais e seus
                    titulares continuam registradas no turno.
                  </p>
                )}
                {joinTabs.length > 1 && effectiveJoinAccountMode === "single_tab" && (
                  <p className="field-hint">
                    A unificação só é confirmada sem pagamentos parciais. Caso exista pagamento,
                    mantenha comandas separadas ou finalize a conciliação primeiro.
                  </p>
                )}
                {feedback && (
                  <p
                    aria-live="assertive"
                    className="table-group-dialog__feedback"
                    data-tone={feedback.tone}
                    role={feedback.tone === "danger" ? "alert" : "status"}
                  >
                    {feedback.message}
                  </p>
                )}
                <div className="table-group-dialog__actions">
                  <Button onClick={() => setJoinDialogOpen(false)} type="button" variant="ghost">
                    Voltar
                  </Button>
                  <Button
                    disabled={
                      busy || (joinReasonCode === "other" && joinReasonNote.trim().length < 3)
                    }
                    onClick={() => void confirmJoin()}
                    type="button"
                  >
                    {busy
                      ? "Juntando…"
                      : effectiveJoinAccountMode === "layout_only"
                        ? "Aproximar neste turno"
                        : effectiveJoinAccountMode === "single_tab"
                          ? joiningFreeTables
                            ? "Juntar com comanda única"
                            : "Juntar e unificar comandas"
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
                <Label>
                  Praça temporária
                  <NativeSelect
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
                  </NativeSelect>
                </Label>
                <Label>
                  Duração
                  <NativeSelect
                    onChange={(event) => setTransferDurationMinutes(Number(event.target.value))}
                    value={transferDurationMinutes}
                  >
                    <option value={15}>15 minutos</option>
                    <option value={30}>30 minutos</option>
                    <option value={60}>1 hora</option>
                    <option value={120}>2 horas</option>
                    <option value={240}>4 horas</option>
                    <option value={720}>Até 12 horas</option>
                  </NativeSelect>
                </Label>
                <Label>
                  Tipo de remanejamento
                  <NativeSelect
                    onChange={(event) =>
                      setTransferReasonCode(event.target.value as typeof transferReasonCode)
                    }
                    value={transferReasonCode}
                  >
                    <option value="service_rebalance">Equilibrar atendimento</option>
                    <option value="staff_coverage">Cobertura de equipe</option>
                    <option value="operational_reorganization">Reorganização operacional</option>
                    <option value="other">Outro</option>
                  </NativeSelect>
                </Label>
                <Label>
                  Observação do motivo
                  <Input
                    maxLength={500}
                    minLength={3}
                    onChange={(event) => setTransferReason(event.target.value)}
                    value={transferReason}
                  />
                </Label>
                {(tab || selectedGroupTabs.length > 0) && (
                  <Label className="action-form__check">
                    <input
                      className="accent-primary"
                      checked={transferOpenTab}
                      onChange={(event) => setTransferOpenTab(event.target.checked)}
                      type="checkbox"
                    />
                    <span>
                      Passar também {selectedGroup ? "as comandas do grupo" : "a comanda atual"} ao
                      titular da nova praça
                    </span>
                  </Label>
                )}
                <div className="table-group-dialog__actions">
                  <Button onClick={() => setTransferDialogOpen(false)} variant="ghost">
                    Cancelar
                  </Button>
                  <Button
                    disabled={
                      busy || (transferReasonCode === "other" && transferReason.trim().length < 3)
                    }
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
                      <Label key={group.key}>
                        <span>
                          <strong>{currentName}</strong>
                          <small>
                            {group.count} comanda(s) · {formatMoney(group.totalCents)}
                          </small>
                        </span>
                        <NativeSelect
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
                        </NativeSelect>
                      </Label>
                    );
                  })}
                </fieldset>
                <Label>
                  Registro da passagem
                  <Input
                    maxLength={500}
                    minLength={3}
                    onChange={(event) => setHandoverReason(event.target.value)}
                    value={handoverReason}
                  />
                </Label>
                <p className="field-hint">
                  {shiftClosureSummary ? `${shiftClosureSummary}. ` : ""}Pedidos, pagamentos e
                  pendências não serão encerrados. A próxima equipe continua do ponto exato em que o
                  turno terminou.
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
                    Registrar passagem de turno
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

            {feedback && !joinDialogOpen && (
              <Toast
                actionLabel={undoAction?.message}
                message={feedback.message}
                onAction={undoAction ? () => void runUndoAction() : undefined}
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
                      <Button
                        aria-pressed={filterStatus === id}
                        className="gm-pill"
                        key={id}
                        onClick={() => setFilterStatus(id)}
                        type="button"
                      >
                        {label} <small>{count}</small>
                      </Button>
                    ))}
                  </fieldset>
                  <fieldset className="segmented salon-workspace-modes">
                    <legend className="gm-sr-only">Organização do salão</legend>
                    <Button
                      aria-pressed={workspaceMode === "operate"}
                      onClick={() => switchWorkspaceMode("operate")}
                      type="button"
                    >
                      Operar
                    </Button>
                    {canEditSpace && (
                      <Button onClick={openSpaceSetup} type="button">
                        Editar espaço
                      </Button>
                    )}
                    {canReorganizeTurn && data.activeShift && (
                      <Button
                        aria-pressed={workspaceMode === "shift"}
                        onClick={() => switchWorkspaceMode("shift")}
                        type="button"
                      >
                        Organizar turno
                      </Button>
                    )}
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

                {workspaceMode === "shift" && data.activeShift && canManageShift && (
                  <section className="shift-paint-toolbar" aria-label="Pintar praça no turno">
                    <Label>
                      Praça ativa
                      <NativeSelect
                        onChange={(event) => loadAssignmentSection(event.target.value)}
                        value={assignmentSectionId}
                      >
                        <option value="">Selecione</option>
                        {data.shiftSections.map((section) => (
                          <option key={section.id} value={section.id}>
                            {section.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </Label>
                    <fieldset className="segmented">
                      <legend className="gm-sr-only">Ferramenta de organização</legend>
                      <Button
                        aria-pressed={shiftEditorTool === "assign"}
                        onClick={() => setShiftEditorTool("assign")}
                        type="button"
                      >
                        Pintar mesas
                      </Button>
                      <Button
                        aria-pressed={shiftEditorTool === "move"}
                        onClick={() => setShiftEditorTool("move")}
                        type="button"
                      >
                        Mover mesas
                      </Button>
                    </fieldset>
                    <span>
                      <strong>{assignmentTableIds.length}</strong> mesa(s) nesta praça, em qualquer
                      ambiente físico
                    </span>
                    <Button
                      disabled={busy || !assignmentSectionId}
                      onClick={() => void updateShiftAssignment()}
                      size="sm"
                    >
                      {busy ? "Salvando…" : "Salvar praças do turno"}
                    </Button>
                  </section>
                )}

                {workspaceMode === "template" && (
                  <section className="shift-paint-toolbar" aria-label="Selecionar mesas da praça">
                    <span>
                      <small>Modelo reutilizável</small>
                      <strong>{serviceSectionName}</strong>
                    </span>
                    <span>
                      Clique nas mesas para incluir ou remover. A borda usa a cor escolhida.
                    </span>
                    <Badge tone={serviceSectionTableIds.length ? "success" : "warning"}>
                      {serviceSectionTableIds.length} mesa(s)
                    </Badge>
                    <Button
                      onClick={() => {
                        setWorkspaceMode("operate");
                        setSetupSection("shift");
                        setShiftSetupStep("sections");
                        setSetupOpen(true);
                      }}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      Voltar à configuração
                    </Button>
                  </section>
                )}

                {filteredTables.length === 0 ? (
                  <EmptyState
                    icon={<Icon name="salon" size={28} />}
                    title="Nenhuma mesa encontrada"
                    description="Ajuste a busca ou os filtros para voltar ao painel."
                  />
                ) : workspaceMode !== "operate" ? (
                  <FloorPlan
                    canEdit={
                      workspaceMode === "template"
                        ? canEditSpace
                        : workspaceMode === "shift" && canReorganizeTurn
                    }
                    canEditElements={false}
                    editRequestKey={floorEditRequestKey}
                    editActionLabel={
                      workspaceMode === "shift" ? "Organizar turno" : "Selecionar mesas"
                    }
                    editableItemIds={
                      workspaceMode === "shift"
                        ? data.tables.filter(canOperateTable).map((item) => item.id)
                        : selectableServiceSectionTables.map((item) => item.id)
                    }
                    editorTool={
                      workspaceMode === "template"
                        ? "assign"
                        : workspaceMode === "shift" && canManageShift
                          ? shiftEditorTool
                          : "move"
                    }
                    editableZoneIds={[]}
                    editingDescription={
                      workspaceMode === "shift"
                        ? "Arraste mesas entre ambientes; a mudança vale apenas neste turno."
                        : "Clique nas mesas para definir esta praça reutilizável."
                    }
                    elements={floorPlanElements}
                    focusId={floorFocusId}
                    items={floorPlanItems}
                    joinMode={joinMode}
                    layoutScope={
                      workspaceMode === "template" || !data.activeShift ? "permanent" : "shift"
                    }
                    onEditingChange={(editing) => {
                      if (!editing && workspaceMode === "template") {
                        setWorkspaceMode("operate");
                        setSetupSection("shift");
                        setShiftSetupStep("sections");
                        setSetupOpen(true);
                      } else if (!editing) {
                        setWorkspaceMode("operate");
                      }
                    }}
                    onEditSelect={(tableId) => {
                      if (workspaceMode === "template") {
                        if (serviceSectionOtherTableIds.has(tableId)) return;
                        setServiceSectionTableIds((current) =>
                          current.includes(tableId)
                            ? current.filter((id) => id !== tableId)
                            : [...current, tableId],
                        );
                        return;
                      }
                      if (!canManageShift) return;
                      const target = data.tables.find((item) => item.id === tableId);
                      if (!target || !canOperateTable(target)) {
                        setFeedback(
                          "Esta mesa está fora do seu escopo neste turno. O coordenador pode redistribuí-la.",
                          "info",
                        );
                        return;
                      }
                      if (!assignmentSectionId) {
                        setFeedback("Selecione uma praça antes de pintar mesas.", "info");
                        return;
                      }
                      setAssignmentTableIds((current) =>
                        current.includes(tableId)
                          ? current.filter((id) => id !== tableId)
                          : [...current, tableId],
                      );
                    }}
                    onSavePositions={
                      workspaceMode === "template" ? () => saveServiceSection() : saveShiftLayout
                    }
                    saveActionLabel={
                      workspaceMode === "shift" ? "Aplicar no turno" : "Salvar praça"
                    }
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
                      workspaceMode === "template"
                        ? serviceSectionTableIds
                        : joinMode
                          ? joinSelection
                          : selectedTableId
                            ? [selectedTableId]
                            : []
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
                            : item.openedAt
                              ? elapsedLabel(item.openedAt)
                              : "—";
                        const isSelected = joinMode
                          ? joinSelection.includes(item.id)
                          : selectedTableId === item.id;

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
                              <span>
                                {assignment?.primary?.displayName ??
                                  item.responsibleDisplayName ??
                                  "Equipe"}
                              </span>
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
                              <strong>
                                {canSeeTableFinancials(item)
                                  ? totalCents > 0
                                    ? formatMoney(totalCents)
                                    : "—"
                                  : "Protegido"}
                              </strong>
                              {canSeeTableFinancials(item) && groupTabs.length > 1 && (
                                <small>{groupTabs.length} comandas</small>
                              )}
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
                                {!canOperateTable(item)
                                  ? "Ver panorama"
                                  : status === "available"
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
                      const assignment = operationalAssignmentForTable(item.id);
                      const serviceCall = serviceCallForTable(item.id);
                      const servicePhase = servicePhaseForTable(item.id);
                      const operationalSince =
                        serviceCall?.createdAt ?? servicePhase?.since ?? item.openedAt;
                      const totalCents = groupTabs.reduce(
                        (sum, groupTab) => sum + groupTab.totalCents,
                        0,
                      );
                      const isSelected = joinMode
                        ? joinSelection.includes(item.id)
                        : selectedTableId === item.id;

                      return (
                        <Button
                          aria-pressed={isSelected}
                          className={`real-table real-table--${presentation.className} ${joinMode && isSelected ? "table-tile--joining" : ""} ${isSelected ? "selected" : ""}`}
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
                            <span
                              className="real-table__room"
                              title={`${room ?? "Salão"} · ${assignment?.section.name ?? "Sem praça"}`}
                            >
                              {room ?? "Salão"} <span aria-hidden="true">·</span>{" "}
                              {assignment?.section.name ?? "Sem praça"}
                            </span>
                            {operationalSince && (
                              <span className="real-table__time" title="Tempo neste atendimento">
                                <Icon name="clock" size={11} />
                                <small>{elapsedLabel(operationalSince)}</small>
                              </span>
                            )}
                          </div>

                          <div className="real-table__footer">
                            <div className="real-table__status">
                              <StatusDot pulse={presentation.pulse} tone={presentation.tone} />
                              <small>{presentation.label}</small>
                              {serviceCall &&
                                callKindLabel[serviceCall.kind] !== presentation.label && (
                                  <span className="real-table__call-badge">
                                    {callKindLabel[serviceCall.kind]}
                                  </span>
                                )}
                            </div>
                            <div className="real-table__value">
                              {groupTabs.length && canSeeTableFinancials(item) ? (
                                <>
                                  <strong>{formatMoney(totalCents)}</strong>
                                  {itemGroup?.mode === "physical_only" && groupTabs.length > 1 && (
                                    <small> · {groupTabs.length} contas</small>
                                  )}
                                </>
                              ) : groupTabs.length ? (
                                <span>Panorama protegido</span>
                              ) : status === "available" ? (
                                <span>Abrir</span>
                              ) : (
                                <span>{canOperateTable(item) ? "Atender" : "Ver panorama"}</span>
                              )}
                            </div>
                          </div>
                        </Button>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>

            <Modal
              className={`salon-service-modal${table && !tab ? " salon-service-modal--compact max-sm:items-stretch max-sm:p-0" : ""}`}
              contentClassName={
                table && !tab
                  ? "h-fit max-h-[min(92dvh,680px)] w-[calc(100vw-2rem)] max-w-[680px] max-sm:h-dvh max-sm:max-h-none max-sm:w-screen max-sm:max-w-none max-sm:rounded-none"
                  : undefined
              }
              description={
                table && tab ? (
                  <div className="salon-service-modal__summary">
                    <span>
                      {floorPlanItems.find((item) => item.id === table.id)?.areaLabel ??
                        "Sem ambiente"}
                      <span aria-hidden="true"> · </span>
                      {serviceModeLabel(selectedServiceMode)}
                    </span>
                    <div className="salon-service-modal__context">
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
                      {selectedCanSeeFinancials && (
                        <strong>Total: {formatMoney(tab.totalCents)}</strong>
                      )}
                    </div>
                  </div>
                ) : undefined
              }
              isOpen={Boolean(table)}
              onClose={() => setSelectedTableId(null)}
              size={tab ? "xl" : "lg"}
              title={table?.label ?? "Atendimento da mesa"}
            >
              <div className="table-drawer salon-workspace salon-workspace--modal">
                {table && (
                  <>
                    <section className="salon-next-action" aria-label="Próxima ação da mesa">
                      <span>
                        <small>Próxima ação</small>
                        <strong>{selectedNextAction}</strong>
                      </span>
                      <small>
                        {selectedPhase
                          ? `${servicePhasePresentation[selectedPhase.phase]} · ${elapsedLabel(selectedPhase.since)}`
                          : selectedCall
                            ? `${callKindLabel[selectedCall.kind]} · ${elapsedLabel(selectedCall.createdAt)}`
                            : "O sistema destaca somente a etapa operacional atual."}
                      </small>
                      {selectedCanOperate &&
                        ["owner", "manager", "waiter"].includes(scope.profileId) &&
                        selectedReadyOrderIds.length > 0 && (
                          <Button
                            aria-busy={busy}
                            disabled={busy}
                            onClick={() => void serveReadyOrders(selectedReadyOrderIds)}
                            size="sm"
                          >
                            {busy ? "Confirmando…" : "Marcar como servido"}
                          </Button>
                        )}
                    </section>
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
                      {selectedCanOperate && (
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
                            <Button
                              onClick={() => setMoveTableOpen(true)}
                              size="sm"
                              variant="ghost"
                            >
                              <Icon name="salon" size={14} />
                              <span>Mudar Mesa</span>
                            </Button>
                          )}
                          {canReorganizeTurn && (
                            <details className="table-more-actions" data-salon-floating-menu>
                              <summary>Mais ações</summary>
                              <div>
                                {data.activeShift && (
                                  <Button
                                    onClick={() => {
                                      setSelectedTableId(null);
                                      setWorkspaceMode("shift");
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
                                    setView("map");
                                    setWorkspaceMode("operate");
                                    setJoinMode(true);
                                    setJoinSelection([selectedGroup?.anchorTableId ?? table.id]);
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
                      )}
                    </div>
                    {selectedCanOperate &&
                      scope.profileId === "waiter" &&
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
                    {selectedCanOperate && selectedTransfer && canReorganizeTurn && (
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
                    {selectedTimeline.length > 0 && (
                      <details className="salon-table-timeline">
                        <summary>Linha do tempo da mesa</summary>
                        <ol>
                          {selectedTimeline.map((item) => (
                            <li key={item.id}>
                              <time dateTime={item.at}>
                                {new Date(item.at).toLocaleTimeString("pt-BR", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </time>
                              <span>
                                <strong>{item.label}</strong>
                                {item.detail && <small>{item.detail}</small>}
                              </span>
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}
                    {selectedCanOperate && selectedGroup && (
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
                              <NativeSelect
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
                              </NativeSelect>
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

                    {selectedCanOperate &&
                      selectedCanSeeFinancials &&
                      selectedGroup?.mode === "physical_only" &&
                      selectedGroupTabs.length > 1 && (
                        <fieldset className="group-account-tabs">
                          <legend>Comandas do grupo</legend>
                          {selectedGroupTabs.map((groupTab) => {
                            const accountTable = data.tables.find(
                              (candidate) => candidate.id === groupTab.tableId,
                            );
                            return (
                              <Button
                                aria-pressed={tab?.id === groupTab.id}
                                key={groupTab.id}
                                onClick={() => setSelectedTabId(groupTab.id)}
                                type="button"
                              >
                                <span>{accountTable?.label ?? groupTab.label ?? "Comanda"}</span>
                                <strong>{formatMoney(groupTab.totalCents)}</strong>
                              </Button>
                            );
                          })}
                        </fieldset>
                      )}

                    {!selectedCanOperate ? (
                      <Card className="table-start table-start--protected">
                        <div>
                          <p className="eyebrow">Panorama protegido</p>
                          <h2>Atendimento de outra praça</h2>
                          <span>
                            {table.responsibleDisplayName
                              ? `Responsável: ${table.responsibleDisplayName}. `
                              : "Responsável preservado. "}
                            {table.openedAt
                              ? `Em atendimento desde ${new Date(table.openedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`
                              : "Os dados pessoais, a comanda e os valores não estão no seu escopo."}
                          </span>
                        </div>
                      </Card>
                    ) : tab && canOpenTableWorkspace(accessForTable(table), tab.id) ? (
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
                      <section className="gm-card table-start table-start--opening">
                        <div className="table-start__copy">
                          <p className="eyebrow">
                            {table.status === "reserved" ? "Mesa reservada" : "Mesa disponível"}
                          </p>
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
                        <div className="table-start__controls">
                          {!selectedUsesQuickFlow && (
                            <fieldset className="table-start__guests">
                              <legend>Pessoas</legend>
                              <div className="table-start__guest-stepper">
                                <Button
                                  aria-label="Diminuir quantidade de pessoas"
                                  className="h-10 min-h-10 w-9 rounded-none px-0 text-base"
                                  disabled={busy || guests <= 1}
                                  onClick={() =>
                                    setGuests((current) =>
                                      Math.max(1, Number.isFinite(current) ? current - 1 : 1),
                                    )
                                  }
                                  size="sm"
                                  type="button"
                                  variant="ghost"
                                >
                                  −
                                </Button>
                                <Input
                                  aria-label="Pessoas"
                                  className="h-10 w-12 rounded-none border-0 border-x px-1 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                  min={1}
                                  max={500}
                                  onBlur={() => guests < 1 && setGuests(1)}
                                  onChange={(event) => {
                                    const next = event.currentTarget.valueAsNumber;
                                    setGuests(
                                      Number.isFinite(next) ? Math.min(500, Math.max(0, next)) : 0,
                                    );
                                  }}
                                  type="number"
                                  value={guests}
                                />
                                <Button
                                  aria-label="Aumentar quantidade de pessoas"
                                  className="h-10 min-h-10 w-9 rounded-none px-0 text-base"
                                  disabled={busy || guests >= 500}
                                  onClick={() =>
                                    setGuests((current) =>
                                      Math.min(500, Number.isFinite(current) ? current + 1 : 1),
                                    )
                                  }
                                  size="sm"
                                  type="button"
                                  variant="ghost"
                                >
                                  +
                                </Button>
                              </div>
                            </fieldset>
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
                        </div>
                      </section>
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
                    <span>Alternar visão (Painel ↔ Lista)</span>
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
