import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it } from "node:test";
import { checkWorkerHeartbeat } from "./worker-healthcheck.js";

const directories: string[] = [];
afterEach(async () =>
  Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true }))),
);

it("fails closed for missing or stale heartbeats", async () => {
  const directory = await mkdtemp(join(tmpdir(), "giromesa-worker-healthcheck-"));
  directories.push(directory);
  const filePath = join(directory, "heartbeat");
  assert.equal(await checkWorkerHeartbeat({ WORKER_HEARTBEAT_FILE: filePath }), false);
  await writeFile(filePath, "ok", "utf8");
  const { mtimeMs } = await stat(filePath);
  const env = { WORKER_HEARTBEAT_FILE: filePath, WORKER_HEARTBEAT_MAX_AGE_MS: "30000" };
  assert.equal(await checkWorkerHeartbeat(env, () => mtimeMs + 30_000), true);
  assert.equal(await checkWorkerHeartbeat(env, () => mtimeMs + 30_001), false);
});
