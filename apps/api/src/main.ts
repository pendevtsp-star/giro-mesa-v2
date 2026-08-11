import { startApiProcess } from "./process-runtime.js";

void startApiProcess().catch(() => {
  process.stderr.write("API startup failed\n");
  process.exitCode = 1;
});
