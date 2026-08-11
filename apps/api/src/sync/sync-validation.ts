import { MAX_SYNC_BATCH_EVENTS } from "@giromesa/domain";
import type { ZodError, ZodType } from "zod";
import { ZodPipe } from "../common/zod.pipe.js";
import { syncBatchSchema } from "./sync.schemas.js";

export const SYNC_EVENT_SCHEMA_INVALID = "SYNC_EVENT_SCHEMA_INVALID";
export const SYNC_BATCH_SCHEMA_INVALID = "SYNC_BATCH_SCHEMA_INVALID";
export const SYNC_ACK_SCHEMA_INVALID = "SYNC_ACK_SCHEMA_INVALID";

export type SyncValidationProblem =
  | {
      code: typeof SYNC_EVENT_SCHEMA_INVALID;
      scope: "event";
      eventIndexes: number[];
    }
  | {
      code: typeof SYNC_BATCH_SCHEMA_INVALID;
      scope: "batch";
    }
  | {
      code: typeof SYNC_ACK_SCHEMA_INVALID;
      scope: "ack";
    };

export function syncValidationProblem(value: unknown, error: ZodError): SyncValidationProblem {
  const events =
    value && typeof value === "object" && Array.isArray(Reflect.get(value, "events"))
      ? (Reflect.get(value, "events") as unknown[])
      : null;
  const indexes = error.issues.map((issue) => issue.path[1]);
  const isSafelyEventScoped =
    events !== null &&
    events.length <= MAX_SYNC_BATCH_EVENTS &&
    error.issues.length > 0 &&
    error.issues.every(
      (issue) =>
        issue.path[0] === "events" &&
        typeof issue.path[1] === "number" &&
        Number.isInteger(issue.path[1]) &&
        issue.path[1] >= 0 &&
        issue.path[1] < events.length,
    );
  if (isSafelyEventScoped) {
    return {
      code: SYNC_EVENT_SCHEMA_INVALID,
      scope: "event",
      eventIndexes: [...new Set(indexes as number[])].sort((left, right) => left - right),
    };
  }

  const isAckScoped =
    error.issues.length > 0 &&
    error.issues.every((issue) => issue.path[0] === "acknowledgedCommandIds");
  if (isAckScoped) return { code: SYNC_ACK_SCHEMA_INVALID, scope: "ack" };

  return { code: SYNC_BATCH_SCHEMA_INVALID, scope: "batch" };
}

export class SyncBatchPipe extends ZodPipe {
  constructor(schema: ZodType = syncBatchSchema) {
    super(schema, syncValidationProblem);
  }
}
