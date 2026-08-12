import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it } from "node:test";
import { checkWorkerHeartbeat } from "./worker-healthcheck.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createHeartbeatFile() {
  const directory = await mkdtemp(join(tmpdir(), "giromesa-worker-healthcheck-"));
  temporaryDirectories.push(directory);
  const filePath = join(directory, "heartbeat");
  await writeFile(filePath, "heartbeat", "utf8");
  return filePath;
}

it("accepts a heartbeat whose age is at most the configured interval", async () => {
  const filePath = await createHeartbeatFile();
  const { mtimeMs } = await stat(filePath);
  const env = {
    WORKER_HEARTBEAT_FILE: filePath,
    WORKER_HEARTBEAT_MAX_AGE_MS: "30000",
  };

  assert.equal(await checkWorkerHeartbeat(env, () => mtimeMs + 30_000), true);
  assert.equal(await checkWorkerHeartbeat(env, () => mtimeMs + 30_001), false);
});

it("fails closed when the heartbeat is missing or the interval is invalid", async () => {
  const filePath = await heartbeatPathWithoutFile();

  assert.equal(
    await checkWorkerHeartbeat(
      { WORKER_HEARTBEAT_FILE: filePath, WORKER_HEARTBEAT_MAX_AGE_MS: "30000" },
      Date.now,
    ),
    false,
  );
  assert.equal(
    await checkWorkerHeartbeat(
      { WORKER_HEARTBEAT_FILE: filePath, WORKER_HEARTBEAT_MAX_AGE_MS: "invalid" },
      Date.now,
    ),
    false,
  );
});

async function heartbeatPathWithoutFile() {
  const directory = await mkdtemp(join(tmpdir(), "giromesa-worker-healthcheck-"));
  temporaryDirectories.push(directory);
  return join(directory, "missing-heartbeat");
}
