export const TRIAL_DAYS = 14;
export const OPERATIONAL_CLOSURE_HOURS = 12;
export const PAYMENT_GRACE_DAYS = 7;

export const REQUIRED_ACTIVATION_ITEMS = [
  "business",
  "unit",
  "catalog",
  "team",
  "production",
  "cashier",
  "fiscalChoice",
  "training",
  "rehearsal",
] as const;

export type ActivationChecklist = Record<(typeof REQUIRED_ACTIVATION_ITEMS)[number], boolean>;

export function missingActivationItems(checklist: Partial<ActivationChecklist>): string[] {
  return REQUIRED_ACTIVATION_ITEMS.filter((item) => checklist[item] !== true);
}

export function trialWindow(activatedAt: Date) {
  const endsAt = new Date(activatedAt);
  endsAt.setUTCDate(endsAt.getUTCDate() + TRIAL_DAYS);
  return { startsAt: activatedAt, endsAt };
}
