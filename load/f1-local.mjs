import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TABLE_COUNT = 120;
const TERMINAL_COUNT = 12;
const READ_P95_LIMIT_MS = 300;
const WRITE_P95_LIMIT_MS = 500;
const FAILURE_RATE_LIMIT = 0.001;

const apiUrl = process.env.F1_API_URL ?? "http://127.0.0.1:3217";
const durationSeconds = Number.parseInt(process.env.F1_DURATION_SECONDS ?? "60", 10);
const thinkTimeMs = Number.parseInt(process.env.F1_THINK_TIME_MS ?? "1000", 10);
const internalApiKey = process.env.F1_INTERNAL_API_KEY;
const parsedApiUrl = new URL(apiUrl);
if (!["127.0.0.1", "localhost", "::1"].includes(parsedApiUrl.hostname)) {
  throw new Error("F1_API_URL must point to a local API");
}
if (parsedApiUrl.port !== "3217") throw new Error("F1_API_URL must use the isolated port 3217");
if (!Number.isInteger(durationSeconds) || durationSeconds < 10 || durationSeconds > 600) {
  throw new Error("F1_DURATION_SECONDS must be an integer between 10 and 600");
}
if (!Number.isInteger(thinkTimeMs) || thinkTimeMs < 0 || thinkTimeMs > 5_000) {
  throw new Error("F1_THINK_TIME_MS must be an integer between 0 and 5000");
}
if (!internalApiKey)
  throw new Error("F1_INTERNAL_API_KEY is required and is never written to evidence");

const runtimeRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "tests",
  "e2e-live",
  ".runtime",
  "f1",
);
const startedAt = new Date();
const runDirectory = path.join(runtimeRoot, startedAt.toISOString().replaceAll(":", "-"));

function sessionCookie(response) {
  const raw = response.headers.get("set-cookie");
  const cookie = raw?.split(";", 1)[0]?.trim();
  if (!cookie?.startsWith("giromesa_session="))
    throw new Error("API did not issue a browser session");
  return cookie;
}

async function jsonRequest(pathname, { body, cookie, headers = {}, method = "GET" } = {}) {
  const response = await fetch(`${apiUrl}${pathname}`, {
    method,
    headers: {
      ...headers,
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let result = null;
  if (text) {
    try {
      result = JSON.parse(text);
    } catch {
      result = { message: text.slice(0, 200) };
    }
  }
  if (!response.ok) {
    throw new Error(`${method} ${pathname} returned ${response.status}`);
  }
  return { body: result, response };
}

async function authJsonRequest(pathname, body) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(`${apiUrl}${pathname}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status === 429 && attempt < 4) {
      await response.arrayBuffer();
      const retryAfterSeconds = Number.parseInt(response.headers.get("retry-after") ?? "60", 10);
      await wait((Number.isFinite(retryAfterSeconds) ? retryAfterSeconds + 1 : 61) * 1_000);
      continue;
    }
    const text = await response.text();
    const result = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(`POST ${pathname} returned ${response.status}`);
    return { body: result, response };
  }
  throw new Error(`POST ${pathname} exhausted authentication retries`);
}

function percentile(values, quantile) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * quantile) - 1] ?? sorted.at(-1);
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function dropCommittedResponse(pathname, { body, cookie, idempotencyKey }) {
  let resolveUpstream;
  let rejectUpstream;
  const upstreamFinished = new Promise((resolve, reject) => {
    resolveUpstream = resolve;
    rejectUpstream = reject;
  });
  const proxy = createServer(async (request) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const upstream = await fetch(`${apiUrl}${pathname}`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: Buffer.concat(chunks),
      });
      await upstream.arrayBuffer();
      resolveUpstream(upstream.status);
      request.socket.destroy();
    } catch (error) {
      rejectUpstream(error);
      request.socket.destroy();
    }
  });
  await new Promise((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(0, "127.0.0.1", resolve);
  });
  const address = proxy.address();
  if (!address || typeof address === "string")
    throw new Error("Response-drop proxy has no TCP port");
  let clientObservedFailure = false;
  try {
    await fetch(`http://127.0.0.1:${address.port}${pathname}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    clientObservedFailure = true;
  }
  const upstreamStatus = await upstreamFinished;
  await new Promise((resolve) => proxy.close(resolve));
  if (!clientObservedFailure)
    throw new Error("The client unexpectedly received the dropped response");
  if (upstreamStatus < 200 || upstreamStatus >= 300) {
    throw new Error(`The committed upstream POST returned ${upstreamStatus}`);
  }
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const email = `f1-load-${suffix}@example.test`;
  const password = randomBytes(24).toString("base64url");
  const registration = await authJsonRequest("/v1/auth/register", {
    email,
    name: "F1 Load Owner",
    password,
    termsAccepted: true,
  });
  const provisioningCookie = sessionCookie(registration.response);
  const created = await jsonRequest("/v1/organizations", {
    method: "POST",
    cookie: provisioningCookie,
    body: {
      legalName: `F1 Load ${suffix}`,
      tradeName: "F1 Load",
      document: `F1${Date.now().toString().slice(-10)}12`,
      unitName: "Unidade F1 Isolada",
      timezone: "America/Sao_Paulo",
    },
  });
  const organizationId = created.body.organization.id;
  const unitId = created.body.unit.id;
  const pilotPath = `/v1/organizations/${organizationId}/units/${unitId}/pilot`;
  await jsonRequest(`/internal/v1/organizations/${organizationId}/billing/events`, {
    method: "POST",
    headers: { "x-internal-api-key": internalApiKey },
    body: { event: "ACTIVATE_TRIAL" },
  });

  let floor = await jsonRequest(`${pilotPath}/floor`, { cookie: provisioningCookie });
  const room = await jsonRequest(`${pilotPath}/rooms`, {
    method: "POST",
    cookie: provisioningCookie,
    body: { name: "Salão F1", sortOrder: 0, expectedRevision: floor.body.floorRevision },
  });
  for (let offset = 0; offset < TABLE_COUNT; offset += 30) {
    floor = await jsonRequest(`${pilotPath}/floor`, { cookie: provisioningCookie });
    const tables = Array.from({ length: Math.min(30, TABLE_COUNT - offset) }, (_, index) => ({
      label: `Mesa F1 ${String(offset + index + 1).padStart(3, "0")}`,
      seats: 4,
      width: 122,
      height: 76,
      rotation: 0,
      shape: "rectangle",
    }));
    await jsonRequest(`${pilotPath}/rooms/${room.body.id}/tables/batch`, {
      method: "POST",
      cookie: provisioningCookie,
      body: { expectedRevision: floor.body.floorRevision, tables },
    });
  }
  floor = await jsonRequest(`${pilotPath}/floor`, { cookie: provisioningCookie });
  const tableIds = floor.body.tables
    .filter((table) => table.label.startsWith("Mesa F1 "))
    .sort((left, right) => left.label.localeCompare(right.label))
    .map((table) => table.id);
  if (tableIds.length !== TABLE_COUNT) throw new Error(`Expected ${TABLE_COUNT} fixture tables`);
  await jsonRequest(`${pilotPath}/service-sections`, {
    method: "POST",
    cookie: provisioningCookie,
    body: {
      name: "Praça F1",
      color: "#176B4D",
      serviceMode: "full_service",
      tableIds,
      defaultResponsibleIdentityId: registration.body.identity.id,
    },
  });
  await jsonRequest(`${pilotPath}/shifts/open`, {
    method: "POST",
    cookie: provisioningCookie,
    body: { label: "Turno F1", serviceMode: "full_service", copyPreviousAssignments: true },
  });

  const sessions = [{ cookie: provisioningCookie, terminalId: randomUUID() }];
  for (let index = 1; index < TERMINAL_COUNT; index += 1) {
    const login = await authJsonRequest("/v1/auth/login", { email, password });
    sessions.push({ cookie: sessionCookie(login.response), terminalId: randomUUID() });
  }
  if (new Set(sessions.map(({ cookie }) => cookie)).size !== TERMINAL_COUNT) {
    throw new Error("The API did not issue 12 independent authenticated sessions");
  }

  const fixture = {
    version: 1,
    profile: "f1-local",
    createdAt: startedAt.toISOString(),
    apiUrl,
    organizationId,
    unitId,
    identityId: registration.body.identity.id,
    tableIds,
    terminals: sessions.map(({ terminalId }, index) => ({ index: index + 1, terminalId })),
  };
  await mkdir(runDirectory, { recursive: true });
  await writeFile(path.join(runDirectory, "fixture.json"), `${JSON.stringify(fixture, null, 2)}\n`);

  const lostResponseKey = `f1-lost-response-${suffix}`;
  const lostResponseBody = { tableId: tableIds[0], guestCount: 2 };
  await dropCommittedResponse(`${pilotPath}/tabs/open`, {
    body: lostResponseBody,
    cookie: sessions[0].cookie,
    idempotencyKey: lostResponseKey,
  });
  const replay = await jsonRequest(`${pilotPath}/tabs/open`, {
    method: "POST",
    cookie: sessions[0].cookie,
    headers: { "idempotency-key": lostResponseKey, "x-device-id": sessions[0].terminalId },
    body: lostResponseBody,
  });
  if (replay.body.idempotentReplay !== true)
    throw new Error("Lost-response retry was not replayed");

  const measurements = [];
  const failures = [];
  async function measured(session, pathname, { body, kind = "read", method = "GET", name }) {
    const started = performance.now();
    const response = await fetch(`${apiUrl}${pathname}`, {
      method,
      headers: {
        cookie: session.cookie,
        "x-device-id": session.terminalId,
        ...(body === undefined
          ? {}
          : { "content-type": "application/json", "idempotency-key": `${name}-${suffix}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    await response.arrayBuffer();
    measurements.push({
      durationMs: performance.now() - started,
      kind,
      name,
      status: response.status,
    });
    if (!response.ok) failures.push({ name, status: response.status });
  }

  const writePhaseStartedAt = Date.now();
  await Promise.all(
    sessions.map(async (session, terminalIndex) => {
      const assignedTables = tableIds.filter(
        (_, tableIndex) => tableIndex % TERMINAL_COUNT === terminalIndex,
      );
      for (const [index, tableId] of assignedTables.entries()) {
        if (tableId === tableIds[0]) continue;
        await measured(session, `${pilotPath}/tabs/open`, {
          method: "POST",
          kind: "write",
          name: `tab.open.t${terminalIndex + 1}.${index + 1}`,
          body: { tableId, guestCount: 2 },
        });
      }
    }),
  );
  const writePhaseSeconds = (Date.now() - writePhaseStartedAt) / 1_000;

  const steadyStateStartedAt = Date.now();
  const deadline = steadyStateStartedAt + durationSeconds * 1_000;
  await Promise.all(
    sessions.map(async (session, terminalIndex) => {
      while (Date.now() < deadline) {
        await measured(session, `${pilotPath}/floor`, {
          name: `floor.read.t${terminalIndex + 1}`,
        });
        await measured(session, `${pilotPath}/tabs`, {
          name: `tabs.read.t${terminalIndex + 1}`,
        });
        if (thinkTimeMs > 0) await wait(thinkTimeMs);
      }
    }),
  );

  const finalFloor = await jsonRequest(`${pilotPath}/floor`, { cookie: provisioningCookie });
  const finalTableCount = finalFloor.body.tables.filter((table) =>
    tableIds.includes(table.id),
  ).length;
  const finalOpenTabCount = finalFloor.body.openTabs.filter((tab) =>
    tableIds.includes(tab.tableId),
  ).length;
  const readDurations = measurements
    .filter(({ kind }) => kind === "read")
    .map(({ durationMs }) => durationMs);
  const writeDurations = measurements
    .filter(({ kind }) => kind === "write")
    .map(({ durationMs }) => durationMs);
  const elapsedSeconds = (Date.now() - startedAt.getTime()) / 1_000;
  const failureRate = failures.length / Math.max(1, measurements.length);
  const health = await jsonRequest("/health");
  const summary = {
    status: "completed",
    profile: "f1-local",
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    environment: {
      apiUrl,
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      logicalCpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      apiBuildSha: health.body.buildSha ?? null,
      schemaVersion: health.body.schemaVersion ?? null,
    },
    workload: {
      tables: TABLE_COUNT,
      authenticatedSessions: TERMINAL_COUNT,
      steadyStateDurationSeconds: durationSeconds,
      steadyStateWrites: 0,
      writePhase: "initial tab openings before steady-state",
      writePhaseSeconds,
      totalElapsedSeconds: elapsedSeconds,
      requests: measurements.length,
      requestsPerSecond: measurements.length / (writePhaseSeconds + durationSeconds),
      readRequests: readDurations.length,
      readRequestsPerSecond: readDurations.length / durationSeconds,
      writeRequests: writeDurations.length,
      writeRequestsPerSecond: writeDurations.length / Math.max(writePhaseSeconds, 0.001),
      readP95Ms: percentile(readDurations, 0.95),
      writeP95Ms: percentile(writeDurations, 0.95),
      failures: failures.length,
      failureRate,
    },
    conservation: {
      expectedTables: TABLE_COUNT,
      persistedTables: finalTableCount,
      expectedOpenTabs: TABLE_COUNT,
      persistedOpenTabs: finalOpenTabCount,
      lostResponseRetryReplayed: replay.body.idempotentReplay === true,
      independentSessionCount: new Set(sessions.map(({ cookie }) => cookie)).size,
    },
    thresholds: {
      readP95UnderMs: READ_P95_LIMIT_MS,
      writeP95UnderMs: WRITE_P95_LIMIT_MS,
      failureRateUnder: FAILURE_RATE_LIMIT,
      passed:
        percentile(readDurations, 0.95) < READ_P95_LIMIT_MS &&
        percentile(writeDurations, 0.95) < WRITE_P95_LIMIT_MS &&
        failureRate < FAILURE_RATE_LIMIT &&
        finalTableCount === TABLE_COUNT &&
        finalOpenTabCount === TABLE_COUNT &&
        replay.body.idempotentReplay === true,
    },
    failures: failures.slice(0, 20),
    evidenceDirectory: runDirectory,
  };
  await writeFile(path.join(runDirectory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.thresholds.passed) process.exitCode = 1;
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : "Unknown F1 load failure";
  await mkdir(runDirectory, { recursive: true });
  await writeFile(
    path.join(runDirectory, "prefix-failed.json"),
    `${JSON.stringify(
      {
        status: "prefix_failed",
        profile: "f1-local",
        startedAt: startedAt.toISOString(),
        failedAt: new Date().toISOString(),
        configuredWorkload: {
          tables: TABLE_COUNT,
          authenticatedSessions: TERMINAL_COUNT,
          identityCount: 1,
          steadyStateDurationSeconds: durationSeconds,
          thinkTimeMs,
        },
        failure: { message },
        capacityResultAvailable: false,
      },
      null,
      2,
    )}\n`,
  );
  console.error(message);
  process.exitCode = 1;
});
