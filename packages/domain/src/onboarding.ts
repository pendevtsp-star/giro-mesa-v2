export const TRIAL_DAYS = 14;
export const OPERATIONAL_CLOSURE_HOURS = 12;
export const PAYMENT_GRACE_DAYS = 7;

export const CHECKLIST_ITEMS = [
  "business",
  "unit",
  "plan",
  "fiscalChoice",
  "catalog",
  "tables",
  "team",
  "qr",
  "production",
  "cashier",
  "training",
  "rehearsal",
] as const;

/** @deprecated Use CHECKLIST_ITEMS. Kept for N-1 clients. */
export const REQUIRED_ACTIVATION_ITEMS = CHECKLIST_ITEMS;

export const WAIVABLE_ACTIVATION_ITEMS = ["fiscalChoice", "qr"] as const;
export const CHECKLIST_STATUSES = [
  "pending",
  "in_progress",
  "verified",
  "blocked",
  "not_applicable",
] as const;
export const CHECKLIST_SOURCES = [
  "system",
  "actor_attestation",
  "authorized_waiver",
  "legacy_import",
] as const;

export type ChecklistItem = (typeof CHECKLIST_ITEMS)[number];
export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number];
export type ChecklistSource = (typeof CHECKLIST_SOURCES)[number];
export type ActivationChecklist = Record<ChecklistItem, boolean>;

export type ChecklistEvidence = {
  status: ChecklistStatus;
  source: ChecklistSource;
  evidenceReference?: string | null;
  evidence?: Record<string, unknown>;
  actorIdentityId?: string | null;
  verifiedAt?: Date | string | null;
  waiverReason?: string | null;
};

export type StructuredActivationChecklist = Partial<Record<ChecklistItem, ChecklistEvidence>>;

const waivableItems = new Set<ChecklistItem>(WAIVABLE_ACTIVATION_ITEMS);

function isChecklistEvidence(value: unknown): value is ChecklistEvidence {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    typeof value.status === "string" &&
    CHECKLIST_STATUSES.includes(value.status as ChecklistStatus)
  );
}

export function normalizeLegacyChecklist(
  checklist: Readonly<Record<string, unknown>>,
): Record<ChecklistItem, ChecklistEvidence> {
  return Object.fromEntries(
    CHECKLIST_ITEMS.map((item) => {
      const value = checklist[item];
      if (isChecklistEvidence(value)) return [item, value];
      return [
        item,
        {
          status: value === true ? "in_progress" : "pending",
          source: "legacy_import",
        } satisfies ChecklistEvidence,
      ];
    }),
  ) as Record<ChecklistItem, ChecklistEvidence>;
}

export function checklistItemIsReady(item: ChecklistItem, evidence: ChecklistEvidence | undefined) {
  if (!evidence) return false;
  if (evidence.status === "verified") {
    return (
      evidence.source !== "legacy_import" &&
      typeof evidence.evidenceReference === "string" &&
      evidence.evidenceReference.length > 0
    );
  }
  return (
    evidence.status === "not_applicable" &&
    waivableItems.has(item) &&
    evidence.source === "authorized_waiver" &&
    typeof evidence.waiverReason === "string" &&
    evidence.waiverReason.trim().length >= 10 &&
    typeof evidence.actorIdentityId === "string" &&
    evidence.actorIdentityId.length > 0
  );
}

export function activationReadiness(checklist: StructuredActivationChecklist) {
  const missingItems = CHECKLIST_ITEMS.filter(
    (item) => !checklistItemIsReady(item, checklist[item]),
  );
  return { ready: missingItems.length === 0, missingItems };
}

export function missingActivationItems(
  checklist: Partial<ActivationChecklist> | StructuredActivationChecklist,
): string[] {
  const containsStructuredEvidence = Object.values(checklist).some(isChecklistEvidence);
  if (containsStructuredEvidence)
    return activationReadiness(checklist as StructuredActivationChecklist).missingItems;
  return CHECKLIST_ITEMS.filter((item) => checklist[item as keyof typeof checklist] !== true);
}

export const PROVISIONING_STATES = [
  "requested",
  "validating",
  "provisioning",
  "activating",
  "publishing",
  "retryable_failed",
  "compensating",
  "compensated",
  "terminal_failed",
  "completed",
] as const;

export const PROVISIONING_CHECKPOINTS = [
  "requested",
  "validated",
  "internal_provisioned",
  "activation_committed",
  "published",
  "compensated",
] as const;

export type ProvisioningState = (typeof PROVISIONING_STATES)[number];
export type ProvisioningCheckpoint = (typeof PROVISIONING_CHECKPOINTS)[number];

const provisioningTransitions: Readonly<Record<ProvisioningState, readonly ProvisioningState[]>> = {
  requested: ["validating", "retryable_failed", "terminal_failed"],
  validating: ["provisioning", "retryable_failed", "terminal_failed"],
  provisioning: ["activating", "retryable_failed", "compensating"],
  activating: ["publishing", "retryable_failed", "compensating"],
  publishing: ["completed", "retryable_failed", "compensating"],
  retryable_failed: ["validating", "provisioning", "activating", "publishing", "compensating"],
  compensating: ["compensated", "retryable_failed"],
  compensated: [],
  terminal_failed: [],
  completed: [],
};

export function assertProvisioningTransition(from: ProvisioningState, to: ProvisioningState) {
  if (!provisioningTransitions[from].includes(to)) {
    throw new Error(`Illegal provisioning transition: ${from} -> ${to}`);
  }
}

export function provisioningResumeState(
  state: ProvisioningState,
  checkpoint: ProvisioningCheckpoint,
): ProvisioningState {
  if (state !== "retryable_failed") return state;
  switch (checkpoint) {
    case "requested":
      return "validating";
    case "validated":
      return "provisioning";
    case "internal_provisioned":
      return "activating";
    case "activation_committed":
      return "publishing";
    case "published":
      return "publishing";
    case "compensated":
      return "compensating";
  }
}

export function trialWindow(activatedAt: Date) {
  const endsAt = new Date(activatedAt);
  endsAt.setUTCDate(endsAt.getUTCDate() + TRIAL_DAYS);
  return { startsAt: activatedAt, endsAt };
}
