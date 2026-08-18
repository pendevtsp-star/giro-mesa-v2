import { OutboxWorker } from "./outbox.js";

const worker = new OutboxWorker();
let stopping = false;
let nextMaintenanceAt = 0;
let nextReportScanAt = 0;

async function shutdown() {
  if (stopping) return;
  stopping = true;
  await worker.close();
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
  const processed = await worker.runOnce();
  if (processed === 0) await new Promise((resolve) => setTimeout(resolve, 1_000));
}
