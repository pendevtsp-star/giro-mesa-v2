export const PRIVACY_REQUIRED_DOMAINS = [
  "identity",
  "organization_membership",
  "operations",
  "management_finance",
  "growth_crm",
  "objects_media",
  "offline_edge",
  "backups",
] as const;

export type PrivacyDomain = (typeof PRIVACY_REQUIRED_DOMAINS)[number];
export type PrivacyRequestState =
  | "verification_pending"
  | "approval_pending"
  | "processing"
  | "partial"
  | "completed"
  | "rejected"
  | "failed";
export type PrivacyStepStatus = "pending" | "processing" | "completed" | "blocked" | "failed";

export interface PrivacyStepPlan {
  domain: PrivacyDomain;
  mandatory: boolean;
  status: PrivacyStepStatus;
  reasonCode?: "PROCESSOR_ABSENT";
}

export interface PrivacyExecutionPlan {
  available: PrivacyDomain[];
  blocked: PrivacyDomain[];
  steps: PrivacyStepPlan[];
}

export function privacyExecutionPlan(registered: ReadonlySet<string>): PrivacyExecutionPlan {
  const available = PRIVACY_REQUIRED_DOMAINS.filter((domain) => registered.has(domain));
  const blocked = PRIVACY_REQUIRED_DOMAINS.filter((domain) => !registered.has(domain));
  return {
    available,
    blocked,
    steps: PRIVACY_REQUIRED_DOMAINS.map((domain) =>
      registered.has(domain)
        ? { domain, mandatory: true, status: "pending" }
        : { domain, mandatory: true, status: "blocked", reasonCode: "PROCESSOR_ABSENT" },
    ),
  };
}

export function privacyCompletionState(
  steps: readonly Pick<PrivacyStepPlan, "mandatory" | "status">[],
): "processing" | "partial" | "completed" | "failed" {
  if (steps.some((step) => step.mandatory && step.status === "failed")) return "failed";
  if (steps.some((step) => step.mandatory && step.status === "blocked")) return "partial";
  if (steps.length > 0 && steps.every((step) => !step.mandatory || step.status === "completed")) {
    return "completed";
  }
  return "processing";
}

const transitions: Readonly<Record<PrivacyRequestState, readonly PrivacyRequestState[]>> = {
  verification_pending: ["approval_pending", "rejected"],
  approval_pending: ["processing", "rejected"],
  processing: ["partial", "completed", "failed"],
  partial: ["processing", "rejected"],
  completed: [],
  rejected: [],
  failed: ["processing", "rejected"],
};

export function assertPrivacyTransition(from: PrivacyRequestState, to: PrivacyRequestState) {
  if (!transitions[from].includes(to)) {
    throw new Error(`PRIVACY_TRANSITION_INVALID:${from}:${to}`);
  }
}

const AUDIT_KEYS = new Set(["domain", "reasonCode", "requestType", "state", "attempt"]);

export function redactPrivacyMetadata(metadata: Readonly<Record<string, unknown>>) {
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => AUDIT_KEYS.has(key)));
}
