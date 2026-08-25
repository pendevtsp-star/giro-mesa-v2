import type { ProductionPrintJobStatus } from "../../api";

export type ProductionPrintJobAction = "reprint" | "retry_failed" | "resolve_unknown" | null;

export function productionPrintJobAction(
  status: ProductionPrintJobStatus,
): ProductionPrintJobAction {
  if (status === "printed") return "reprint";
  if (status === "failed") return "retry_failed";
  if (status === "confirmation_required") return "resolve_unknown";
  return null;
}
