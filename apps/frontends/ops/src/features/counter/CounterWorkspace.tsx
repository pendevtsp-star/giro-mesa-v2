import {
  Badge,
  Button,
  Callout,
  Card,
  Input,
  Label,
  Modal,
  NativeSelect,
  Textarea,
  Toast,
} from "@giromesa/ui";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  ApiClientError,
  api,
  type DoseClubEligibleMembership,
  type PosPrintJob,
  type PrintDocumentType,
  type PrintJobStatus,
} from "../../api";
import { sendShellPrintJob, shellPrintingAvailable } from "../../bridge";
import { pilotMutation } from "../../operational-dispatch";
import {
  type PilotFloor,
  type PilotScope,
  parsePilotCatalog,
  parseTab,
  parseTabDetail,
  parseTabs,
  RemoteGate,
  record,
  serviceModeLabel,
  statusTone,
  summarizeTabPayments,
  useRemote,
} from "../../operations.shared";
import { formatMoney } from "../../rules";
import { QuickOrderChips } from "../salon/QuickOrderChips";
import { currentTerminalPrinterId, readActiveTerminalProfile } from "../shell/terminal-profile";
import { BrowserReceipt } from "./BrowserReceipt";
import type { PaymentAttempt } from "./pos-payments";
import { promisedAtToIso, splitPromisedAt } from "./promisedAt";
import { SmartPosPaymentModal } from "./SmartPosPaymentModal";
import "./counter.css";

type DoseClubDraftSnapshot = {
  externalOfferId: string;
  offerName: string;
  offerType: "individual" | "combo_pool";
  externalProductId: string;
  availableDoses: number;
  doseMl: number;
};

export type DraftCartItem = {
  id: string;
  productId: string;
  name: string;
  quantity: number;
  modifierOptionIds: string[];
  notes?: string;
  seatNumber?: number;
  course?: "anytime" | "starter" | "main" | "dessert";
  allergyNote?: string;
  doseClub?: { externalClubId: string };
  doseClubSnapshot?: DoseClubDraftSnapshot;
};

type DoseClubLoadState =
  | { status: "idle" | "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; memberships: DoseClubEligibleMembership[] };

type PrintJob = {
  id: string;
  serverId?: string;
  server?: PosPrintJob;
  mode: PrintMode;
  label: string;
  status: PrintJobStatus | "preparing" | "fallback";
  lastError?: string;
};

export type WorkspaceView = "order" | "account" | "table" | "activity";
type PrintMode = "account" | "payments" | "final";
type CloseTabBody = Parameters<typeof api.pilot.closeTab>[3];

const printDocuments: Record<PrintMode, { documentType: PrintDocumentType; label: string }> = {
  account: { documentType: "partial_statement", label: "Extrato parcial" },
  payments: { documentType: "payment_statement", label: "Extrato de pagamentos" },
  final: { documentType: "final_receipt", label: "Comprovante final" },
};

function printModeFor(documentType: PrintDocumentType): PrintMode {
  return documentType === "payment_statement"
    ? "payments"
    : documentType === "final_receipt"
      ? "final"
      : "account";
}

function printJobFromServer(job: PosPrintJob): PrintJob {
  const mode = printModeFor(job.documentType);
  return {
    id: job.id,
    serverId: job.id,
    server: job,
    mode,
    label: printDocuments[mode].label,
    status: job.status,
    lastError: job.lastError ?? undefined,
  };
}

function printStatusLabel(job: PrintJob) {
  if (job.status === "preparing") return "Preparando documento";
  if (job.status === "queued") return "Aguardando este terminal";
  if (job.status === "printing") return "Envio iniciado; confirme antes de repetir";
  if (job.status === "confirmation_required") return "Saída enviada; confirme o papel";
  if (job.status === "printed") return "Entregue à impressora";
  if (job.status === "fallback") return "Diálogo do sistema, sem confirmação";
  return job.lastError ? `Falhou: ${job.lastError}` : "Falhou";
}

function printActionLabel(status: PrintJob["status"]) {
  if (status === "queued") return "Imprimir agora";
  if (status === "printing") return "Marcar não impresso";
  if (status === "confirmation_required") return "Confirmar saída física";
  if (status === "failed") return "Tentar novamente";
  return "Reimprimir";
}

const adjustmentReasons = [
  "Erro de lançamento",
  "Item devolvido",
  "Cortesia autorizada",
  "Atraso no atendimento",
  "Problema de qualidade",
  "Cliente desistiu",
  "Consumo interno",
] as const;

const courseLabels: Record<NonNullable<DraftCartItem["course"]>, string> = {
  anytime: "Assim que pronto",
  starter: "Entrada",
  main: "Principal",
  dessert: "Sobremesa",
};

export function groupDraftItemsByCourse(items: DraftCartItem[]): DraftCartItem[][] {
  const groups = new Map<NonNullable<DraftCartItem["course"]>, DraftCartItem[]>();
  for (const item of items) {
    const course = item.course ?? "anytime";
    groups.set(course, [...(groups.get(course) ?? []), item]);
  }
  return [...groups.values()];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function doseClubText(value: unknown, maximum = 300): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new Error("O Dose Club retornou dados em formato inesperado.");
  }
  return value.trim();
}

function doseClubCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error("O Dose Club retornou dados em formato inesperado.");
  }
  return Number(value);
}

export function parseDoseClubMemberships(value: unknown): DoseClubEligibleMembership[] {
  if (!isPlainRecord(value) || !Array.isArray(value.memberships)) {
    throw new Error("O Dose Club retornou dados em formato inesperado.");
  }
  return value.memberships.map((candidate) => {
    if (
      !isPlainRecord(candidate) ||
      candidate.status !== "active" ||
      !isPlainRecord(candidate.offer)
    ) {
      throw new Error("O Dose Club retornou dados em formato inesperado.");
    }
    const offerType = candidate.offer.type;
    if (offerType !== "individual" && offerType !== "combo_pool") {
      throw new Error("O Dose Club retornou dados em formato inesperado.");
    }
    if (!Array.isArray(candidate.eligibleProducts)) {
      throw new Error("O Dose Club retornou dados em formato inesperado.");
    }
    const doseMl = candidate.doseMl;
    if (typeof doseMl !== "number" || !Number.isFinite(doseMl) || doseMl <= 0) {
      throw new Error("O Dose Club retornou dados em formato inesperado.");
    }
    return {
      externalClubId: doseClubText(candidate.externalClubId, 200),
      status: "active" as const,
      offer: {
        externalOfferId: doseClubText(candidate.offer.externalOfferId, 200),
        name: doseClubText(candidate.offer.name),
        type: offerType,
      },
      remainingDoses: doseClubCount(candidate.remainingDoses),
      reservedDoses: doseClubCount(candidate.reservedDoses),
      availableDoses: doseClubCount(candidate.availableDoses),
      doseMl,
      eligibleProducts: candidate.eligibleProducts.map((eligibleProduct) => {
        if (
          !isPlainRecord(eligibleProduct) ||
          (eligibleProduct.brand !== null && typeof eligibleProduct.brand !== "string")
        ) {
          throw new Error("O Dose Club retornou dados em formato inesperado.");
        }
        return {
          externalProductId: doseClubText(eligibleProduct.externalProductId, 200),
          name: doseClubText(eligibleProduct.name),
          brand:
            eligibleProduct.brand === null || !eligibleProduct.brand.trim()
              ? null
              : doseClubText(eligibleProduct.brand),
        };
      }),
    };
  });
}

export function doseClubDraftQuantity(items: DraftCartItem[], externalClubId: string): number {
  return items.reduce(
    (total, item) =>
      item.doseClub?.externalClubId === externalClubId ? total + item.quantity : total,
    0,
  );
}

export function incrementDraftItem(items: DraftCartItem[], itemId: string): DraftCartItem[] {
  const target = items.find((item) => item.id === itemId);
  if (!target) return items;
  if (
    target.doseClub &&
    target.doseClubSnapshot &&
    doseClubDraftQuantity(items, target.doseClub.externalClubId) >=
      target.doseClubSnapshot.availableDoses
  ) {
    return items;
  }
  return items.map((item) =>
    item.id === itemId ? { ...item, quantity: item.quantity + 1 } : item,
  );
}

export function draftItemsToOrderItems(items: DraftCartItem[]) {
  return items.map((item) => ({
    productId: item.productId,
    quantity: item.quantity,
    modifierOptionIds: item.modifierOptionIds,
    ...(item.notes !== undefined ? { notes: item.notes } : {}),
    ...(item.seatNumber !== undefined ? { seatNumber: item.seatNumber } : {}),
    ...(item.course !== undefined ? { course: item.course } : {}),
    ...(item.allergyNote !== undefined ? { allergyNote: item.allergyNote } : {}),
    ...(item.doseClub ? { doseClub: { externalClubId: item.doseClub.externalClubId } } : {}),
  }));
}

export function parseStoredCart(value: string | null): DraftCartItem[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const restored = parsed.slice(0, 100).flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const item = candidate as Record<string, unknown>;
      const course = item.course ?? "anytime";
      if (
        typeof item.id !== "string" ||
        typeof item.productId !== "string" ||
        typeof item.name !== "string" ||
        !Number.isInteger(item.quantity) ||
        Number(item.quantity) < 1 ||
        Number(item.quantity) > 500 ||
        !Array.isArray(item.modifierOptionIds) ||
        !item.modifierOptionIds.every((option) => typeof option === "string") ||
        !["anytime", "starter", "main", "dessert"].includes(String(course))
      ) {
        return [];
      }
      const hasDoseClub = item.doseClub !== undefined || item.doseClubSnapshot !== undefined;
      let doseClubFields: Pick<DraftCartItem, "doseClub" | "doseClubSnapshot"> = {};
      if (hasDoseClub) {
        if (!isPlainRecord(item.doseClub) || !isPlainRecord(item.doseClubSnapshot)) return [];
        const snapshot = item.doseClubSnapshot;
        if (
          typeof item.doseClub.externalClubId !== "string" ||
          !item.doseClub.externalClubId.trim() ||
          item.doseClub.externalClubId.length > 200 ||
          typeof snapshot.externalOfferId !== "string" ||
          !snapshot.externalOfferId.trim() ||
          typeof snapshot.offerName !== "string" ||
          !snapshot.offerName.trim() ||
          !["individual", "combo_pool"].includes(String(snapshot.offerType)) ||
          snapshot.externalProductId !== item.productId ||
          !Number.isSafeInteger(snapshot.availableDoses) ||
          Number(snapshot.availableDoses) < Number(item.quantity) ||
          typeof snapshot.doseMl !== "number" ||
          !Number.isFinite(snapshot.doseMl) ||
          snapshot.doseMl <= 0
        ) {
          return [];
        }
        doseClubFields = {
          doseClub: { externalClubId: item.doseClub.externalClubId.trim() },
          doseClubSnapshot: {
            externalOfferId: snapshot.externalOfferId.trim(),
            offerName: snapshot.offerName.trim(),
            offerType: snapshot.offerType as DoseClubDraftSnapshot["offerType"],
            externalProductId: snapshot.externalProductId,
            availableDoses: Number(snapshot.availableDoses),
            doseMl: snapshot.doseMl,
          },
        };
      }
      return [
        {
          id: item.id,
          productId: item.productId,
          name: item.name,
          quantity: Number(item.quantity),
          modifierOptionIds: item.modifierOptionIds as string[],
          ...(typeof item.notes === "string" ? { notes: item.notes } : {}),
          ...(Number.isInteger(item.seatNumber) && Number(item.seatNumber) > 0
            ? { seatNumber: Number(item.seatNumber) }
            : {}),
          course: course as DraftCartItem["course"],
          ...(typeof item.allergyNote === "string" ? { allergyNote: item.allergyNote } : {}),
          ...doseClubFields,
        },
      ];
    });
    const doseUsage = new Map<string, number>();
    return restored.filter((item) => {
      if (!item.doseClub || !item.doseClubSnapshot) return true;
      const current = doseUsage.get(item.doseClub.externalClubId) ?? 0;
      const next = current + item.quantity;
      if (next > item.doseClubSnapshot.availableDoses) return false;
      doseUsage.set(item.doseClub.externalClubId, next);
      return true;
    });
  } catch {
    return [];
  }
}

export function parseStoredIds(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((item): item is string => typeof item === "string"))].slice(0, 24)
      : [];
  } catch {
    return [];
  }
}

const activityLabels: Record<string, string> = {
  "approval.approved": "Ajuste autorizado",
  "approval.rejected": "Ajuste recusado",
  "approval.requested": "Ajuste solicitado",
  "call.acknowledged": "Chamado assumido",
  "call.opened": "Chamado aberto",
  "call.resolved": "Chamado concluído",
  "customer.ready": "Cliente avisado: pedido pronto",
  "item.canceled": "Item cancelado",
  "item.discounted": "Desconto aplicado",
  "items.moved": "Itens transferidos",
  "items.received": "Itens recebidos",
  "order.created": "Pedido criado",
  "order.sent": "Pedido enviado à produção",
  "order.status_changed": "Produção atualizou o pedido",
  "payment.recorded": "Pagamento registrado",
  "tab.closed": "Atendimento encerrado",
  "tab.handed_over": "Atendimento repassado",
  "tab.opened": "Atendimento iniciado",
  "tab.reopened": "Atendimento reaberto",
  "tab.responsibility_transferred": "Responsável alterado",
  "tab.service_charge_changed": "Taxa de serviço alterada",
  "tab.tip_changed": "Gorjeta alterada",
  "table-group.member_detached": "Mesa separada do grupo",
  "tabs.merged": "Comandas unificadas",
};

export function TabWorkspace({
  scope,
  tabId,
  floor,
  initialView = "order",
  compactHeading = false,
  onChanged,
}: {
  scope: PilotScope;
  tabId: string;
  floor?: PilotFloor;
  initialView?: WorkspaceView;
  compactHeading?: boolean;
  onChanged: () => void;
}) {
  const detail = useRemote(
    scope,
    () => scope.load("tab", tabId, () => api.pilot.tab(scope.organizationId, scope.unitId, tabId)),
    parseTabDetail,
  );
  const catalog = useRemote(
    scope,
    () =>
      scope.load("catalog", undefined, () => api.pilot.catalog(scope.organizationId, scope.unitId)),
    parsePilotCatalog,
  );
  const tabs = useRemote(
    scope,
    () => scope.load("tabs", undefined, () => api.pilot.tabs(scope.organizationId, scope.unitId)),
    parseTabs,
  );
  const [productId, setProductId] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [categoryId, setCategoryId] = useState("all");
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [seatNumber, setSeatNumber] = useState(0);
  const [course, setCourse] = useState<DraftCartItem["course"]>("anytime");
  const [allergyNote, setAllergyNote] = useState("");
  const [options, setOptions] = useState<string[]>([]);
  const cartStorageKey = `gm:attendance:draft:${scope.unitId}:${tabId}`;
  const favoriteStorageKey = `gm:attendance:favorites:${scope.unitId}:${scope.identityId}`;
  const recentStorageKey = `gm:attendance:recent:${scope.unitId}:${scope.identityId}`;
  const lastOrderStorageKey = `gm:attendance:last-order:${scope.unitId}:${scope.identityId}`;
  const [cart, setCart] = useState<DraftCartItem[]>(() =>
    typeof window === "undefined"
      ? []
      : parseStoredCart(window.localStorage.getItem(cartStorageKey)),
  );
  const [favoriteProductIds, setFavoriteProductIds] = useState<string[]>(() =>
    typeof window === "undefined"
      ? []
      : parseStoredIds(window.localStorage.getItem(favoriteStorageKey)),
  );
  const [recentProductIds, setRecentProductIds] = useState<string[]>(() =>
    typeof window === "undefined"
      ? []
      : parseStoredIds(window.localStorage.getItem(recentStorageKey)),
  );
  const [lastOrder, setLastOrder] = useState<DraftCartItem[]>(() =>
    typeof window === "undefined"
      ? []
      : parseStoredCart(window.localStorage.getItem(lastOrderStorageKey)),
  );
  const [lastRemovedItem, setLastRemovedItem] = useState<DraftCartItem | null>(null);
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [printJobs, setPrintJobs] = useState<PrintJob[]>([]);
  const [browserPrintJob, setBrowserPrintJob] = useState<PosPrintJob | null>(null);
  const [reprintReasons, setReprintReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [billRequestPending, setBillRequestPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [view, setView] = useState<WorkspaceView>(initialView);
  const [draftExpanded, setDraftExpanded] = useState(false);
  const [itemActionId, setItemActionId] = useState("");
  const [transferTableId, setTransferTableId] = useState("");
  const [mergeTabId, setMergeTabId] = useState("");
  const [mergeReasonCode, setMergeReasonCode] = useState<
    "large_party" | "sit_together" | "accessibility" | "operational_reorganization" | "other"
  >("sit_together");
  const [mergeReasonNote, setMergeReasonNote] = useState("");
  const [splitItemId, setSplitItemId] = useState("");
  const [splitQuantity, setSplitQuantity] = useState(1);
  const [splitLabel, setSplitLabel] = useState("Conta separada");
  const [printSplitMethod, setPrintSplitMethod] = useState<"equal_people" | "fixed_amount">(
    "equal_people",
  );
  const [printSplitPartCount, setPrintSplitPartCount] = useState(2);
  const [printSplitFixedReais, setPrintSplitFixedReais] = useState(0);
  const [servicePercent, setServicePercent] = useState(10);
  const [tipReais, setTipReais] = useState(0);
  const [approvalItemId, setApprovalItemId] = useState("");
  const [approvalPin, setApprovalPin] = useState("");
  const [approvalReason, setApprovalReason] = useState("");
  const [discountReais, setDiscountReais] = useState(0);
  const [moveTargetTabId, setMoveTargetTabId] = useState("");
  const [moveItemId, setMoveItemId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "other">("cash");
  const [paymentReais, setPaymentReais] = useState(0);
  const [cashReceivedReais, setCashReceivedReais] = useState(0);
  const [paymentReference, setPaymentReference] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [readyNotificationConsent, setReadyNotificationConsent] = useState(false);
  const [serviceNotes, setServiceNotes] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [fulfillmentType, setFulfillmentType] = useState<"dine_in" | "pickup" | "delivery">(
    "dine_in",
  );
  const [promisedDate, setPromisedDate] = useState("");
  const [promisedTime, setPromisedTime] = useState("");
  const [responsibleIdentityId, setResponsibleIdentityId] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [reopenPin, setReopenPin] = useState("");
  const [smartPosOpen, setSmartPosOpen] = useState(false);
  const [integratedAttempt, setIntegratedAttempt] = useState<PaymentAttempt | null>(null);
  const [doseClubOpen, setDoseClubOpen] = useState(false);
  const [doseClubState, setDoseClubState] = useState<DoseClubLoadState>({ status: "idle" });
  const [doseClubRetryKey, setDoseClubRetryKey] = useState(0);
  const [doseClubNotice, setDoseClubNotice] = useState("");
  const [undoResponsibility, setUndoResponsibility] = useState<{
    identityId: string | null;
    version: number;
  } | null>(null);
  const metadataVersionRef = useRef(0);
  const productSearchRef = useRef<HTMLInputElement>(null);
  const paymentAmountRef = useRef<HTMLInputElement>(null);
  const terminalProfile = readActiveTerminalProfile(scope.unitId);
  const terminalPaymentMode =
    terminalProfile?.paymentMode ??
    (terminalProfile?.mode === "waiter_mobile" ? "disabled" : "cashier");
  const localPrintingEnabled = terminalPaymentMode !== "disabled";
  const cashierPaymentEnabled = terminalPaymentMode === "cashier";
  const integratedPaymentEnabled = terminalPaymentMode === "homologated_pos";

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new tab must reset navigation even when the requested view is unchanged.
  useEffect(() => setView(initialView), [initialView, tabId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: trocar a comanda deve fechar e limpar a consulta, mesmo sem ler o identificador no corpo.
  useEffect(() => {
    setDoseClubOpen(false);
    setDoseClubState({ status: "idle" });
    setDoseClubNotice("");
  }, [tabId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: o nonce de retry existe somente para repetir esta consulta remota.
  useEffect(() => {
    if (!doseClubOpen) return;
    let cancelled = false;
    setDoseClubState({ status: "loading" });
    setDoseClubNotice("");
    api.integrations
      .doseClubMemberships(scope.organizationId, scope.unitId, tabId)
      .then((response) => {
        if (!cancelled) {
          setDoseClubState({
            status: "ready",
            memberships: parseDoseClubMemberships(response),
          });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDoseClubState({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "Não foi possível consultar os clubes deste cliente.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [doseClubOpen, doseClubRetryKey, scope.organizationId, scope.unitId, tabId]);

  useEffect(() => {
    let cancelled = false;
    api.pilot
      .printJobs(scope.organizationId, scope.unitId, { tabId, limit: 4 })
      .then((jobs) => {
        if (!cancelled) setPrintJobs(jobs.map(printJobFromServer));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [scope.organizationId, scope.unitId, tabId]);

  function updateLocalPrint(id: string, patch: Partial<PrintJob>) {
    setPrintJobs((current) => current.map((job) => (job.id === id ? { ...job, ...patch } : job)));
  }

  async function deliverThermalJob(printJob: PosPrintJob, localId: string) {
    const printing = await api.pilot.updatePrintJobStatus(
      scope.organizationId,
      scope.unitId,
      printJob.id,
      { status: "printing" },
      crypto.randomUUID(),
    );
    updateLocalPrint(localId, {
      serverId: printJob.id,
      server: printing.printJob,
      status: "printing",
    });
    const result = await sendShellPrintJob(
      printing.printJob,
      `${printing.printJob.id}:${printing.printJob.attempts}`,
    );
    const confirmationRequired =
      result?.success === true ||
      result?.status === "confirmation_required" ||
      result?.errorCode === "PRINTER_RESULT_UNKNOWN";
    if (!confirmationRequired) {
      const error = result?.errorCode ?? "HUB_PRINT_UNAVAILABLE";
      try {
        const failed = await api.pilot.updatePrintJobStatus(
          scope.organizationId,
          scope.unitId,
          printJob.id,
          { status: "failed", error, printerId: result?.printerId },
          crypto.randomUUID(),
        );
        updateLocalPrint(localId, {
          server: failed.printJob,
          status: "failed",
          lastError: error,
        });
      } catch {
        updateLocalPrint(localId, { status: "failed", lastError: error });
      }
      setFeedback(`A impressora não recebeu o documento (${error}).`);
      return false;
    }
    try {
      const pendingConfirmation = await api.pilot.updatePrintJobStatus(
        scope.organizationId,
        scope.unitId,
        printJob.id,
        {
          status: "confirmation_required",
          error: "PRINTER_RESULT_UNKNOWN",
          printerId: result?.printerId,
        },
        crypto.randomUUID(),
      );
      updateLocalPrint(localId, {
        server: pendingConfirmation.printJob,
        status: "confirmation_required",
      });
      setFeedback(
        `${printDocuments[printModeFor(printJob.documentType)].label} enviada${result?.printerId ? ` para ${result.printerId}` : ""}. Confirme a saída física antes de repetir.`,
      );
    } catch {
      updateLocalPrint(localId, { status: "confirmation_required" });
      setFeedback("A saída pode ter ocorrido; confirme o papel antes de tentar novamente.");
    }
    return true;
  }

  async function deliverBrowserJob(printJob: PosPrintJob, localId: string) {
    flushSync(() => setBrowserPrintJob(printJob));
    window.print();
    try {
      const pendingConfirmation = await api.pilot.updatePrintJobStatus(
        scope.organizationId,
        scope.unitId,
        printJob.id,
        { status: "confirmation_required", error: "PRINTER_RESULT_UNKNOWN" },
        crypto.randomUUID(),
      );
      updateLocalPrint(localId, {
        serverId: printJob.id,
        server: pendingConfirmation.printJob,
        status: "confirmation_required",
      });
      setFeedback(
        "Diálogo do sistema aberto com o documento oficial. Confirme a saída física na fila antes de repetir.",
      );
    } catch {
      updateLocalPrint(localId, {
        serverId: printJob.id,
        server: printJob,
        status: "confirmation_required",
      });
      setFeedback("A saída pode ter ocorrido; confirme o papel antes de tentar novamente.");
    }
  }

  async function printDocument(mode: PrintMode) {
    if (!localPrintingEnabled) {
      setFeedback("Este terminal encaminha pedidos de conta ao caixa e não imprime localmente.");
      return;
    }
    const id = crypto.randomUUID();
    setPrintJobs((current) =>
      [
        { id, mode, label: printDocuments[mode].label, status: "preparing" as const },
        ...current,
      ].slice(0, 4),
    );
    try {
      const created = await api.pilot.createPrintJob(
        scope.organizationId,
        scope.unitId,
        tabId,
        {
          documentType: printDocuments[mode].documentType,
          copies: 1,
          printerId: currentTerminalPrinterId(scope.unitId),
        },
        id,
      );
      updateLocalPrint(id, { serverId: created.printJob.id, server: created.printJob });
      if (!shellPrintingAvailable()) {
        await deliverBrowserJob(created.printJob, id);
        return;
      }
      await deliverThermalJob(created.printJob, id);
    } catch (error) {
      updateLocalPrint(id, {
        status: "failed",
        lastError: error instanceof Error ? error.message : "PRINT_QUEUE_UNAVAILABLE",
      });
      setFeedback(error instanceof Error ? error.message : "A fila térmica está indisponível.");
    }
  }

  async function reprintDocument(job: PrintJob) {
    const reason = reprintReasons[job.id]?.trim() ?? "";
    if ((job.status === "printed" || job.status === "fallback") && reason.length < 3) {
      setFeedback("Informe o motivo da reimpressão com pelo menos 3 caracteres.");
      return;
    }
    if (!job.serverId) {
      await printDocument(job.mode);
      return;
    }
    if (job.status === "confirmation_required") {
      try {
        const confirmed = await api.pilot.updatePrintJobStatus(
          scope.organizationId,
          scope.unitId,
          job.serverId,
          { status: "printed", printerId: job.server?.printerId ?? undefined },
          crypto.randomUUID(),
        );
        updateLocalPrint(job.id, { server: confirmed.printJob, status: "printed" });
        setFeedback("Confirmação da impressão sincronizada.");
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "A confirmação continua pendente.");
      }
      return;
    }
    if (job.status === "printing") {
      await markPrintNotDelivered(job);
      return;
    }
    updateLocalPrint(job.id, { status: "preparing" });
    try {
      const queued =
        job.status === "failed"
          ? await api.pilot.retryPrintJob(
              scope.organizationId,
              scope.unitId,
              job.serverId,
              {},
              crypto.randomUUID(),
            )
          : job.status === "queued" && job.server
            ? { printJob: job.server }
            : await api.pilot.reprintJob(
                scope.organizationId,
                scope.unitId,
                job.serverId,
                { reason, copies: 1 },
                crypto.randomUUID(),
              );
      updateLocalPrint(job.id, { serverId: queued.printJob.id, server: queued.printJob });
      if (shellPrintingAvailable()) await deliverThermalJob(queued.printJob, job.id);
      else await deliverBrowserJob(queued.printJob, job.id);
    } catch (error) {
      updateLocalPrint(job.id, { status: "failed" });
      setFeedback(error instanceof Error ? error.message : "Não foi possível imprimir.");
    }
  }

  async function markPrintNotDelivered(job: PrintJob) {
    if (!job.serverId) return;
    if (
      !window.confirm(
        "Confirme somente se nenhum papel útil saiu. Marcar esta tentativa como não impressa?",
      )
    ) {
      return;
    }
    try {
      const failed = await api.pilot.updatePrintJobStatus(
        scope.organizationId,
        scope.unitId,
        job.serverId,
        { status: "failed", error: "Saída física não confirmada pelo operador" },
        crypto.randomUUID(),
      );
      updateLocalPrint(job.id, { server: failed.printJob, status: "failed" });
      setFeedback("Tentativa marcada como não impressa; agora é seguro tentar novamente.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Não foi possível corrigir o estado.");
    }
  }

  function openCustomerDisplay() {
    const target = new URL(window.location.href);
    target.hash = `/counter?display=${encodeURIComponent(tabId)}`;
    const display = window.open(target, "_blank", "popup,width=1280,height=800");
    if (!display) setFeedback("O navegador bloqueou o visor. Libere pop-ups para este sistema.");
  }

  useEffect(() => {
    if (cart.length) window.localStorage.setItem(cartStorageKey, JSON.stringify(cart));
    else window.localStorage.removeItem(cartStorageKey);
  }, [cart, cartStorageKey]);

  useEffect(() => {
    window.localStorage.setItem(favoriteStorageKey, JSON.stringify(favoriteProductIds));
  }, [favoriteProductIds, favoriteStorageKey]);

  useEffect(() => {
    window.localStorage.setItem(recentStorageKey, JSON.stringify(recentProductIds));
  }, [recentProductIds, recentStorageKey]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible" && navigator.onLine) detail.retry();
    };
    const interval = window.setInterval(refresh, 8_000);
    return () => window.clearInterval(interval);
  }, [detail.retry]);

  useEffect(() => {
    if (detail.state.status !== "ready") return;
    const { tab } = detail.state.data;
    if (metadataVersionRef.current === tab.version) return;
    metadataVersionRef.current = tab.version;
    setCustomerName(tab.customerName ?? "");
    setCustomerPhone(tab.customerPhone ?? "");
    setReadyNotificationConsent(tab.readyNotificationConsent);
    setServiceNotes(tab.serviceNotes ?? "");
    setDeliveryAddress(tab.deliveryAddress ?? "");
    setFulfillmentType(tab.fulfillmentType);
    const promised = splitPromisedAt(tab.promisedAt);
    setPromisedDate(promised.date);
    setPromisedTime(promised.time);
    setResponsibleIdentityId(tab.responsibleIdentityId ?? "");
  }, [detail.state]);

  useEffect(() => {
    const touch = () =>
      api.pilot.touchPresence(scope.organizationId, scope.unitId, tabId).catch(() => undefined);
    void touch();
    const interval = window.setInterval(touch, 30_000);
    return () => window.clearInterval(interval);
  }, [scope.organizationId, scope.unitId, tabId]);

  async function mutate<T>(
    action: () => Promise<T>,
    success: string | ((result: T) => string),
    onSuccess?: (result: T) => void,
  ) {
    setBusy(true);
    setFeedback("");
    try {
      const result = await action();
      onSuccess?.(result);
      setFeedback(typeof success === "function" ? success(result) : success);
      detail.retry();
      tabs.retry();
      onChanged();
      return true;
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "A ação não foi confirmada pelo servidor.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function closeTabWithReturnableCheck(body: CloseTabBody) {
    try {
      return await api.pilot.closeTab(
        scope.organizationId,
        scope.unitId,
        tabId,
        body,
        crypto.randomUUID(),
      );
    } catch (error) {
      if (!(error instanceof ApiClientError) || error.code !== "TAB_HAS_OPEN_RETURNABLE_CUSTODY") {
        throw error;
      }
      if (error.details?.policy === "block") {
        throw new Error(
          "Confirme a devolução em Estoque > Vasilhames antes de encerrar o atendimento.",
        );
      }
      if (
        !window.confirm(
          "Há vasilhames pendentes nesta comanda. Deseja encerrar mesmo assim e manter a pendência em Estoque > Vasilhames?",
        )
      ) {
        throw new Error("Fechamento cancelado. A custódia dos vasilhames continua pendente.");
      }
      return api.pilot.closeTab(
        scope.organizationId,
        scope.unitId,
        tabId,
        { ...body, returnableDecision: "acknowledge" },
        crypto.randomUUID(),
      );
    }
  }

  async function closeAndPrint() {
    setBusy(true);
    setFeedback("");
    const thermal = shellPrintingAvailable();
    try {
      const closed = await closeTabWithReturnableCheck({
        printRequested: true,
        printOptions: {
          copies: 1,
          ...((terminalProfile?.installationId ?? scope.installationId)
            ? {
                terminalId: terminalProfile?.installationId ?? scope.installationId,
              }
            : {}),
          ...((terminalProfile?.printerId ?? currentTerminalPrinterId(scope.unitId))
            ? {
                printerId: terminalProfile?.printerId ?? currentTerminalPrinterId(scope.unitId),
              }
            : {}),
        },
      });
      detail.retry();
      tabs.retry();
      onChanged();
      if (closed.printJob) {
        const local = printJobFromServer(closed.printJob);
        setPrintJobs((current) => [local, ...current].slice(0, 4));
        if (thermal) await deliverThermalJob(closed.printJob, local.id);
        else await deliverBrowserJob(closed.printJob, local.id);
      } else {
        setFeedback("Atendimento encerrado, mas o servidor não gerou o documento de impressão.");
      }
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : "O atendimento não foi encerrado e nenhum comprovante final foi emitido.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <RemoteGate remote={detail}>
      {(data) => (
        <RemoteGate remote={catalog}>
          {(menu) => {
            const product = menu.products.find((item) => item.id === productId);
            const normalizedProductSearch = productSearch.trim().toLocaleLowerCase("pt-BR");
            const filteredProducts = menu.products.filter(
              (item) =>
                item.active &&
                (categoryId === "all" || item.categoryId === categoryId) &&
                (!normalizedProductSearch ||
                  `${item.name} ${item.description ?? ""}`
                    .toLocaleLowerCase("pt-BR")
                    .includes(normalizedProductSearch)),
            );
            const productRank = (id: string) => {
              const favoriteIndex = favoriteProductIds.indexOf(id);
              if (favoriteIndex >= 0) return favoriteIndex;
              const recentIndex = recentProductIds.indexOf(id);
              return recentIndex >= 0 ? 100 + recentIndex : 1_000;
            };
            const visibleProducts = [...filteredProducts].sort(
              (left, right) => productRank(left.id) - productRank(right.id),
            );
            const quickProducts = [...new Set([...favoriteProductIds, ...recentProductIds])]
              .map((id) => menu.products.find((item) => item.id === id))
              .filter((item): item is (typeof menu.products)[number] =>
                Boolean(item?.active && item.available && item.priceCents !== null),
              )
              .slice(0, 8);
            const unavailableProducts = visibleProducts.filter(
              (item) => !item.available || item.priceCents === null,
            );
            const productGroups = product
              ? menu.groups.filter((group) => product.modifierGroupIds.includes(group.id))
              : [];
            const modifierSelectionValid = productGroups.every((group) => {
              const count = menu.options.filter(
                (option) => option.groupId === group.id && options.includes(option.id),
              ).length;
              return count >= group.minimumSelections && count <= group.maximumSelections;
            });
            const activeItems = data.items.filter((item) => item.status !== "canceled");
            const paymentSummary = summarizeTabPayments(data.payments);
            const paidCents = paymentSummary.paidCents;
            const remainingCents = Math.max(0, data.tab.totalCents - paidCents);
            const currentTable = floor?.tables.find((table) => table.id === data.tab.tableId);
            const currentRoom = floor?.rooms.find((room) => room.id === currentTable?.roomId);
            const responsible = floor?.staff.find(
              (person) => person.identityId === data.tab.responsibleIdentityId,
            );
            const billCall = floor?.serviceCalls.find(
              (call) => call.tabId === tabId && call.kind === "bill",
            );
            const serviceMode = floor?.activeShift?.serviceMode ?? floor?.serviceMode ?? "hybrid";
            const fullService = serviceMode === "full_service" || serviceMode === "hybrid";
            const tabOpen = data.tab.status === "open";
            const oldestEvent = data.events.at(-1)?.createdAt;
            const openedMinutes = oldestEvent
              ? Math.max(0, Math.floor((Date.now() - new Date(oldestEvent).getTime()) / 60_000))
              : 0;
            const displayLabel =
              currentTable?.label ??
              data.tab.label ??
              (data.tab.displayNumber ? `Balcão ${data.tab.displayNumber}` : "Atendimento");
            const canApproveAdjustments = ["owner", "manager"].includes(scope.profileId);
            const canAdjustCharges = ["owner", "manager", "cashier"].includes(scope.profileId);
            const availableTables =
              floor?.tables.filter((table) => table.active && table.status === "available") ?? [];
            const mergeTargets =
              tabs.state.status === "ready"
                ? tabs.state.data.filter((tab) => tab.status === "open" && tab.id !== tabId)
                : [];
            const draftItemTotal = (item: DraftCartItem) => {
              if (item.doseClub) return 0;
              const selected = menu.products.find((candidate) => candidate.id === item.productId);
              const optionTotal = item.modifierOptionIds.reduce(
                (sum, optionId) =>
                  sum +
                  (menu.options.find((option) => option.id === optionId)?.priceDeltaCents ?? 0),
                0,
              );
              return ((selected?.priceCents ?? 0) + optionTotal) * item.quantity;
            };
            const cartQuantity = cart.reduce((sum, item) => sum + item.quantity, 0);
            const cartTotalCents = cart.reduce((sum, item) => sum + draftItemTotal(item), 0);
            const targetLabel = (target: (typeof mergeTargets)[number]) =>
              floor?.tables.find((table) => table.id === target.tableId)?.label ??
              target.label ??
              (target.displayNumber ? `Balcão ${target.displayNumber}` : "Atendimento sem mesa");
            const approvalStatusForItem = (itemId: string) => {
              const event = [...data.events]
                .filter(
                  (candidate) =>
                    ["approval.requested", "approval.approved", "approval.rejected"].includes(
                      candidate.type,
                    ) && candidate.payload.itemId === itemId,
                )
                .sort(
                  (left, right) =>
                    new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
                )[0];
              if (!event) return null;
              if (event.type === "approval.approved")
                return { label: "Ajuste autorizado", tone: "success" as const };
              if (event.type === "approval.rejected")
                return { label: "Ajuste recusado", tone: "danger" as const };
              return { label: "Aguardando gerente", tone: "warning" as const };
            };
            function rememberProduct(id: string) {
              setRecentProductIds((current) =>
                [id, ...current.filter((item) => item !== id)].slice(0, 12),
              );
            }
            function addDoseClubItem(
              membership: DoseClubEligibleMembership,
              externalProductId: string,
            ) {
              const selectedProduct = menu.products.find(
                (item) =>
                  item.id === externalProductId &&
                  item.active &&
                  item.available &&
                  item.priceCents !== null,
              );
              if (!selectedProduct) {
                setDoseClubNotice("Este produto não está disponível no cardápio atual.");
                return;
              }
              if (
                doseClubDraftQuantity(cart, membership.externalClubId) >= membership.availableDoses
              ) {
                setDoseClubNotice("O saldo disponível desta oferta já está no rascunho.");
                return;
              }
              const snapshot: DoseClubDraftSnapshot = {
                externalOfferId: membership.offer.externalOfferId,
                offerName: membership.offer.name,
                offerType: membership.offer.type,
                externalProductId,
                availableDoses: membership.availableDoses,
                doseMl: membership.doseMl,
              };
              setCart((current) => {
                if (
                  doseClubDraftQuantity(current, membership.externalClubId) >=
                  membership.availableDoses
                ) {
                  return current;
                }
                const refreshed = current.map((item) =>
                  item.doseClub?.externalClubId === membership.externalClubId &&
                  item.doseClubSnapshot
                    ? {
                        ...item,
                        doseClubSnapshot: {
                          ...item.doseClubSnapshot,
                          externalOfferId: membership.offer.externalOfferId,
                          offerName: membership.offer.name,
                          offerType: membership.offer.type,
                          availableDoses: membership.availableDoses,
                          doseMl: membership.doseMl,
                        },
                      }
                    : item,
                );
                const duplicate = refreshed.find(
                  (item) =>
                    item.productId === selectedProduct.id &&
                    item.doseClub?.externalClubId === membership.externalClubId,
                );
                return duplicate
                  ? refreshed.map((item) =>
                      item.id === duplicate.id
                        ? { ...item, quantity: item.quantity + 1, doseClubSnapshot: snapshot }
                        : item,
                    )
                  : [
                      ...refreshed,
                      {
                        id: crypto.randomUUID(),
                        productId: selectedProduct.id,
                        name: selectedProduct.name,
                        quantity: 1,
                        modifierOptionIds: [],
                        doseClub: { externalClubId: membership.externalClubId },
                        doseClubSnapshot: snapshot,
                      },
                    ];
              });
              rememberProduct(selectedProduct.id);
              setLastRemovedItem(null);
              setDoseClubNotice(
                `1 dose de ${selectedProduct.name} adicionada como pré-paga por ${membership.offer.name}.`,
              );
              if (!window.matchMedia("(max-width: 640px)").matches) setDraftExpanded(true);
            }
            function addItem(selectedProduct = product) {
              if (
                !selectedProduct ||
                selectedProduct.priceCents === null ||
                !selectedProduct.available ||
                quantity < 1
              )
                return;
              const next = {
                productId: selectedProduct.id,
                name: selectedProduct.name,
                modifierOptionIds: [...options].sort(),
                ...(notes.trim() ? { notes: notes.trim() } : {}),
                ...(seatNumber > 0 ? { seatNumber } : {}),
                ...(course && course !== "anytime" ? { course } : {}),
                ...(allergyNote.trim() ? { allergyNote: allergyNote.trim() } : {}),
              };
              setCart((value) => {
                const duplicate = value.find(
                  (item) =>
                    !item.doseClub &&
                    item.productId === next.productId &&
                    JSON.stringify(item.modifierOptionIds) ===
                      JSON.stringify(next.modifierOptionIds) &&
                    item.notes === next.notes &&
                    item.seatNumber === next.seatNumber &&
                    item.course === next.course &&
                    item.allergyNote === next.allergyNote,
                );
                return duplicate
                  ? value.map((item) =>
                      item.id === duplicate.id
                        ? { ...item, quantity: item.quantity + quantity }
                        : item,
                    )
                  : [...value, { id: crypto.randomUUID(), quantity, ...next }];
              });
              rememberProduct(selectedProduct.id);
              setLastRemovedItem(null);
              setQuantity(1);
              setProductId("");
              setNotes("");
              setSeatNumber(0);
              setCourse("anytime");
              setAllergyNote("");
              setOptions([]);
              if (!window.matchMedia("(max-width: 640px)").matches) setDraftExpanded(true);
            }

            function closeProductEditor() {
              setProductId("");
              setQuantity(1);
              setNotes("");
              setSeatNumber(0);
              setCourse("anytime");
              setAllergyNote("");
              setOptions([]);
            }

            function removeDraftItem(item: DraftCartItem) {
              setCart((current) => current.filter((candidate) => candidate.id !== item.id));
              setLastRemovedItem(item);
            }

            function repeatLastOrder() {
              const repeatable = lastOrder.filter((item) => {
                if (item.doseClub) return false;
                const selected = menu.products.find((product) => product.id === item.productId);
                return selected?.active && selected.available && selected.priceCents !== null;
              });
              if (!repeatable.length) {
                setFeedback("Não há itens disponíveis para repetir.");
                return;
              }
              setCart((current) => [
                ...current,
                ...repeatable.map((item) => ({ ...item, id: crypto.randomUUID() })),
              ]);
              repeatable.forEach((item) => {
                rememberProduct(item.productId);
              });
              setFeedback(
                `${repeatable.length} item(ns) do último pedido adicionados ao rascunho.`,
              );
            }

            async function requestBillAndPrint() {
              const tableId = data.tab.tableId;
              if (billRequestPending) return;
              if (!tableId) {
                if (localPrintingEnabled) void printDocument("account");
                setFeedback(
                  !localPrintingEnabled
                    ? "Este terminal não imprime localmente."
                    : "Pré-conta enviada para impressão.",
                );
                return;
              }
              if (billCall) {
                setView("account");
                setFeedback(
                  localPrintingEnabled
                    ? "A conta já foi solicitada. Para outra via, informe o motivo na fila de impressão."
                    : "A conta já está na fila do caixa.",
                );
                return;
              }
              setBillRequestPending(true);
              try {
                const installationId = terminalProfile?.installationId ?? scope.installationId;
                const printerId =
                  terminalProfile?.printerId ?? currentTerminalPrinterId(scope.unitId);
                const requested = await api.pilot.createServiceCall(
                  scope.organizationId,
                  scope.unitId,
                  tableId,
                  {
                    kind: "bill",
                    tabId,
                    slaMinutes: 2,
                    copies: 1,
                    ...(installationId ? { installationId, terminalId: installationId } : {}),
                    ...(printerId ? { printerId } : {}),
                  },
                  crypto.randomUUID(),
                );
                detail.retry();
                tabs.retry();
                onChanged();
                if (requested.printJob && requested.deliveryRoute === "local") {
                  const local = printJobFromServer(requested.printJob);
                  setPrintJobs((current) => [local, ...current].slice(0, 12));
                  if (requested.printJob.status !== "queued") {
                    setView("account");
                    setFeedback(
                      "A conta já tinha uma tentativa de impressão. Confira o estado na fila antes de repetir.",
                    );
                  } else if (shellPrintingAvailable()) {
                    await deliverThermalJob(requested.printJob, local.id);
                  } else {
                    await deliverBrowserJob(requested.printJob, local.id);
                  }
                } else {
                  setFeedback("Conta solicitada ao caixa.");
                }
              } catch (error) {
                setFeedback(
                  error instanceof Error ? error.message : "Não foi possível solicitar a conta.",
                );
              } finally {
                setBillRequestPending(false);
              }
            }

            async function submitPrintSplit(event: FormEvent<HTMLFormElement>) {
              event.preventDefault();
              if (!localPrintingEnabled || printSplitPartCount < 2) return;
              if (printSplitMethod === "fixed_amount" && printSplitFixedReais <= 0) return;
              setBusy(true);
              setFeedback("");
              try {
                const created = await api.pilot.createPrintSplit(
                  scope.organizationId,
                  scope.unitId,
                  tabId,
                  {
                    method: printSplitMethod,
                    partCount: printSplitPartCount,
                    ...(printSplitMethod === "fixed_amount"
                      ? { fixedAmountCents: Math.round(printSplitFixedReais * 100) }
                      : {}),
                    documentType: "partial_statement",
                    copies: 1,
                    ...((terminalProfile?.installationId ?? scope.installationId)
                      ? {
                          installationId: terminalProfile?.installationId ?? scope.installationId,
                          terminalId: terminalProfile?.installationId ?? scope.installationId,
                        }
                      : {}),
                    ...((terminalProfile?.printerId ?? currentTerminalPrinterId(scope.unitId))
                      ? {
                          printerId:
                            terminalProfile?.printerId ?? currentTerminalPrinterId(scope.unitId),
                        }
                      : {}),
                    ...(billCall ? { serviceCallId: billCall.id } : {}),
                  },
                  crypto.randomUUID(),
                );
                const localJobs = created.printJobs.map(printJobFromServer);
                setPrintJobs((current) => [...localJobs, ...current].slice(0, 12));
                if (shellPrintingAvailable()) {
                  for (const job of created.printJobs) {
                    await deliverThermalJob(job, job.id);
                  }
                }
                setFeedback(
                  `${created.parts.length} via(s) de divisão criadas sobre o saldo atual. A divisão não registrou pagamento.`,
                );
              } catch (error) {
                setFeedback(
                  error instanceof Error
                    ? error.message
                    : "Não foi possível criar as vias da divisão.",
                );
              } finally {
                setBusy(false);
              }
            }

            function prepareFullCashierPayment() {
              setView("account");
              const remainingReais = remainingCents / 100;
              setPaymentReais(remainingReais);
              if (paymentMethod === "cash") setCashReceivedReais(remainingReais);
              window.requestAnimationFrame(() => {
                paymentAmountRef.current?.scrollIntoView({ block: "center" });
                paymentAmountRef.current?.focus();
              });
            }

            function openReceive() {
              if (integratedPaymentEnabled) {
                setView("account");
                setSmartPosOpen(true);
                return;
              }
              prepareFullCashierPayment();
            }

            async function submitCart(sendToProduction: boolean) {
              if (!cart.length) return;
              setBusy(true);
              setFeedback("");
              let createdCount = 0;
              let remainingCart = cart;
              try {
                const submittedCart = cart;
                for (const group of groupDraftItemsByCourse(submittedCart)) {
                  const body = {
                    items: draftItemsToOrderItems(group),
                  };
                  const value = record(
                    await scope.dispatch(
                      "pos.order.create_requested",
                      pilotMutation("create-order", { tabId, body }),
                      (key) =>
                        api.pilot.createOrder(scope.organizationId, scope.unitId, tabId, body, key),
                    ),
                  );
                  const orderId = record(value.order).id;
                  if (typeof orderId !== "string" || !orderId) {
                    throw new Error("O servidor não confirmou o número do pedido.");
                  }
                  createdCount += 1;
                  const createdIds = new Set(group.map((item) => item.id));
                  remainingCart = remainingCart.filter((item) => !createdIds.has(item.id));
                  setCart(remainingCart);
                  if (sendToProduction) {
                    await scope.dispatch(
                      "pos.order.send_requested",
                      pilotMutation("send-order", { orderId }),
                      (key) =>
                        api.pilot.sendOrder(scope.organizationId, scope.unitId, orderId, key),
                    );
                  }
                }
                setLastOrder(submittedCart);
                window.localStorage.setItem(lastOrderStorageKey, JSON.stringify(submittedCart));
                setFeedback(
                  sendToProduction
                    ? createdCount > 1
                      ? `${createdCount} etapas enviadas à produção.`
                      : "Pedido enviado à produção."
                    : createdCount > 1
                      ? `${createdCount} etapas mantidas em espera.`
                      : "Pedido mantido em espera.",
                );
              } catch (error) {
                setFeedback(
                  createdCount
                    ? `${createdCount} etapa(s) salva(s); os itens restantes continuam no rascunho.`
                    : error instanceof Error
                      ? error.message
                      : "Não foi possível salvar o pedido.",
                );
              } finally {
                setBusy(false);
                detail.retry();
                tabs.retry();
                onChanged();
              }
            }
            return (
              <section
                aria-label={`Comanda ${displayLabel}`}
                className="tab-workspace attendance-cockpit"
                onKeyDown={(event) => {
                  const target = event.target as HTMLElement;
                  const editing = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
                  if (event.key === "/" && !editing) {
                    event.preventDefault();
                    productSearchRef.current?.focus();
                  }
                  if (
                    (event.ctrlKey || event.metaKey) &&
                    event.key === "Enter" &&
                    cart.length &&
                    !doseClubOpen
                  ) {
                    event.preventDefault();
                    void submitCart(true);
                  }
                  if (event.key === "Escape" && productId) setProductId("");
                }}
              >
                {!compactHeading && (
                  <header className="workspace-heading workspace-heading--compact">
                    <div className="workspace-heading__identity">
                      <p className="eyebrow">
                        {currentRoom?.name ?? "Atendimento"}
                        <span aria-hidden="true"> · </span>
                        {serviceModeLabel(serviceMode)}
                      </p>
                      <div className="workspace-heading__title-row">
                        <h2>{displayLabel}</h2>
                        <Badge tone={!tabOpen ? "neutral" : billCall ? "warning" : "info"}>
                          {!tabOpen
                            ? "Encerrada"
                            : billCall
                              ? "Conta solicitada"
                              : "Em atendimento"}
                        </Badge>
                      </div>
                      <p className="workspace-heading__context">
                        <span>
                          {data.tab.guestCount} {data.tab.guestCount === 1 ? "pessoa" : "pessoas"}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{responsible?.displayName ?? "Sem responsável"}</span>
                        <span aria-hidden="true">·</span>
                        <span>{openedMinutes} min</span>
                        <span aria-hidden="true">·</span>
                        <strong>
                          <span className="gm-sr-only">Total: </span>
                          {formatMoney(data.tab.totalCents)}
                        </strong>
                      </p>
                    </div>
                    <div className="workspace-heading__health" role="status">
                      <span
                        className={online ? "is-online" : "is-offline"}
                        title={
                          online
                            ? "Servidor conectado"
                            : "Sem conexão; ações seguras entram na fila"
                        }
                      >
                        <span className="gm-sr-only">
                          {online
                            ? "Servidor conectado"
                            : "Servidor sem conexão; ações seguras entram na fila"}
                        </span>
                        <span aria-hidden="true">{online ? "Online" : "Offline"}</span>
                      </span>
                      {cart.length > 0 && <span>{cartQuantity} no rascunho</span>}
                    </div>
                  </header>
                )}
                {data.tab.serviceNotes && (
                  <div className="cross-room-service-notice" role="note">
                    <strong>Observação da recepção</strong>
                    <span>{data.tab.serviceNotes}</span>
                  </div>
                )}
                <nav
                  aria-label="Áreas do atendimento"
                  className="workspace-tabs workspace-tabs--primary"
                >
                  <Button
                    aria-current={view === "order" ? "page" : undefined}
                    onClick={() => setView("order")}
                    type="button"
                  >
                    Pedido <Badge tone="neutral">{activeItems.length}</Badge>
                  </Button>
                  <Button
                    aria-current={view === "account" ? "page" : undefined}
                    onClick={() => setView("account")}
                    type="button"
                  >
                    Conta
                    {billCall && <span className="workspace-tabs__alert" />}
                  </Button>
                  <details
                    className="workspace-tabs__more"
                    data-active={view === "table" || view === "activity"}
                  >
                    <summary>
                      {view === "table" ? "Detalhes" : view === "activity" ? "Histórico" : "Mais"}
                      <span aria-hidden="true">⌄</span>
                    </summary>
                    <div className="workspace-tabs__menu">
                      <Button
                        aria-current={view === "table" ? "page" : undefined}
                        onClick={(event) => {
                          setView("table");
                          event.currentTarget.closest("details")?.removeAttribute("open");
                        }}
                        type="button"
                        variant="ghost"
                      >
                        <span>
                          <strong>Detalhes</strong>
                          <small>Cliente, responsável e organização da mesa</small>
                        </span>
                      </Button>
                      <Button
                        aria-current={view === "activity" ? "page" : undefined}
                        onClick={(event) => {
                          setView("activity");
                          event.currentTarget.closest("details")?.removeAttribute("open");
                        }}
                        type="button"
                        variant="ghost"
                      >
                        <span>
                          <strong>Histórico</strong>
                          <small>{data.events.length} registro(s) auditáveis</small>
                        </span>
                      </Button>
                      <Button
                        onClick={(event) => {
                          openCustomerDisplay();
                          event.currentTarget.closest("details")?.removeAttribute("open");
                        }}
                        type="button"
                        variant="ghost"
                      >
                        <span>
                          <strong>Visor do cliente</strong>
                          <small>Abrir esta conta em uma segunda tela</small>
                        </span>
                      </Button>
                    </div>
                  </details>
                </nav>
                {feedback && (
                  <Toast
                    actionLabel={undoResponsibility ? "Desfazer" : undefined}
                    duration={
                      feedback.includes("Não") || feedback.includes("Falha") ? 6_500 : 4_500
                    }
                    message={feedback}
                    onAction={
                      undoResponsibility
                        ? () => {
                            const undo = undoResponsibility;
                            setUndoResponsibility(null);
                            void api.pilot
                              .updateTab(scope.organizationId, scope.unitId, tabId, {
                                expectedVersion: undo.version,
                                responsibleIdentityId: undo.identityId,
                              })
                              .then(() => {
                                setFeedback("Responsabilidade anterior restaurada.");
                                detail.retry();
                                onChanged();
                              })
                              .catch((error: unknown) =>
                                setFeedback(
                                  error instanceof Error
                                    ? error.message
                                    : "Não foi possível desfazer a alteração.",
                                ),
                              );
                          }
                        : undefined
                    }
                    onDismiss={() => {
                      setFeedback("");
                      setUndoResponsibility(null);
                    }}
                    title="Atualização da comanda"
                    tone={
                      feedback.includes("Não") || feedback.includes("Falha") ? "danger" : "success"
                    }
                  />
                )}
                {view === "table" && (
                  <details className="tab-metadata-card tab-metadata-details" open>
                    <summary>
                      <span>
                        <strong>Dados da comanda</strong>
                        <small>
                          {data.tab.fulfillmentType === "pickup"
                            ? "Retirada"
                            : data.tab.fulfillmentType === "delivery"
                              ? "Delivery"
                              : "Consumo no local"}
                          {data.tab.customerName ? ` · ${data.tab.customerName}` : ""}
                        </small>
                      </span>
                      <fieldset className="presence-list">
                        <legend className="gm-sr-only">Pessoas editando agora</legend>
                        {data.presence.map((person) => (
                          <Badge key={person.identityId} tone="neutral">
                            {person.identityId === scope.identityId ? "Você" : person.displayName}
                          </Badge>
                        ))}
                      </fieldset>
                    </summary>
                    <form
                      className="inline-form counter-metadata-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void mutate(
                          () =>
                            api.pilot.updateTab(scope.organizationId, scope.unitId, tabId, {
                              expectedVersion: data.tab.version,
                              customerName: customerName.trim() || null,
                              customerPhone: customerPhone.trim() || null,
                              readyNotificationConsent:
                                Boolean(customerPhone.trim()) && readyNotificationConsent,
                              serviceNotes: serviceNotes.trim() || null,
                              deliveryAddress:
                                fulfillmentType === "delivery"
                                  ? deliveryAddress.trim() || null
                                  : null,
                              fulfillmentType,
                              promisedAt: promisedAtToIso(promisedDate, promisedTime),
                              responsibleIdentityId: responsibleIdentityId || null,
                            }),
                          "Dados da comanda atualizados.",
                        );
                      }}
                    >
                      <Label>
                        Tipo
                        <NativeSelect
                          onChange={(event) =>
                            setFulfillmentType(event.target.value as typeof fulfillmentType)
                          }
                          value={fulfillmentType}
                        >
                          <option value="dine_in">Consumo no local</option>
                          <option value="pickup">Retirada</option>
                          <option value="delivery">Delivery</option>
                        </NativeSelect>
                      </Label>
                      <Label>
                        Cliente
                        <Input
                          onChange={(event) => setCustomerName(event.target.value)}
                          placeholder={displayLabel}
                          value={customerName}
                        />
                      </Label>
                      <Label>
                        Telefone
                        <Input
                          inputMode="tel"
                          onChange={(event) => setCustomerPhone(event.target.value)}
                          value={customerPhone}
                        />
                      </Label>
                      <Label className="counter-metadata-form__consent inline-form__wide">
                        <input
                          className="accent-primary"
                          checked={readyNotificationConsent}
                          disabled={!customerPhone.trim()}
                          onChange={(event) => setReadyNotificationConsent(event.target.checked)}
                          type="checkbox"
                        />
                        Cliente autorizou receber o aviso de pedido pronto
                      </Label>
                      <Label className="inline-form__wide">
                        Observações importantes
                        <Textarea
                          maxLength={500}
                          onChange={(event) => setServiceNotes(event.target.value)}
                          rows={2}
                          value={serviceNotes}
                        />
                      </Label>
                      <fieldset className="promised-at-field">
                        <legend>Prometido para</legend>
                        <Label>
                          <span>Data</span>
                          <Input
                            onChange={(event) => setPromisedDate(event.target.value)}
                            type="date"
                            value={promisedDate}
                          />
                        </Label>
                        <Label>
                          <span>Hora</span>
                          <Input
                            lang="pt-BR"
                            onChange={(event) => setPromisedTime(event.target.value)}
                            type="time"
                            value={promisedTime}
                          />
                        </Label>
                      </fieldset>
                      {fulfillmentType === "delivery" && (
                        <Label className="inline-form__wide">
                          Endereço de entrega
                          <Input
                            onChange={(event) => setDeliveryAddress(event.target.value)}
                            required
                            value={deliveryAddress}
                          />
                        </Label>
                      )}
                      {floor && (
                        <Label>
                          Responsável
                          <NativeSelect
                            onChange={(event) => setResponsibleIdentityId(event.target.value)}
                            value={responsibleIdentityId}
                          >
                            <option value="">Sem responsável</option>
                            {floor.staff.map((person) => (
                              <option key={person.identityId} value={person.identityId}>
                                {person.displayName}
                              </option>
                            ))}
                          </NativeSelect>
                        </Label>
                      )}
                      <Button disabled={busy} size="sm" type="submit" variant="secondary">
                        Salvar dados
                      </Button>
                      {data.tab.responsibleIdentityId !== scope.identityId && (
                        <Button
                          disabled={busy}
                          onClick={() => {
                            setBusy(true);
                            setFeedback("");
                            void api.pilot
                              .claimTab(scope.organizationId, scope.unitId, tabId, {
                                expectedVersion: data.tab.version,
                                responsibleIdentityId: scope.identityId,
                                reason: "Atendimento assumido na operação",
                              })
                              .then((value) => {
                                const result = record(value);
                                const changed = parseTab(record(result.tab));
                                setUndoResponsibility({
                                  identityId: data.tab.responsibleIdentityId,
                                  version: changed.version,
                                });
                                setResponsibleIdentityId(scope.identityId);
                                setFeedback("Atendimento atribuído a você.");
                                detail.retry();
                                onChanged();
                              })
                              .catch((error: unknown) =>
                                setFeedback(
                                  error instanceof Error
                                    ? error.message
                                    : "Não foi possível assumir o atendimento.",
                                ),
                              )
                              .finally(() => setBusy(false));
                          }}
                          size="sm"
                          type="button"
                        >
                          Assumir esta comanda
                        </Button>
                      )}
                    </form>
                  </details>
                )}
                {view === "order" && tabOpen && (
                  <Card className="order-composer">
                    <div className="section-title section-title--compact">
                      <div>
                        <p className="eyebrow">Novo pedido</p>
                        <h3>Adicionar itens</h3>
                      </div>
                      <div className="order-composer__heading-actions">
                        <small>{visibleProducts.length} produto(s)</small>
                        <Button
                          disabled={busy}
                          onClick={() => {
                            setDoseClubState({ status: "loading" });
                            setDoseClubOpen(true);
                          }}
                          size="sm"
                          type="button"
                          variant="secondary"
                        >
                          Dose Club
                        </Button>
                      </div>
                    </div>
                    <Modal
                      className="dose-club-modal"
                      description="Consulte o saldo pré-pago do cliente vinculado a esta comanda."
                      isOpen={doseClubOpen}
                      onClose={() => setDoseClubOpen(false)}
                      size="lg"
                      title="Dose Club"
                    >
                      <div className="dose-club-modal__content">
                        {doseClubState.status === "loading" && (
                          <div className="dose-club-state" role="status">
                            <strong>Consultando clubes do cliente…</strong>
                            <span>O saldo será confirmado pelo Dose Club.</span>
                          </div>
                        )}
                        {doseClubState.status === "error" && (
                          <div role="alert">
                            <Callout tone="danger">
                              <strong>Não foi possível consultar o Dose Club</strong>
                              <p>{doseClubState.message}</p>
                              <Button
                                onClick={() => {
                                  setDoseClubState({ status: "loading" });
                                  setDoseClubRetryKey((current) => current + 1);
                                }}
                                size="sm"
                                type="button"
                                variant="secondary"
                              >
                                Tentar novamente
                              </Button>
                            </Callout>
                          </div>
                        )}
                        {doseClubState.status === "ready" &&
                          doseClubState.memberships.length === 0 && (
                            <div className="dose-club-state" role="status">
                              <strong>Nenhum clube ativo encontrado</strong>
                              <span>
                                Vincule o cliente à comanda ou siga com a venda comum do cardápio.
                              </span>
                            </div>
                          )}
                        {doseClubState.status === "ready" &&
                          doseClubState.memberships.length > 0 && (
                            <div className="dose-club-memberships">
                              {doseClubState.memberships.map((membership) => {
                                const draftedDoses = doseClubDraftQuantity(
                                  cart,
                                  membership.externalClubId,
                                );
                                const availableForDraft = Math.max(
                                  0,
                                  membership.availableDoses - draftedDoses,
                                );
                                const eligibleProducts = membership.eligibleProducts.flatMap(
                                  (eligibleProduct) => {
                                    const localProduct = menu.products.find(
                                      (item) =>
                                        item.id === eligibleProduct.externalProductId &&
                                        item.active &&
                                        item.available &&
                                        item.priceCents !== null,
                                    );
                                    return localProduct ? [{ eligibleProduct, localProduct }] : [];
                                  },
                                );
                                return (
                                  <article
                                    className="dose-club-membership"
                                    key={membership.externalClubId}
                                  >
                                    <header className="dose-club-membership__heading">
                                      <div>
                                        <strong>{membership.offer.name}</strong>
                                        <small>
                                          {membership.offer.type === "combo_pool"
                                            ? "Combo compartilhado"
                                            : "Clube individual"}
                                        </small>
                                      </div>
                                      <Badge
                                        tone={membership.availableDoses > 0 ? "success" : "warning"}
                                      >
                                        {membership.availableDoses > 0 ? "Ativo" : "Sem saldo"}
                                      </Badge>
                                    </header>
                                    <dl className="dose-club-balance" aria-label="Saldo de doses">
                                      <div>
                                        <dt>Saldo</dt>
                                        <dd>{membership.remainingDoses}</dd>
                                      </div>
                                      <div>
                                        <dt>Reservadas</dt>
                                        <dd>{membership.reservedDoses}</dd>
                                      </div>
                                      <div>
                                        <dt>Disponíveis</dt>
                                        <dd>{membership.availableDoses}</dd>
                                      </div>
                                      <div>
                                        <dt>No rascunho</dt>
                                        <dd>{draftedDoses}</dd>
                                      </div>
                                      <div>
                                        <dt>Por dose</dt>
                                        <dd>{membership.doseMl} ml</dd>
                                      </div>
                                    </dl>
                                    <div className="dose-club-products">
                                      <strong>Produtos elegíveis</strong>
                                      {eligibleProducts.length === 0 ? (
                                        <p>
                                          Nenhum produto elegível está disponível no cardápio atual.
                                        </p>
                                      ) : (
                                        eligibleProducts.map(
                                          ({ eligibleProduct, localProduct }) => (
                                            <div
                                              className="dose-club-product"
                                              key={eligibleProduct.externalProductId}
                                            >
                                              <span>
                                                <strong>{localProduct.name}</strong>
                                                <small>
                                                  {eligibleProduct.brand
                                                    ? `${eligibleProduct.brand} · `
                                                    : ""}
                                                  {membership.doseMl} ml · pré-pago
                                                </small>
                                              </span>
                                              <Button
                                                disabled={busy || availableForDraft <= 0}
                                                onClick={() =>
                                                  addDoseClubItem(
                                                    membership,
                                                    eligibleProduct.externalProductId,
                                                  )
                                                }
                                                size="sm"
                                                type="button"
                                              >
                                                Usar 1 dose
                                              </Button>
                                            </div>
                                          ),
                                        )
                                      )}
                                    </div>
                                  </article>
                                );
                              })}
                            </div>
                          )}
                        {doseClubNotice && (
                          <Callout
                            tone={doseClubNotice.startsWith("1 dose") ? "success" : "warning"}
                          >
                            <span role="status">{doseClubNotice}</span>
                          </Callout>
                        )}
                      </div>
                    </Modal>
                    {(quickProducts.length > 0 || lastOrder.length > 0) && (
                      <section className="quick-order-strip" aria-label="Atalhos de pedido">
                        <div>
                          <strong>Atalhos</strong>
                          <small>Favoritos e itens usados recentemente</small>
                        </div>
                        <div className="quick-order-strip__items">
                          {lastOrder.length > 0 && (
                            <Button onClick={repeatLastOrder} type="button">
                              ↻ Repetir último
                            </Button>
                          )}
                          {quickProducts.map((item) => (
                            <Button
                              key={item.id}
                              onClick={() =>
                                item.modifierGroupIds.length ? setProductId(item.id) : addItem(item)
                              }
                              type="button"
                            >
                              {favoriteProductIds.includes(item.id) ? "★ " : ""}
                              {item.name}
                            </Button>
                          ))}
                        </div>
                      </section>
                    )}
                    <Label className="search-field real-product-search">
                      <span aria-hidden="true">⌕</span>
                      <Input
                        ref={productSearchRef}
                        onChange={(event) => setProductSearch(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && visibleProducts[0]) {
                            event.preventDefault();
                            const item = visibleProducts[0];
                            if (item.modifierGroupIds.length === 0) addItem(item);
                            else setProductId(item.id);
                          }
                        }}
                        placeholder="Buscar produto ou descrição"
                        value={productSearch}
                      />
                      <kbd>/</kbd>
                    </Label>
                    <div className="segmented segmented--scroll real-category-filter">
                      <Button
                        aria-pressed={categoryId === "all"}
                        onClick={() => setCategoryId("all")}
                        type="button"
                      >
                        Todos
                      </Button>
                      {menu.categories.map((category) => (
                        <Button
                          aria-pressed={categoryId === category.id}
                          key={category.id}
                          onClick={() => setCategoryId(category.id)}
                          type="button"
                        >
                          {category.name}
                        </Button>
                      ))}
                    </div>
                    <div className="real-product-picker">
                      {visibleProducts.map((item) => (
                        <article
                          className={`real-product-option ${
                            productId === item.id ? "real-product-option--selected" : ""
                          }`}
                          key={item.id}
                        >
                          <Button
                            aria-label={`Adicionar ${item.name}`}
                            disabled={!item.available || item.priceCents === null}
                            onClick={(event) => {
                              const held = event.currentTarget.dataset.longPressed === "true";
                              delete event.currentTarget.dataset.longPressed;
                              if (held || item.modifierGroupIds.length > 0) {
                                setProductId(item.id);
                                setOptions([]);
                              } else addItem(item);
                            }}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              setProductId(item.id);
                              setOptions([]);
                            }}
                            onPointerDown={(event) => {
                              const button = event.currentTarget;
                              const timer = window.setTimeout(() => {
                                button.dataset.longPressed = "true";
                                setProductId(item.id);
                                setOptions([]);
                              }, 450);
                              button.dataset.holdTimer = String(timer);
                            }}
                            onPointerLeave={(event) =>
                              window.clearTimeout(Number(event.currentTarget.dataset.holdTimer))
                            }
                            onPointerUp={(event) =>
                              window.clearTimeout(Number(event.currentTarget.dataset.holdTimer))
                            }
                            type="button"
                          >
                            <span aria-hidden="true">{item.name.slice(0, 1)}</span>
                            <span>
                              <strong>{item.name}</strong>
                              <small>{item.description ?? "Sem descrição"}</small>
                            </span>
                            <strong>
                              {item.priceCents === null
                                ? "Sem preço"
                                : formatMoney(item.priceCents)}
                            </strong>
                          </Button>
                          <Button
                            aria-label={
                              favoriteProductIds.includes(item.id)
                                ? `Remover ${item.name} dos favoritos`
                                : `Adicionar ${item.name} aos favoritos`
                            }
                            className="real-product-option__favorite"
                            onClick={() =>
                              setFavoriteProductIds((current) =>
                                current.includes(item.id)
                                  ? current.filter((id) => id !== item.id)
                                  : [item.id, ...current].slice(0, 12),
                              )
                            }
                            type="button"
                          >
                            {favoriteProductIds.includes(item.id) ? "★" : "☆"}
                          </Button>
                        </article>
                      ))}
                    </div>
                    {unavailableProducts.length > 0 && (
                      <div className="substitution-list">
                        <strong>Substituições para itens indisponíveis</strong>
                        {unavailableProducts.map((unavailable) => {
                          const alternative = menu.products.find(
                            (candidate) =>
                              candidate.categoryId === unavailable.categoryId &&
                              candidate.id !== unavailable.id &&
                              candidate.active &&
                              candidate.available &&
                              candidate.priceCents !== null,
                          );
                          return (
                            <span key={unavailable.id}>
                              {unavailable.name}:{" "}
                              {alternative ? alternative.name : "sem alternativa"}
                              {alternative && (
                                <Button
                                  onClick={() => setProductId(alternative.id)}
                                  size="sm"
                                  variant="ghost"
                                >
                                  Usar alternativa
                                </Button>
                              )}
                            </span>
                          );
                        })}
                      </div>
                    )}
                    {visibleProducts.length === 0 && (
                      <p className="table-empty">Nenhum produto corresponde à busca.</p>
                    )}
                    <Modal
                      className="product-configurator"
                      isOpen={Boolean(product)}
                      onClose={closeProductEditor}
                      size="md"
                      title={product?.name ?? "Personalizar item"}
                    >
                      {product && (
                        <div className="product-configurator__content">
                          <div className="product-configurator__summary">
                            <span>{product.description ?? "Sem descrição"}</span>
                            <strong>
                              {product.priceCents === null
                                ? "Sem preço"
                                : formatMoney(product.priceCents)}
                            </strong>
                          </div>
                          {productGroups.map((group) => (
                            <fieldset className="modifier-group" key={group.id}>
                              <legend>
                                <span>{group.name}</span>
                                <small>
                                  Escolha {group.minimumSelections}–{group.maximumSelections}
                                </small>
                              </legend>
                              {menu.options
                                .filter((option) => option.groupId === group.id && option.active)
                                .map((option) => (
                                  <Label key={option.id}>
                                    <input
                                      className="accent-primary"
                                      checked={options.includes(option.id)}
                                      onChange={(event) =>
                                        setOptions((current) =>
                                          event.target.checked
                                            ? [...current, option.id]
                                            : current.filter((id) => id !== option.id),
                                        )
                                      }
                                      type="checkbox"
                                    />
                                    <span>{option.name}</span>
                                    {option.priceDeltaCents > 0 && (
                                      <small>+ {formatMoney(option.priceDeltaCents)}</small>
                                    )}
                                  </Label>
                                ))}
                            </fieldset>
                          ))}
                          <div className="product-customization">
                            <fieldset className="quantity-stepper product-customization__quantity">
                              <legend className="gm-sr-only">Quantidade</legend>
                              <Button
                                aria-label="Diminuir quantidade"
                                disabled={quantity <= 1}
                                onClick={() => setQuantity((current) => Math.max(1, current - 1))}
                                type="button"
                              >
                                −
                              </Button>
                              <strong>{quantity}</strong>
                              <Button
                                aria-label="Aumentar quantidade"
                                onClick={() => setQuantity((current) => current + 1)}
                                type="button"
                              >
                                +
                              </Button>
                            </fieldset>
                            <Label className="product-customization__notes">
                              Observação para a produção
                              <Input
                                onChange={(event) => setNotes(event.target.value)}
                                placeholder="Ex.: sem cebola"
                                value={notes}
                              />
                            </Label>
                            <QuickOrderChips
                              onSelectChip={(chip) =>
                                setNotes((current) =>
                                  current.trim() ? `${current.trim()}, ${chip}` : chip,
                                )
                              }
                            />
                            <details className="product-advanced-options" open={fullService}>
                              <summary>
                                Pessoa, etapa e restrições
                                <small>{fullService ? "Serviço completo" : "Opcional"}</small>
                              </summary>
                              <div className="gm-form-grid product-advanced-options__fields">
                                <Label className="gm-form-field">
                                  <span>Pessoa/assento</span>
                                  <Input
                                    className="gm-form-control"
                                    min={0}
                                    onChange={(event) => setSeatNumber(Number(event.target.value))}
                                    placeholder="0 = mesa"
                                    type="number"
                                    value={seatNumber}
                                  />
                                </Label>
                                <Label className="gm-form-field">
                                  <span>Etapa</span>
                                  <NativeSelect
                                    className="gm-form-control"
                                    onChange={(event) =>
                                      setCourse(
                                        event.target.value as NonNullable<DraftCartItem["course"]>,
                                      )
                                    }
                                    value={course}
                                  >
                                    <option value="anytime">Assim que pronto</option>
                                    <option value="starter">Entrada</option>
                                    <option value="main">Principal</option>
                                    <option value="dessert">Sobremesa</option>
                                  </NativeSelect>
                                </Label>
                                <Label className="gm-form-field product-advanced-options__restriction">
                                  <span>Alergia/restrição</span>
                                  <Input
                                    className="gm-form-control"
                                    onChange={(event) => setAllergyNote(event.target.value)}
                                    placeholder="Destacar para a produção"
                                    value={allergyNote}
                                  />
                                </Label>
                              </div>
                            </details>
                            <div className="product-configurator__actions">
                              <Button onClick={closeProductEditor} variant="ghost">
                                Cancelar
                              </Button>
                              <Button
                                disabled={quantity < 1 || !modifierSelectionValid}
                                onClick={() => addItem()}
                              >
                                Adicionar {quantity} ·{" "}
                                {formatMoney(
                                  ((product.priceCents ?? 0) +
                                    options.reduce(
                                      (sum, optionId) =>
                                        sum +
                                        (menu.options.find((option) => option.id === optionId)
                                          ?.priceDeltaCents ?? 0),
                                      0,
                                    )) *
                                    quantity,
                                )}
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}
                    </Modal>
                    <aside
                      aria-label="Rascunho do pedido"
                      className="cart-preview"
                      data-empty={cart.length === 0}
                      data-expanded={draftExpanded}
                    >
                      {cart.length > 0 && (
                        <Button
                          aria-expanded={draftExpanded}
                          className="cart-preview__mobile-toggle"
                          onClick={() => setDraftExpanded((current) => !current)}
                          type="button"
                        >
                          <span>
                            <strong>Comanda</strong>
                            <small>{cartQuantity} item(ns)</small>
                          </span>
                          <strong>{formatMoney(cartTotalCents)}</strong>
                        </Button>
                      )}
                      <header className="cart-preview__heading">
                        <span>
                          <strong>Rascunho automático</strong>
                          <small>Preservado neste dispositivo até o envio.</small>
                        </span>
                        {lastRemovedItem && (
                          <Button
                            onClick={() => {
                              setCart((current) => [...current, lastRemovedItem]);
                              setLastRemovedItem(null);
                            }}
                            type="button"
                          >
                            Desfazer remoção
                          </Button>
                        )}
                      </header>
                      {cart.length === 0 && (
                        <div className="cart-preview__empty">
                          <strong>Pedido ainda vazio</strong>
                          <small>
                            Os itens adicionados aparecem aqui antes de seguir para a produção.
                          </small>
                        </div>
                      )}
                      {cart.map((item) => (
                        <div className="cart-preview__item" key={item.id}>
                          <span className="cart-preview__item-copy">
                            <strong>{item.name}</strong>
                            {item.doseClubSnapshot && (
                              <span className="cart-preview__dose-club">
                                <Badge tone="info">Dose Club</Badge>
                                <span>{item.doseClubSnapshot.offerName}</span>
                              </span>
                            )}
                            <small>
                              {item.doseClubSnapshot
                                ? `${item.doseClubSnapshot.doseMl} ml · pré-pago · limite ${item.doseClubSnapshot.availableDoses}`
                                : item.notes || "Sem observação"}
                              {item.seatNumber ? ` · pessoa ${item.seatNumber}` : ""}
                              {item.allergyNote ? ` · ⚠ ${item.allergyNote}` : ""}
                            </small>
                            <b>
                              {item.doseClub
                                ? `Pré-pago · ${formatMoney(0)}`
                                : formatMoney(draftItemTotal(item))}
                            </b>
                          </span>
                          <span className="cart-preview__actions">
                            <span className="quantity-stepper quantity-stepper--compact">
                              <Button
                                aria-label={`Diminuir ${item.name}`}
                                onClick={() =>
                                  item.quantity === 1
                                    ? removeDraftItem(item)
                                    : setCart((current) =>
                                        current.map((candidate) =>
                                          candidate.id === item.id
                                            ? { ...candidate, quantity: candidate.quantity - 1 }
                                            : candidate,
                                        ),
                                      )
                                }
                                type="button"
                              >
                                −
                              </Button>
                              <strong>{item.quantity}</strong>
                              <Button
                                aria-label={`Aumentar ${item.name}`}
                                disabled={
                                  Boolean(item.doseClub && item.doseClubSnapshot) &&
                                  doseClubDraftQuantity(
                                    cart,
                                    item.doseClub?.externalClubId ?? "",
                                  ) >= (item.doseClubSnapshot?.availableDoses ?? 0)
                                }
                                onClick={() =>
                                  setCart((current) => incrementDraftItem(current, item.id))
                                }
                                type="button"
                              >
                                +
                              </Button>
                            </span>
                            {!item.doseClub && (
                              <Button
                                onClick={() => {
                                  setProductId(item.productId);
                                  setQuantity(item.quantity);
                                  setNotes(item.notes ?? "");
                                  setSeatNumber(item.seatNumber ?? 0);
                                  setCourse(item.course ?? "anytime");
                                  setAllergyNote(item.allergyNote ?? "");
                                  setOptions(item.modifierOptionIds);
                                  setCart((current) =>
                                    current.filter((candidate) => candidate.id !== item.id),
                                  );
                                }}
                                type="button"
                              >
                                Observação
                              </Button>
                            )}
                            <Button
                              aria-label={`Remover ${item.name}`}
                              onClick={() => removeDraftItem(item)}
                              type="button"
                            >
                              Remover
                            </Button>
                          </span>
                        </div>
                      ))}
                      {cart.length > 0 && (
                        <div className="cart-preview__submit">
                          <Button
                            disabled={busy}
                            onClick={() => void submitCart(false)}
                            size="sm"
                            variant="secondary"
                          >
                            Manter em espera
                          </Button>
                          <Button disabled={busy} onClick={() => void submitCart(true)}>
                            Enviar {cartQuantity} item(ns) · {formatMoney(cartTotalCents)}
                          </Button>
                        </div>
                      )}
                    </aside>
                  </Card>
                )}
                {view === "order" && (
                  <div className="data-list order-history-list">
                    {data.orders.map((order, orderIndex) => (
                      <article className="data-row" key={order.id}>
                        <div>
                          <strong>
                            Pedido {orderIndex + 1} · {displayLabel}
                          </strong>
                          {order.originTableId && (
                            <small>
                              Origem:{" "}
                              {floor?.tables.find((table) => table.id === order.originTableId)
                                ?.label ?? "Mesa anterior"}
                            </small>
                          )}
                          <small>
                            {data.items
                              .filter((item) => item.orderId === order.id)
                              .map(
                                (item) =>
                                  `${item.quantity}× ${item.productName}${
                                    item.seatNumber ? ` · pessoa ${item.seatNumber}` : ""
                                  }${
                                    item.course !== "anytime"
                                      ? ` · ${
                                          {
                                            starter: "entrada",
                                            main: "principal",
                                            dessert: "sobremesa",
                                          }[item.course]
                                        }`
                                      : ""
                                  }${item.allergyNote ? ` · atenção: ${item.allergyNote}` : ""}`,
                              )
                              .join(" · ") || "Sem itens"}
                          </small>
                        </div>
                        <div className="data-row__end">
                          <Badge tone={statusTone(order.status)}>
                            {{
                              draft: "Em espera",
                              sent: "Enviado",
                              preparing: "Em preparo",
                              ready: "Pronto",
                              served: "Servido",
                              canceled: "Cancelado",
                            }[order.status] ?? "Em andamento"}
                          </Badge>
                          {order.status === "draft" && (
                            <Button
                              disabled={busy}
                              onClick={() =>
                                void mutate(
                                  () =>
                                    scope.dispatch(
                                      "pos.order.send_requested",
                                      pilotMutation("send-order", { orderId: order.id }),
                                      (key) =>
                                        api.pilot.sendOrder(
                                          scope.organizationId,
                                          scope.unitId,
                                          order.id,
                                          key,
                                        ),
                                    ),
                                  "Pedido enviado à produção.",
                                )
                              }
                              size="sm"
                            >
                              Liberar{" "}
                              {courseLabels[
                                data.items.find((item) => item.orderId === order.id)?.course ??
                                  "anytime"
                              ].toLocaleLowerCase("pt-BR")}
                            </Button>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
                {view === "account" && (
                  <section className="account-overview">
                    <div className="account-overview__metrics">
                      <span>
                        <small>Total</small>
                        <strong>{formatMoney(data.tab.totalCents)}</strong>
                      </span>
                      <span>
                        <small>Recebido líquido</small>
                        <strong>{formatMoney(paidCents)}</strong>
                        {paymentSummary.reversedCents > 0 && (
                          <small>{formatMoney(paymentSummary.reversedCents)} estornado</small>
                        )}
                      </span>
                      <span data-balance={remainingCents > 0}>
                        <small>Saldo</small>
                        <strong>{formatMoney(remainingCents)}</strong>
                      </span>
                    </div>
                    <div className="account-overview__actions">
                      {cashierPaymentEnabled && remainingCents > 0 && (
                        <Button
                          disabled={busy || !tabOpen}
                          onClick={prepareFullCashierPayment}
                          size="sm"
                        >
                          Receber conta inteira · {formatMoney(remainingCents)}
                        </Button>
                      )}
                      {integratedPaymentEnabled && (
                        <Button
                          className="smart-pos-trigger"
                          disabled={!tabOpen || remainingCents <= 0}
                          onClick={() => setSmartPosOpen(true)}
                          size="sm"
                        >
                          Cobrar {formatMoney(remainingCents)} na maquininha
                        </Button>
                      )}
                      <Button
                        disabled={busy || billRequestPending || !tabOpen}
                        onClick={() => void requestBillAndPrint()}
                        size="sm"
                        variant="secondary"
                      >
                        {!localPrintingEnabled
                          ? billCall
                            ? "Conta já solicitada ao caixa"
                            : "Pedir conta ao caixa"
                          : data.tab.tableId && billCall
                            ? "Reimprimir pré-conta"
                            : billRequestPending
                              ? "Solicitando conta…"
                              : data.tab.tableId
                                ? "Pedir conta e imprimir"
                                : "Imprimir pré-conta"}
                      </Button>
                      {localPrintingEnabled && data.tab.tableId && (
                        <Button onClick={() => printDocument("account")} size="sm" variant="ghost">
                          Só imprimir pré-conta
                        </Button>
                      )}
                      {localPrintingEnabled && (
                        <Button
                          disabled={data.payments.length === 0}
                          onClick={() => printDocument("payments")}
                          size="sm"
                          variant="ghost"
                        >
                          Extrato de pagamentos
                        </Button>
                      )}
                    </div>
                    {integratedPaymentEnabled &&
                      integratedAttempt &&
                      ["created", "processing", "unknown"].includes(integratedAttempt.status) && (
                        <Callout tone={integratedAttempt.status === "unknown" ? "warning" : "info"}>
                          <strong>
                            {integratedAttempt.status === "unknown"
                              ? "Pagamento precisa de conferência"
                              : "Pagamento em andamento"}
                          </strong>
                          <p>
                            {formatMoney(integratedAttempt.amountCents)} · Não cobre novamente antes
                            de confirmar o resultado.
                          </p>
                          <Button
                            onClick={() => setSmartPosOpen(true)}
                            size="sm"
                            variant="secondary"
                          >
                            Reabrir pagamento
                          </Button>
                        </Callout>
                      )}
                    <small className="account-print-help">
                      A pré-conta mostra itens, total, valores pagos e saldo. Não fecha a comanda e
                      não registra pagamento.
                    </small>
                    {localPrintingEnabled && tabOpen && remainingCents > 0 && (
                      <form className="print-split-form" onSubmit={submitPrintSplit}>
                        <strong>Imprimir divisão sugerida</strong>
                        <NativeSelect
                          aria-label="Forma da divisão impressa"
                          onChange={(event) =>
                            setPrintSplitMethod(event.target.value as typeof printSplitMethod)
                          }
                          value={printSplitMethod}
                        >
                          <option value="equal_people">Dividir igualmente por pessoas</option>
                          <option value="fixed_amount">Vias por valor fixo</option>
                        </NativeSelect>
                        <Label>
                          Quantidade de vias
                          <Input
                            max={50}
                            min={2}
                            onChange={(event) => setPrintSplitPartCount(Number(event.target.value))}
                            type="number"
                            value={printSplitPartCount}
                          />
                        </Label>
                        {printSplitMethod === "fixed_amount" && (
                          <Label>
                            Valor sugerido por via
                            <Input
                              min={0.01}
                              onChange={(event) =>
                                setPrintSplitFixedReais(Number(event.target.value))
                              }
                              step="0.01"
                              type="number"
                              value={printSplitFixedReais}
                            />
                          </Label>
                        )}
                        <Button
                          disabled={
                            busy ||
                            printSplitPartCount < 2 ||
                            (printSplitMethod === "fixed_amount" && printSplitFixedReais <= 0)
                          }
                          size="sm"
                          type="submit"
                        >
                          Criar e imprimir vias
                        </Button>
                        <small>Divisão sugerida e persistida; não registra pagamento.</small>
                      </form>
                    )}
                    {printJobs.length > 0 && (
                      <div aria-label="Fila de impressão" className="print-queue" role="status">
                        {printJobs.map((job) => (
                          <span key={job.id}>
                            <strong>{job.label}</strong>
                            <small>{printStatusLabel(job)}</small>
                            {(job.status === "printed" || job.status === "fallback") && (
                              <Input
                                aria-label={`Motivo da reimpressão de ${job.label}`}
                                maxLength={500}
                                minLength={3}
                                onChange={(event) =>
                                  setReprintReasons((current) => ({
                                    ...current,
                                    [job.id]: event.target.value,
                                  }))
                                }
                                placeholder="Motivo obrigatório para reimprimir"
                                value={reprintReasons[job.id] ?? ""}
                              />
                            )}
                            {job.status !== "preparing" && (
                              <div className="print-queue__actions">
                                <Button
                                  disabled={
                                    (job.status === "printed" || job.status === "fallback") &&
                                    (reprintReasons[job.id]?.trim().length ?? 0) < 3
                                  }
                                  onClick={() => void reprintDocument(job)}
                                  type="button"
                                >
                                  {printActionLabel(job.status)}
                                </Button>
                                {job.status === "confirmation_required" && (
                                  <Button
                                    onClick={() => void markPrintNotDelivered(job)}
                                    type="button"
                                    variant="secondary"
                                  >
                                    Marcar não impresso
                                  </Button>
                                )}
                              </div>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                    {data.payments.length > 0 && (
                      <section className="account-payments" aria-label="Pagamentos registrados">
                        <strong>Pagamentos</strong>
                        {data.payments.map((payment) => (
                          <span key={payment.id}>
                            <span>
                              <b>
                                {
                                  {
                                    cash: "Dinheiro",
                                    credit_card: "Crédito",
                                    debit_card: "Débito",
                                    pix: "Pix",
                                    other: "Outro",
                                  }[payment.method]
                                }
                                {payment.financialStatus === "reversed" && (
                                  <Badge tone="danger">Estornado</Badge>
                                )}
                              </b>
                              <small>
                                {new Date(payment.createdAt).toLocaleString("pt-BR")}
                                {payment.reference ? ` · ${payment.reference}` : ""}
                              </small>
                            </span>
                            <span>
                              <strong>{formatMoney(payment.amountCents)}</strong>
                              {payment.financialStatus === "reversed" && (
                                <small>Líquido {formatMoney(payment.netAmountCents)}</small>
                              )}
                            </span>
                          </span>
                        ))}
                      </section>
                    )}
                    <div className="account-lines">
                      {activeItems.map((item) => (
                        <div className="account-line-group" key={item.id}>
                          <div className="account-line">
                            <span>
                              <strong>
                                {item.quantity}× {item.productName}
                              </strong>
                              <small>{item.status === "draft" ? "Em espera" : "Lançado"}</small>
                              {approvalStatusForItem(item.id) && (
                                <Badge tone={approvalStatusForItem(item.id)?.tone}>
                                  {approvalStatusForItem(item.id)?.label}
                                </Badge>
                              )}
                            </span>
                            <strong>{formatMoney(item.netCents)}</strong>
                            {tabOpen && (
                              <Button
                                aria-expanded={itemActionId === item.id}
                                aria-label={`Ações para ${item.productName}`}
                                onClick={() => {
                                  setApprovalItemId(item.id);
                                  setItemActionId((current) =>
                                    current === item.id ? "" : item.id,
                                  );
                                }}
                                type="button"
                              >
                                Mais
                              </Button>
                            )}
                          </div>
                          {itemActionId === item.id && (
                            <form
                              className="approval-form approval-form--inline"
                              onSubmit={(event) => event.preventDefault()}
                            >
                              <div className="approval-form__heading">
                                <span>Ajustar item</span>
                                <strong>{item.productName}</strong>
                                <Button onClick={() => setItemActionId("")} type="button">
                                  Fechar
                                </Button>
                              </div>
                              <p>
                                {canApproveAdjustments
                                  ? "Autorize com seu código gerencial ou encaminhe para outro responsável."
                                  : "Envie a solicitação; o gerente aprova no próprio dispositivo com o código dele."}
                              </p>
                              <Label>
                                Motivo
                                <Input
                                  list={`adjustment-reasons-${tabId}`}
                                  minLength={3}
                                  onChange={(event) => setApprovalReason(event.target.value)}
                                  value={approvalReason}
                                />
                              </Label>
                              <datalist id={`adjustment-reasons-${tabId}`}>
                                {adjustmentReasons.map((reason) => (
                                  <option key={reason} value={reason} />
                                ))}
                              </datalist>
                              <Label>
                                Desconto em reais
                                <Input
                                  min={0}
                                  onChange={(event) => setDiscountReais(Number(event.target.value))}
                                  step="0.01"
                                  type="number"
                                  value={discountReais}
                                />
                              </Label>
                              {canApproveAdjustments && (
                                <Label>
                                  Seu código gerencial
                                  <Input
                                    autoComplete="one-time-code"
                                    inputMode="numeric"
                                    maxLength={8}
                                    minLength={4}
                                    onChange={(event) =>
                                      setApprovalPin(event.target.value.replace(/\D/g, ""))
                                    }
                                    type="password"
                                    value={approvalPin}
                                  />
                                </Label>
                              )}
                              <div className="dialog-actions">
                                {!canApproveAdjustments && (
                                  <>
                                    <Button
                                      disabled={
                                        busy ||
                                        !approvalItemId ||
                                        approvalReason.trim().length < 3 ||
                                        discountReais <= 0
                                      }
                                      onClick={() =>
                                        void mutate(
                                          () =>
                                            api.pilot.requestApproval(
                                              scope.organizationId,
                                              scope.unitId,
                                              tabId,
                                              {
                                                itemId: approvalItemId,
                                                action: "discount",
                                                discountCents: Math.round(discountReais * 100),
                                                reason: approvalReason.trim(),
                                              },
                                              crypto.randomUUID(),
                                            ),
                                          "Desconto enviado para aprovação.",
                                        )
                                      }
                                      size="sm"
                                      variant="secondary"
                                    >
                                      Solicitar desconto
                                    </Button>
                                    <Button
                                      disabled={
                                        busy || !approvalItemId || approvalReason.trim().length < 3
                                      }
                                      onClick={() =>
                                        void mutate(
                                          () =>
                                            api.pilot.requestApproval(
                                              scope.organizationId,
                                              scope.unitId,
                                              tabId,
                                              {
                                                itemId: approvalItemId,
                                                action: "cancel",
                                                reason: approvalReason.trim(),
                                              },
                                              crypto.randomUUID(),
                                            ),
                                          "Cancelamento enviado para aprovação.",
                                        )
                                      }
                                      size="sm"
                                      variant="danger"
                                    >
                                      Solicitar cancelamento
                                    </Button>
                                  </>
                                )}
                                {canApproveAdjustments && (
                                  <>
                                    <Button
                                      disabled={
                                        busy ||
                                        !approvalItemId ||
                                        approvalPin.length < 4 ||
                                        approvalReason.trim().length < 3 ||
                                        discountReais <= 0
                                      }
                                      onClick={() =>
                                        void mutate(
                                          () =>
                                            scope.dispatch(
                                              "pos.item.discount_requested",
                                              pilotMutation("discount-item", {
                                                itemId: approvalItemId,
                                                body: {
                                                  discountCents: Math.round(discountReais * 100),
                                                  approval: {
                                                    approverMembershipId: scope.membershipId,
                                                    pin: approvalPin,
                                                    reason: approvalReason.trim(),
                                                  },
                                                },
                                              }),
                                              (key) =>
                                                api.pilot.discountItem(
                                                  scope.organizationId,
                                                  scope.unitId,
                                                  approvalItemId,
                                                  {
                                                    discountCents: Math.round(discountReais * 100),
                                                    approval: {
                                                      approverMembershipId: scope.membershipId,
                                                      pin: approvalPin,
                                                      reason: approvalReason.trim(),
                                                    },
                                                  },
                                                  key,
                                                ),
                                            ),
                                          "Desconto aprovado e aplicado.",
                                        )
                                      }
                                      size="sm"
                                      variant="secondary"
                                    >
                                      Aplicar desconto
                                    </Button>
                                    <Button
                                      disabled={
                                        busy ||
                                        !approvalItemId ||
                                        approvalPin.length < 4 ||
                                        approvalReason.trim().length < 3
                                      }
                                      onClick={() =>
                                        void mutate(
                                          () =>
                                            scope.dispatch(
                                              "pos.item.cancel_requested",
                                              pilotMutation("cancel-item", {
                                                itemId: approvalItemId,
                                                approval: {
                                                  approverMembershipId: scope.membershipId,
                                                  pin: approvalPin,
                                                  reason: approvalReason.trim(),
                                                },
                                              }),
                                              (key) =>
                                                api.pilot.cancelItem(
                                                  scope.organizationId,
                                                  scope.unitId,
                                                  approvalItemId,
                                                  {
                                                    approverMembershipId: scope.membershipId,
                                                    pin: approvalPin,
                                                    reason: approvalReason.trim(),
                                                  },
                                                  key,
                                                ),
                                            ),
                                          "Item cancelado com aprovação.",
                                        )
                                      }
                                      size="sm"
                                      variant="danger"
                                    >
                                      Cancelar item
                                    </Button>
                                  </>
                                )}
                              </div>
                            </form>
                          )}
                        </div>
                      ))}
                    </div>
                    {tabOpen &&
                      data.tab.totalCents > 0 &&
                      remainingCents === 0 &&
                      terminalPaymentMode !== "disabled" && (
                        <div className="account-close-actions">
                          {localPrintingEnabled && (
                            <Button
                              disabled={busy}
                              onClick={() => {
                                if (
                                  !window.confirm(
                                    `Encerrar ${displayLabel} e imprimir o comprovante final?`,
                                  )
                                )
                                  return;
                                void closeAndPrint();
                              }}
                              size="sm"
                            >
                              Encerrar e imprimir
                            </Button>
                          )}
                          <Button
                            disabled={busy}
                            onClick={() =>
                              window.confirm(
                                `Encerrar ${displayLabel} sem imprimir comprovante?`,
                              ) &&
                              void mutate(
                                () => closeTabWithReturnableCheck({ printRequested: false }),
                                "Atendimento encerrado.",
                              )
                            }
                            size="sm"
                            variant="secondary"
                          >
                            Encerrar sem imprimir
                          </Button>
                        </div>
                      )}
                  </section>
                )}
                {tabOpen && view !== "order" && view !== "activity" && (
                  <section className={`workspace-tools workspace-tools--${view}`}>
                    <div className="workspace-tools__heading">
                      <strong>
                        {view === "account" ? "Receber e ajustar conta" : "Ações da mesa"}
                      </strong>
                      <small>
                        {view === "account"
                          ? "Pagamento, taxa, gorjeta e correções por item."
                          : "Transferência e organização do atendimento."}
                      </small>
                    </div>
                    <details className="ops-actions" open={view === "account" ? true : undefined}>
                      <summary>
                        {view === "account"
                          ? "Receber pagamento e fazer ajustes"
                          : "Ajustes da comanda"}
                      </summary>
                      <div className="action-grid">
                        <form
                          hidden={view !== "table"}
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (transferTableId)
                              void mutate(
                                () =>
                                  scope.dispatch(
                                    "pos.tab.transfer_requested",
                                    pilotMutation("transfer-tab", {
                                      tabId,
                                      body: {
                                        tableId: transferTableId,
                                        reason: "Transferência solicitada na operação",
                                      },
                                    }),
                                    (key) =>
                                      api.pilot.transferTab(
                                        scope.organizationId,
                                        scope.unitId,
                                        tabId,
                                        {
                                          tableId: transferTableId,
                                          reason: "Transferência solicitada na operação",
                                        },
                                        key,
                                      ),
                                  ),
                                "Comanda transferida.",
                              );
                          }}
                        >
                          <h3>Transferir mesa</h3>
                          <NativeSelect
                            onChange={(event) => setTransferTableId(event.target.value)}
                            value={transferTableId}
                          >
                            <option value="">Selecione mesa livre</option>
                            {availableTables.map((table) => (
                              <option key={table.id} value={table.id}>
                                {table.label}
                              </option>
                            ))}
                          </NativeSelect>
                          <Button disabled={busy || !transferTableId} size="sm" type="submit">
                            Transferir
                          </Button>
                        </form>
                        <form
                          hidden={view !== "table"}
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (!moveItemId || !moveTargetTabId) return;
                            void mutate(
                              () =>
                                scope.dispatch(
                                  "pos.items.move_requested",
                                  pilotMutation("move-items", {
                                    tabId,
                                    body: {
                                      targetTabId: moveTargetTabId,
                                      items: [{ orderItemId: moveItemId, quantity: 1 }],
                                    },
                                  }),
                                  (key) =>
                                    api.pilot.moveItems(
                                      scope.organizationId,
                                      scope.unitId,
                                      tabId,
                                      {
                                        targetTabId: moveTargetTabId,
                                        items: [{ orderItemId: moveItemId, quantity: 1 }],
                                      },
                                      key,
                                    ),
                                ),
                              "Item transferido entre comandas.",
                            );
                          }}
                        >
                          <h3>Transferir item</h3>
                          <NativeSelect
                            onChange={(event) => setMoveItemId(event.target.value)}
                            value={moveItemId}
                          >
                            <option value="">Item em espera</option>
                            {activeItems
                              .filter((item) => item.status === "draft")
                              .map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.quantity}× {item.productName}
                                </option>
                              ))}
                          </NativeSelect>
                          <NativeSelect
                            onChange={(event) => setMoveTargetTabId(event.target.value)}
                            value={moveTargetTabId}
                          >
                            <option value="">Comanda de destino</option>
                            {mergeTargets.map((target) => (
                              <option key={target.id} value={target.id}>
                                {targetLabel(target)}
                              </option>
                            ))}
                          </NativeSelect>
                          <Button
                            disabled={busy || !moveItemId || !moveTargetTabId}
                            size="sm"
                            type="submit"
                          >
                            Transferir item
                          </Button>
                        </form>
                        <form
                          className="cashier-payment-form"
                          hidden={view !== "account" || !cashierPaymentEnabled}
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (paymentReais <= 0) return;
                            const changeReais = Math.max(0, cashReceivedReais - paymentReais);
                            const reference =
                              paymentReference.trim() ||
                              (paymentMethod === "cash" && cashReceivedReais > 0
                                ? `Recebido ${formatMoney(Math.round(cashReceivedReais * 100))}; troco ${formatMoney(Math.round(changeReais * 100))}`
                                : undefined);
                            const installationId =
                              readActiveTerminalProfile(scope.unitId)?.installationId ?? undefined;
                            void mutate(
                              () =>
                                scope.dispatch(
                                  "pos.payment.record_requested",
                                  pilotMutation("record-payment", {
                                    tabId,
                                    body: {
                                      method: paymentMethod,
                                      amountCents: Math.round(paymentReais * 100),
                                      reference,
                                      installationId,
                                    },
                                  }),
                                  (key) =>
                                    api.pilot.recordPayment(
                                      scope.organizationId,
                                      scope.unitId,
                                      tabId,
                                      {
                                        method: paymentMethod,
                                        amountCents: Math.round(paymentReais * 100),
                                        reference,
                                        installationId,
                                      },
                                      key,
                                    ),
                                ),
                              paymentMethod === "cash"
                                ? `Pagamento registrado · troco ${formatMoney(Math.round(changeReais * 100))}.`
                                : "Pagamento parcial registrado.",
                            ).then((saved) => {
                              if (!saved) return;
                              setPaymentReais(0);
                              setPaymentReference("");
                              setCashReceivedReais(0);
                            });
                          }}
                        >
                          <h3>Receber pagamento</h3>
                          <p>
                            Pago {formatMoney(paidCents)} · falta {formatMoney(remainingCents)}
                          </p>
                          <fieldset className="cashier-payment-form__shortcuts">
                            <legend className="gm-sr-only">Atalhos para receber a conta</legend>
                            <Button
                              className="cashier-payment-form__full"
                              onClick={prepareFullCashierPayment}
                              type="button"
                            >
                              Conta inteira · {formatMoney(remainingCents)}
                            </Button>
                            <Button
                              onClick={() => setPaymentReais(remainingCents / 400)}
                              type="button"
                              variant="secondary"
                            >
                              25%
                            </Button>
                            <Button
                              onClick={() => setPaymentReais(remainingCents / 200)}
                              type="button"
                              variant="secondary"
                            >
                              50%
                            </Button>
                            <Button
                              onClick={() =>
                                setPaymentReais(
                                  remainingCents / Math.max(1, data.tab.guestCount) / 100,
                                )
                              }
                              type="button"
                              variant="secondary"
                            >
                              1 pessoa
                            </Button>
                            <Button
                              onClick={() => {
                                setPaymentReais(0);
                              }}
                              type="button"
                              variant="secondary"
                            >
                              Valor livre
                            </Button>
                          </fieldset>
                          <div className="cashier-payment-form__fields">
                            <Label>
                              Forma de pagamento
                              <NativeSelect
                                onChange={(event) =>
                                  setPaymentMethod(event.target.value as typeof paymentMethod)
                                }
                                value={paymentMethod}
                              >
                                <option value="cash">Dinheiro</option>
                                <option value="other">Outro não eletrônico</option>
                              </NativeSelect>
                            </Label>
                            <Label>
                              Valor a receber
                              <Input
                                ref={paymentAmountRef}
                                min={0.01}
                                onChange={(event) => setPaymentReais(Number(event.target.value))}
                                step="0.01"
                                type="number"
                                value={paymentReais}
                              />
                            </Label>
                          </div>
                          {paymentMethod === "cash" && (
                            <Label className="cash-change-field">
                              <span>Valor recebido</span>
                              <Input
                                min={paymentReais}
                                onChange={(event) =>
                                  setCashReceivedReais(Number(event.target.value))
                                }
                                step="0.01"
                                type="number"
                                value={cashReceivedReais}
                              />
                              <strong>
                                Troco:{" "}
                                {formatMoney(
                                  Math.round(Math.max(0, cashReceivedReais - paymentReais) * 100),
                                )}
                              </strong>
                            </Label>
                          )}
                          <Label className="cashier-payment-form__reference">
                            Referência opcional
                            <Input
                              onChange={(event) => setPaymentReference(event.target.value)}
                              placeholder="Ex.: identificação ou observação"
                              value={paymentReference}
                            />
                          </Label>
                          <Button
                            className="cashier-payment-form__submit"
                            disabled={
                              busy ||
                              paymentReais <= 0 ||
                              Math.round(paymentReais * 100) > remainingCents ||
                              (paymentMethod === "cash" && cashReceivedReais < paymentReais)
                            }
                            size="sm"
                            type="submit"
                          >
                            Registrar pagamento
                          </Button>
                        </form>
                        <form
                          hidden={view !== "table"}
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (mergeTabId)
                              void mutate(
                                () =>
                                  scope.dispatch(
                                    "pos.tabs.merge_requested",
                                    pilotMutation("merge-tabs", {
                                      body: {
                                        targetTabId: tabId,
                                        sourceTabIds: [mergeTabId],
                                        reasonCode: mergeReasonCode,
                                        ...(mergeReasonNote.trim()
                                          ? { reasonNote: mergeReasonNote.trim() }
                                          : {}),
                                      },
                                    }),
                                    (key) =>
                                      api.pilot.mergeTabs(
                                        scope.organizationId,
                                        scope.unitId,
                                        {
                                          targetTabId: tabId,
                                          sourceTabIds: [mergeTabId],
                                          reasonCode: mergeReasonCode,
                                          ...(mergeReasonNote.trim()
                                            ? { reasonNote: mergeReasonNote.trim() }
                                            : {}),
                                        },
                                        key,
                                      ),
                                  ),
                                "Comandas unificadas.",
                              );
                          }}
                        >
                          <h3>Unificar comandas</h3>
                          <NativeSelect
                            onChange={(event) => setMergeTabId(event.target.value)}
                            value={mergeTabId}
                          >
                            <option value="">Selecione a origem</option>
                            {mergeTargets.map((tab) => (
                              <option key={tab.id} value={tab.id}>
                                {targetLabel(tab)}
                              </option>
                            ))}
                          </NativeSelect>
                          <NativeSelect
                            aria-label="Motivo para unificar comandas"
                            onChange={(event) =>
                              setMergeReasonCode(event.target.value as typeof mergeReasonCode)
                            }
                            value={mergeReasonCode}
                          >
                            <option value="sit_together">Clientes querem sentar juntos</option>
                            <option value="large_party">Grupo ou família grande</option>
                            <option value="accessibility">Necessidade de acessibilidade</option>
                            <option value="operational_reorganization">
                              Reorganização operacional
                            </option>
                            <option value="other">Outro</option>
                          </NativeSelect>
                          {(mergeReasonCode === "other" || mergeReasonNote) && (
                            <Input
                              aria-label="Detalhe do motivo da unificação"
                              maxLength={500}
                              onChange={(event) => setMergeReasonNote(event.target.value)}
                              placeholder="Detalhe o motivo"
                              value={mergeReasonNote}
                            />
                          )}
                          <Button
                            disabled={
                              busy ||
                              !mergeTabId ||
                              (mergeReasonCode === "other" && mergeReasonNote.trim().length < 3)
                            }
                            size="sm"
                            type="submit"
                          >
                            Unificar aqui
                          </Button>
                        </form>
                        <form
                          hidden={view !== "account"}
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (splitItemId)
                              void mutate(
                                () =>
                                  scope.dispatch(
                                    "pos.tab.split_requested",
                                    pilotMutation("split-tab", {
                                      tabId,
                                      body: {
                                        label: splitLabel.trim() || "Conta separada",
                                        items: [
                                          { orderItemId: splitItemId, quantity: splitQuantity },
                                        ],
                                      },
                                    }),
                                    (key) =>
                                      api.pilot.splitTab(
                                        scope.organizationId,
                                        scope.unitId,
                                        tabId,
                                        {
                                          label: splitLabel.trim() || "Conta separada",
                                          items: [
                                            { orderItemId: splitItemId, quantity: splitQuantity },
                                          ],
                                        },
                                        key,
                                      ),
                                  ),
                                (result) =>
                                  `Item separado em nova comanda. ${result.printJobs.length} via(s) foram criadas na fila de impressão.`,
                                (result) => {
                                  const localJobs = result.printJobs.map(printJobFromServer);
                                  setPrintJobs((current) =>
                                    [...localJobs, ...current].slice(0, 12),
                                  );
                                },
                              );
                          }}
                        >
                          <h3>Separar item</h3>
                          <Input
                            aria-label="Nome da nova comanda"
                            maxLength={120}
                            onChange={(event) => setSplitLabel(event.target.value)}
                            placeholder="Nome da nova comanda"
                            value={splitLabel}
                          />
                          <NativeSelect
                            onChange={(event) => setSplitItemId(event.target.value)}
                            value={splitItemId}
                          >
                            <option value="">Selecione</option>
                            {activeItems.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.quantity}× {item.productName}
                              </option>
                            ))}
                          </NativeSelect>
                          <Input
                            min={1}
                            onChange={(event) => setSplitQuantity(Number(event.target.value))}
                            type="number"
                            value={splitQuantity}
                          />
                          <Button disabled={busy || !splitItemId} size="sm" type="submit">
                            Separar
                          </Button>
                        </form>
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            void mutate(
                              () =>
                                scope.dispatch(
                                  "pos.tab.service_charge_requested",
                                  pilotMutation("service-charge", {
                                    tabId,
                                    basisPoints: Math.round(servicePercent * 100),
                                  }),
                                  (key) =>
                                    api.pilot.serviceCharge(
                                      scope.organizationId,
                                      scope.unitId,
                                      tabId,
                                      Math.round(servicePercent * 100),
                                      key,
                                    ),
                                ),
                              "Taxa de serviço atualizada.",
                            );
                          }}
                          hidden={view !== "account" || !canAdjustCharges}
                        >
                          <h3>Serviço</h3>
                          <Label>
                            Percentual
                            <Input
                              max={100}
                              min={0}
                              onChange={(event) => setServicePercent(Number(event.target.value))}
                              step="0.01"
                              type="number"
                              value={servicePercent}
                            />
                          </Label>
                          <Button disabled={busy} size="sm" type="submit">
                            Aplicar
                          </Button>
                        </form>
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            void mutate(
                              () =>
                                scope.dispatch(
                                  "pos.tab.tip_requested",
                                  pilotMutation("tip", {
                                    tabId,
                                    tipCents: Math.round(tipReais * 100),
                                  }),
                                  (key) =>
                                    api.pilot.tip(
                                      scope.organizationId,
                                      scope.unitId,
                                      tabId,
                                      Math.round(tipReais * 100),
                                      key,
                                    ),
                                ),
                              "Gorjeta atualizada.",
                            );
                          }}
                          hidden={view !== "account" || !canAdjustCharges}
                        >
                          <h3>Gorjeta</h3>
                          <Label>
                            Valor em reais
                            <Input
                              min={0}
                              onChange={(event) => setTipReais(Number(event.target.value))}
                              step="0.01"
                              type="number"
                              value={tipReais}
                            />
                          </Label>
                          <Button disabled={busy} size="sm" type="submit">
                            Aplicar
                          </Button>
                        </form>
                      </div>
                    </details>
                  </section>
                )}
                {tabOpen &&
                  view === "table" &&
                  (data.tab.fulfillmentType === "pickup" ||
                    data.tab.fulfillmentType === "delivery") && (
                    <Card className="pickup-ready-card">
                      <div>
                        <strong>
                          {data.tab.readyNotifiedAt
                            ? "Cliente avisado"
                            : "Pedido pronto para saída?"}
                        </strong>
                        <small>
                          {data.tab.readyNotifiedAt
                            ? new Date(data.tab.readyNotifiedAt).toLocaleString("pt-BR")
                            : data.tab.customerPhone
                              ? "Registra o aviso para envio pelo canal homologado."
                              : "Sem telefone: sinaliza retirada no balcão."}
                        </small>
                      </div>
                      <Button
                        disabled={busy || Boolean(data.tab.readyNotifiedAt)}
                        onClick={() =>
                          void mutate(
                            () =>
                              scope.dispatch(
                                "pos.tab.ready_notification_requested",
                                pilotMutation("notify-ready", { tabId }),
                                (key) =>
                                  api.pilot.notifyReady(
                                    scope.organizationId,
                                    scope.unitId,
                                    tabId,
                                    key,
                                  ),
                              ),
                            data.tab.customerPhone
                              ? "Aviso de pedido pronto colocado na fila."
                              : "Pedido marcado como pronto para retirada.",
                          )
                        }
                        size="sm"
                      >
                        Marcar pronto e avisar
                      </Button>
                    </Card>
                  )}
                {view === "activity" && (
                  <section className="tab-timeline activity-panel">
                    <div className="activity-panel__heading">
                      <div>
                        <strong>Atividade da conta</strong>
                        <small>Registro cronológico de pedidos, pagamentos e ajustes.</small>
                      </div>
                      <Button onClick={() => setView("order")} size="sm" variant="ghost">
                        Voltar ao pedido
                      </Button>
                    </div>
                    <ol>
                      {data.events.map((event) => (
                        <li key={event.id}>
                          <strong>{activityLabels[event.type] ?? "Atualização da conta"}</strong>
                          <span>{event.actorName}</span>
                          <time dateTime={event.createdAt}>
                            {new Date(event.createdAt).toLocaleString("pt-BR")}
                          </time>
                        </li>
                      ))}
                    </ol>
                  </section>
                )}
                {!tabOpen && canApproveAdjustments && (
                  <form
                    className="reopen-tab-panel"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void mutate(
                        () =>
                          api.pilot.reopenTab(
                            scope.organizationId,
                            scope.unitId,
                            tabId,
                            { pin: reopenPin, reason: reopenReason.trim() },
                            crypto.randomUUID(),
                          ),
                        "Atendimento reaberto com registro gerencial.",
                      );
                    }}
                  >
                    <div>
                      <strong>Reabrir atendimento encerrado</strong>
                      <small>Pagamentos e histórico permanecem registrados.</small>
                    </div>
                    <Label>
                      Motivo
                      <Input
                        list={`adjustment-reasons-${tabId}`}
                        minLength={3}
                        onChange={(event) => setReopenReason(event.target.value)}
                        value={reopenReason}
                      />
                    </Label>
                    <Label>
                      Seu código gerencial
                      <Input
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        maxLength={8}
                        minLength={4}
                        onChange={(event) => setReopenPin(event.target.value.replace(/\D/g, ""))}
                        type="password"
                        value={reopenPin}
                      />
                    </Label>
                    <Button
                      disabled={busy || reopenPin.length < 4 || reopenReason.trim().length < 3}
                      size="sm"
                      type="submit"
                    >
                      Reabrir
                    </Button>
                  </form>
                )}
                {integratedPaymentEnabled && (
                  <SmartPosPaymentModal
                    embedded={scope.embedded === true}
                    installationId={scope.installationId ?? ""}
                    isOpen={smartPosOpen}
                    onApproved={() => {
                      detail.retry();
                      tabs.retry();
                      onChanged();
                      setFeedback("Pagamento aprovado na maquininha.");
                    }}
                    onAttemptChange={setIntegratedAttempt}
                    onClose={() => setSmartPosOpen(false)}
                    organizationId={scope.organizationId}
                    remainingCents={remainingCents}
                    tabId={tabId}
                    unitId={scope.unitId}
                  />
                )}
                {tabOpen && (
                  <footer
                    aria-label="Ações rápidas do atendimento"
                    className="service-action-dock"
                    role="toolbar"
                  >
                    <div className="service-action-dock__status">
                      <strong>
                        {cart.length
                          ? `${cartQuantity} item(ns) · ${formatMoney(cartTotalCents)}`
                          : billCall
                            ? "Conta solicitada"
                            : "Atendimento sincronizado"}
                      </strong>
                      <small>
                        {cart.length
                          ? "Rascunho salvo automaticamente"
                          : online
                            ? "Pronto para a próxima ação"
                            : "Reconecta e reenvia ações preservadas"}
                      </small>
                    </div>
                    <div className="service-action-dock__actions">
                      {compactHeading && cart.length > 0 && (
                        <>
                          <Button
                            disabled={busy}
                            onClick={() => void submitCart(false)}
                            size="sm"
                            variant="secondary"
                          >
                            Manter em espera
                          </Button>
                          <Button disabled={busy} onClick={() => void submitCart(true)} size="sm">
                            Enviar pedido ({cartQuantity})
                          </Button>
                        </>
                      )}
                      {!cart.length && data.tab.tableId && (
                        <Button
                          disabled={busy || billRequestPending || Boolean(billCall)}
                          onClick={() => void requestBillAndPrint()}
                          size="sm"
                          variant={billCall ? "ghost" : "secondary"}
                        >
                          {billCall
                            ? "Conta solicitada"
                            : billRequestPending
                              ? "Solicitando…"
                              : "Pedir conta"}
                        </Button>
                      )}
                      {!cart.length && (
                        <Button
                          onClick={() =>
                            terminalPaymentMode === "disabled"
                              ? void requestBillAndPrint()
                              : openReceive()
                          }
                          size="sm"
                          variant="ghost"
                        >
                          {terminalPaymentMode === "disabled"
                            ? "Pedir conta ao caixa"
                            : terminalPaymentMode === "homologated_pos"
                              ? "Cobrar na POS"
                              : "Receber no caixa"}
                        </Button>
                      )}
                      <Button onClick={() => setView("table")} size="sm" variant="ghost">
                        Dados e ações
                      </Button>
                    </div>
                  </footer>
                )}
                {browserPrintJob && (
                  <BrowserReceipt
                    documentType={browserPrintJob.documentType}
                    payload={browserPrintJob.payload}
                  />
                )}
              </section>
            );
          }}
        </RemoteGate>
      )}
    </RemoteGate>
  );
}
