export const BILLING_STATES = [
  "draft",
  "onboarding",
  "trial_active",
  "active",
  "grace",
  "restricted",
  "suspended",
  "canceled",
] as const;

export type BillingState = (typeof BILLING_STATES)[number];
export type BillingEvent =
  | "START_ONBOARDING"
  | "ACTIVATE_TRIAL"
  | "CONFIRM_PAYMENT"
  | "TRIAL_EXPIRED"
  | "PAYMENT_OVERDUE"
  | "GRACE_EXPIRED"
  | "SUSPEND"
  | "RESTORE"
  | "CANCEL";

const transitions: Record<BillingState, Partial<Record<BillingEvent, BillingState>>> = {
  draft: { START_ONBOARDING: "onboarding", CANCEL: "canceled" },
  onboarding: { ACTIVATE_TRIAL: "trial_active", CANCEL: "canceled" },
  trial_active: { CONFIRM_PAYMENT: "active", TRIAL_EXPIRED: "restricted", CANCEL: "canceled" },
  active: { PAYMENT_OVERDUE: "grace", SUSPEND: "suspended", CANCEL: "canceled" },
  grace: {
    CONFIRM_PAYMENT: "active",
    GRACE_EXPIRED: "restricted",
    SUSPEND: "suspended",
    CANCEL: "canceled",
  },
  restricted: { CONFIRM_PAYMENT: "active", SUSPEND: "suspended", CANCEL: "canceled" },
  suspended: { RESTORE: "active", CANCEL: "canceled" },
  canceled: {},
};

export type AccessMode = "full" | "finish_shift" | "read_billing_export_support" | "none";

export function transitionBilling(current: BillingState, event: BillingEvent): BillingState {
  const next = transitions[current][event];
  if (!next) throw new Error(`Invalid billing transition: ${current} -> ${event}`);
  return next;
}

export function billingAccess(
  state: BillingState,
  now: Date,
  operationalClosureUntil?: Date | null,
): AccessMode {
  if (state === "trial_active" || state === "active" || state === "grace") return "full";
  if (state === "restricted" && operationalClosureUntil && now <= operationalClosureUntil)
    return "finish_shift";
  if (state === "restricted" || state === "suspended" || state === "canceled") {
    return "read_billing_export_support";
  }
  return "none";
}
