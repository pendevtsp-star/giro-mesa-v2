import { OutboxWorker } from "./outbox.js";
import { createWorkerHeartbeat } from "./worker-heartbeat.js";

const worker = new OutboxWorker();
const heartbeat = createWorkerHeartbeat(process.env);
let stopping = false;
let nextMaintenanceAt = 0;
let nextReportScanAt = 0;
let nextTimeTrackingRetentionAt = 0;
let nextAccountantAttachmentRetentionAt = 0;
let nextInventoryIntegrityAt = 0;
let nextCrmAutomationAt = 0;

async function shutdown() {
  if (stopping) return;
  stopping = true;
  try {
    await heartbeat.cleanup();
  } finally {
    await worker.close();
  }
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

while (!stopping) {
  if (Date.now() >= nextMaintenanceAt) {
    await worker.expireAccessWindows();
    nextMaintenanceAt = Date.now() + 60_000;
  }
  if (Date.now() >= nextReportScanAt) {
    await worker.runDueReports();
    nextReportScanAt = Date.now() + 15_000;
  }
  if (Date.now() >= nextTimeTrackingRetentionAt) {
    await worker.redactExpiredTimeTrackingLocations();
    nextTimeTrackingRetentionAt = Date.now() + 24 * 60 * 60_000;
  }
  if (Date.now() >= nextAccountantAttachmentRetentionAt) {
    try {
      await worker.purgeExpiredAccountantAttachments();
      nextAccountantAttachmentRetentionAt = Date.now() + 24 * 60 * 60_000;
    } catch {
      console.error("ACCOUNTANT_ATTACHMENT_PURGE_FAILED");
      nextAccountantAttachmentRetentionAt = Date.now() + 60 * 60_000;
    }
  }
  if (Date.now() >= nextInventoryIntegrityAt) {
    try {
      await worker.runInventoryIntegrityChecks();
      nextInventoryIntegrityAt = Date.now() + 24 * 60 * 60_000;
    } catch {
      console.error("INVENTORY_INTEGRITY_CHECK_FAILED");
      nextInventoryIntegrityAt = Date.now() + 60 * 60_000;
    }
  }
  if (Date.now() >= nextCrmAutomationAt) {
    try {
      await worker.runCrmAutomations();
      nextCrmAutomationAt = Date.now() + 5 * 60_000;
    } catch {
      console.error("CRM_AUTOMATION_SCAN_FAILED");
      nextCrmAutomationAt = Date.now() + 60_000;
    }
  }
  const processed = await worker.runOnce();
  await heartbeat.recordSuccessfulCycle();
  if (processed === 0) await new Promise((resolve) => setTimeout(resolve, 1_000));
}
