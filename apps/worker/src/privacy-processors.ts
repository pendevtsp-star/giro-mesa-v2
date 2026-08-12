import { PRIVACY_REQUIRED_DOMAINS, type PrivacyDomain } from "@giromesa/domain";

export type PrivacyRequestType = "access_export" | "correction" | "anonymization" | "deletion";

export const REGISTERED_PRIVACY_PROCESSORS: ReadonlySet<PrivacyDomain> = new Set(
  PRIVACY_REQUIRED_DOMAINS,
);

export type PrivacyProcessorPolicy =
  | { outcome: "process" }
  | { outcome: "preflight" }
  | { outcome: "blocked"; reasonCode: string };

export function privacyProcessorPolicy(
  requestType: PrivacyRequestType,
  domain: PrivacyDomain,
): PrivacyProcessorPolicy {
  if (requestType === "access_export") return { outcome: "process" };
  if (domain === "backups") {
    return {
      outcome: "blocked",
      reasonCode: "BACKUP_RETENTION_POLICY_UNAPPROVED",
    };
  }
  return { outcome: "preflight" };
}

export function privacyProcessingAggregateId(requestId: string, attempt: number) {
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new Error("PRIVACY_ATTEMPT_INVALID");
  return `${requestId}:${attempt}`;
}
