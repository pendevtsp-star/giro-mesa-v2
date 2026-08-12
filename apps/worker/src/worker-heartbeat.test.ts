import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it } from "node:test";
import { createWorkerHeartbeat, DEFAULT_WORKER_HEARTBEAT_FILE } from "./worker-heartbeat.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function heartbeatPath() {
  const directory = await mkdtemp(join(tmpdir(), "giromesa-worker-heartbeat-"));
  temporaryDirectories.push(directory);
  return join(directory, "heartbeat");
}

it("uses the documented heartbeat path by default", () => {
  assert.equal(DEFAULT_WORKER_HEARTBEAT_FILE, "/tmp/giromesa-worker-heartbeat");
});

it("atomically publishes successful-cycle metadata", async () => {
  const filePath = await heartbeatPath();
  const heartbeat = createWorkerHeartbeat(
    { WORKER_HEARTBEAT_FILE: filePath },
    { now: () => 1_723_456_789_000, owner: "worker-a", pid: 123 },
  );

  await heartbeat.recordSuccessfulCycle();

  assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), {
    owner: "worker-a",
    pid: 123,
    updatedAtMs: 1_723_456_789_000,
  });
  assert.deepEqual(await readdir(join(filePath, "..")), ["heartbeat"]);
});

it("optional cleanup removes only the heartbeat last written by this instance", async () => {
  const filePath = await heartbeatPath();
  const env = {
    WORKER_HEARTBEAT_CLEANUP_ON_SHUTDOWN: "true",
    WORKER_HEARTBEAT_FILE: filePath,
  };
  const retiringWorker = createWorkerHeartbeat(env, {
    now: () => 100,
    owner: "retiring-worker",
    pid: 123,
  });
  const successorWorker = createWorkerHeartbeat(env, {
    now: () => 200,
    owner: "successor-worker",
    pid: 456,
  });

  await retiringWorker.recordSuccessfulCycle();
  await successorWorker.recordSuccessfulCycle();
  await retiringWorker.cleanup();

  assert.equal(JSON.parse(await readFile(filePath, "utf8")).owner, "successor-worker");
  await successorWorker.cleanup();
  await assert.rejects(readFile(filePath, "utf8"), { code: "ENOENT" });
});

it("preserves its heartbeat on shutdown unless cleanup is enabled", async () => {
  const filePath = await heartbeatPath();
  const heartbeat = createWorkerHeartbeat(
    { WORKER_HEARTBEAT_FILE: filePath },
    { now: () => 100, owner: "worker-a", pid: 123 },
  );

  await heartbeat.recordSuccessfulCycle();
  await heartbeat.cleanup();

  assert.equal(JSON.parse(await readFile(filePath, "utf8")).owner, "worker-a");
});
