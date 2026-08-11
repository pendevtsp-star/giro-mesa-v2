import { startWorkerProcess } from "./process-runtime.js";

try {
  const workerProcess = await startWorkerProcess();
  await workerProcess.run();
} catch {
  process.stderr.write("Worker startup or runtime failed\n");
  process.exitCode = 1;
}
