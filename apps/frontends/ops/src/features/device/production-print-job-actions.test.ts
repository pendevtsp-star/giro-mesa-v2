import { describe, expect, it } from "vitest";
import { productionPrintJobAction } from "./production-print-job-actions";

describe("productionPrintJobAction", () => {
  it("separa reimpressão, nova tentativa e resolução manual", () => {
    expect(productionPrintJobAction("printed")).toBe("reprint");
    expect(productionPrintJobAction("failed")).toBe("retry_failed");
    expect(productionPrintJobAction("confirmation_required")).toBe("resolve_unknown");
  });

  it("não oferece ação enquanto o Edge ainda processa", () => {
    expect(productionPrintJobAction("queued")).toBeNull();
    expect(productionPrintJobAction("printing")).toBeNull();
  });
});
