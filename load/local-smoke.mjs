import { execFile as execFileCallback, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  assertOperationalEffects,
  createInterruptionController,
  settleAfterCleanup,
} from "./lib/local-smoke-runtime.js";

const execFile = promisify(execFileCallback);
const root = path.resolve(import.meta.dirname, "..");
const loadDirectory = path.join(root, "load");
const dockerImage = "grafana/k6:1.8.0";
const postgresImage = "postgres:17-alpine";
const databaseName = "giromesa_load_smoke";
const databasePassword = randomBytes(24).toString("hex");
const suffix = randomUUID().replaceAll("-", "");
const containerName = `giromesa-load-smoke-${suffix.slice(0, 12)}`;
const loginRole = `giromesa_load_${suffix.slice(0, 20)}`;
const loginPassword = randomBytes(24).toString("hex");
const fixtureName = `smoke-${suffix.slice(0, 12)}.json`;
const fixturePath = path.join(loadDirectory, "fixtures", fixtureName);
const evidenceDirectory = await mkdtemp(path.join(tmpdir(), "giromesa-load-smoke-"));
const k6EnvPath = path.join(evidenceDirectory, ".k6.env");
const interruption = createInterruptionController();
const k6ContainerNames = new Set();

const tenants = [
  {
    label: "tenant-a",
    organizationId: "a1111111-1111-4111-8111-111111111111",
    unitId: "b1111111-1111-4111-8111-111111111111",
    identityId: "e1111111-1111-4111-8111-111111111111",
    membershipId: "f1111111-1111-4111-8111-111111111111",
    roomId: "01111111-1111-4111-8111-111111111111",
    tableId: "d1111111-1111-4111-8111-111111111111",
    terminalId: "c1111111-1111-4111-8111-111111111111",
    slug: "load-tenant-a",
    sessionCookieEnv: "K6_TENANT_A_COOKIE",
    sessionToken: `load-a-${suffix}`,
    document: "10000000000001",
  },
  {
    label: "tenant-b",
    organizationId: "a2222222-2222-4222-8222-222222222222",
    unitId: "b2222222-2222-4222-8222-222222222222",
    identityId: "e2222222-2222-4222-8222-222222222222",
    membershipId: "f2222222-2222-4222-8222-222222222222",
    roomId: "02222222-2222-4222-8222-222222222222",
    tableId: "d2222222-2222-4222-8222-222222222222",
    terminalId: "c2222222-2222-4222-8222-222222222222",
    slug: "load-tenant-b",
    sessionCookieEnv: "K6_TENANT_B_COOKIE",
    sessionToken: `load-b-${suffix}`,
    document: "10000000000002",
  },
];

function executable(name) {
  return process.platform === "win32" && name === "pnpm" ? "pnpm.cmd" : name;
}

async function command(name, args, options = {}) {
  interruption.throwIfInterrupted();
  const useCorepackPnpm = process.platform === "win32" && name === "pnpm";
  const commandName = useCorepackPnpm ? process.execPath : executable(name);
  const commandArgs = useCorepackPnpm
    ? [
        process.env.npm_execpath ??
          path.join(path.dirname(process.execPath), "node_modules", "corepack", "dist", "pnpm.js"),
        ...args,
      ]
    : args;
  const child = spawn(commandName, commandArgs, {
    cwd: root,
    env: { ...process.env, ...options.env },
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    windowsHide: true,
  });
  const untrack = interruption.track(child);
  let stdout = "";
  let stderr = "";
  if (options.capture) {
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
  }
  let code;
  let signal;
  try {
    [code, signal] = await once(child, "exit");
  } finally {
    untrack();
  }
  interruption.throwIfInterrupted();
  if (code !== 0) {
    const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
    throw new Error(
      `${name} exited with ${code ?? `signal ${signal}`}${output ? `: ${output}` : ""}`,
    );
  }
  return stdout.trim();
}

async function waitForPostgres() {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    try {
      await command(
        "docker",
        ["exec", containerName, "pg_isready", "-U", "postgres", "-d", databaseName],
        { capture: true },
      );
      return;
    } catch {
      interruption.throwIfInterrupted();
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("Disposable PostgreSQL did not become ready");
}

function applicationUrl(ownerUrl) {
  const url = new URL(ownerUrl);
  url.username = loginRole;
  url.password = loginPassword;
  return url.toString();
}

async function provisionFixtures(ownerUrl) {
  const { createDatabase } = await import("../packages/db/dist/index.js");
  const ownerConnection = createDatabase(ownerUrl, { max: 1 });
  const sql = ownerConnection.client;
  try {
    await sql.unsafe(
      `create role "${loginRole}" login password '${loginPassword}' noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls`,
    );
    await sql.unsafe(
      `grant giromesa_app, giromesa_identity, giromesa_public, giromesa_internal, giromesa_worker to "${loginRole}"`,
    );
    for (const tenant of tenants) {
      await sql`
        insert into organizations (id, legal_name, trade_name, document, billing_state)
        values (${tenant.organizationId}, ${`${tenant.label} Ltda`}, ${tenant.label}, ${tenant.document}, 'active')
      `;
      await sql`
        insert into units (id, organization_id, name)
        values (${tenant.unitId}, ${tenant.organizationId}, 'Unidade smoke')
      `;
      await sql`
        insert into identities (id, email, display_name, email_verified_at)
        values (${tenant.identityId}, ${`${tenant.label}@load.invalid`}, ${tenant.label}, now())
      `;
      await sql`
        insert into memberships (id, identity_id, organization_id, status)
        values (${tenant.membershipId}, ${tenant.identityId}, ${tenant.organizationId}, 'active')
      `;
      await sql`
        insert into role_bindings (membership_id, role)
        values (${tenant.membershipId}, 'owner')
      `;
      await sql`
        insert into auth_sessions (identity_id, token_hash, expires_at)
        values (
          ${tenant.identityId},
          ${createHash("sha256").update(tenant.sessionToken).digest("hex")},
          now() + interval '1 hour'
        )
      `;
      await sql`
        insert into pos_dining_rooms (id, organization_id, unit_id, name)
        values (${tenant.roomId}, ${tenant.organizationId}, ${tenant.unitId}, 'Sala smoke')
      `;
      await sql`
        insert into pos_dining_tables (id, organization_id, unit_id, room_id, label)
        values (${tenant.tableId}, ${tenant.organizationId}, ${tenant.unitId}, ${tenant.roomId}, '01')
      `;
      await sql`
        insert into public_menus (
          organization_id,
          unit_id,
          slug,
          items,
          active,
          publish_epoch,
          published_at
        ) values (
          ${tenant.organizationId},
          ${tenant.unitId},
          ${tenant.slug},
          ${JSON.stringify([{ id: `item-${tenant.label}`, name: "Item smoke", priceCents: 1000 }])}::jsonb,
          true,
          1,
          now()
        )
      `;
    }
  } finally {
    await sql.end();
  }
}

async function ensureMigrationOwner(ownerUrl) {
  const { createDatabase } = await import("../packages/db/dist/index.js");
  const connection = createDatabase(ownerUrl, { max: 1 });
  try {
    await connection.client.unsafe(
      "do $$ begin if not exists (select 1 from pg_roles where rolname = 'giromesa') then create role giromesa nologin; end if; end $$",
    );
  } finally {
    await connection.client.end();
  }
}

async function verifyOperationalEffects(ownerUrl) {
  const { createDatabase } = await import("../packages/db/dist/index.js");
  const connection = createDatabase(ownerUrl, { max: 1 });
  try {
    const rows = await connection.client`
      select
        organization_id::text as "organizationId",
        unit_id::text as "unitId",
        table_id::text as "tableId",
        status
      from pos_tabs
      order by organization_id, unit_id, table_id
    `;
    return assertOperationalEffects(rows, tenants);
  } finally {
    await connection.client.end();
  }
}

async function startApi(ownerUrl) {
  process.env.DATABASE_URL = applicationUrl(ownerUrl);
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  process.env.TRUST_PROXY = "false";
  process.env.CORS_ORIGINS = "http://localhost";
  process.env.EMAIL_PROVIDER_ENABLED = "false";
  process.env.PUBLIC_TABLE_SESSION_SIGNING_KEY = "load-smoke-table-session-signing-key-32-bytes";
  process.env.COMMAND_FINGERPRINT_ACTIVE_KEY_VERSION = "load-v1";
  process.env.COMMAND_FINGERPRINT_KEYS = JSON.stringify({
    "load-v1": randomBytes(32).toString("base64"),
  });
  const { createApplication } = await import("../apps/api/dist/app-factory.js");
  const { app } = await createApplication();
  app.useLogger(false);
  await app.listen(0, "0.0.0.0");
  const { DispatchCloudWorker } = await import(
    "../apps/api/dist/pilot-operations/dispatch-cloud.worker.js"
  );
  app.get(DispatchCloudWorker).onModuleDestroy();
  const address = app.getHttpServer().address();
  if (!address || typeof address === "string") throw new Error("API did not expose a TCP port");
  return { app, port: address.port };
}

function fixture() {
  return {
    version: 1,
    qrSessionsPerUnit: 1,
    tenants: tenants.map((tenant) => ({
      label: tenant.label,
      organizationId: tenant.organizationId,
      unitId: tenant.unitId,
      sessionCookieEnv: tenant.sessionCookieEnv,
      terminalIds: [tenant.terminalId],
      tableIds: [tenant.tableId],
      publicMenuPath: `/api/v1/public/menus/${tenant.slug}`,
    })),
  };
}

async function runK6(script) {
  const k6ContainerName = `giromesa-load-k6-${suffix.slice(0, 12)}-${script
    .replace(/\.js$/, "")
    .replaceAll(/[^a-z0-9-]/g, "-")}`;
  k6ContainerNames.add(k6ContainerName);
  const mount = `${loadDirectory.replaceAll("\\", "/")}:/load:ro`;
  const evidenceMount = `${evidenceDirectory.replaceAll("\\", "/")}:/evidence`;
  const args = [
    "run",
    "--rm",
    "--name",
    k6ContainerName,
    "--add-host",
    "host.docker.internal:host-gateway",
    "-v",
    mount,
    "-v",
    evidenceMount,
    "-w",
    "/load",
    "--env-file",
    k6EnvPath,
    dockerImage,
    "run",
    `/load/${script}`,
    "--summary-export",
    `/evidence/${script}.summary.json`,
  ];
  // The k6 process itself is the durable evidence gate. Secrets stay in a
  // short-lived environment file and never enter the fixture or application logs.
  await command("docker", args);
  const summary = await readFile(path.join(evidenceDirectory, `${script}.summary.json`), "utf8");
  for (const tenant of tenants) {
    if (summary.includes(tenant.sessionToken) || summary.includes("giromesa_session=")) {
      throw new Error("k6 summary contained session material");
    }
  }
}

async function containerExists(name) {
  try {
    await execFile("docker", ["inspect", "--type", "container", name]);
    return true;
  } catch (error) {
    const details = [error?.stdout, error?.stderr, error?.message]
      .filter(Boolean)
      .map(String)
      .join("\n");
    if (/No such (?:object|container)/i.test(details)) return false;
    throw new Error(`Could not confirm Docker cleanup for ${name}`, { cause: error });
  }
}

async function ensureContainerAbsent(name) {
  if (await containerExists(name)) {
    await execFile("docker", ["stop", "--time", "10", name]);
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!(await containerExists(name))) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Docker container remained active after cleanup: ${name}`);
}

async function removeAndConfirm(filePath) {
  await rm(filePath, { force: true });
  try {
    await access(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Sensitive smoke artifact remained after cleanup: ${filePath}`);
}

let app;
let runError;
let operationalEvidence;
try {
  await command(
    "docker",
    [
      "run",
      "--rm",
      "-d",
      "--name",
      containerName,
      "-e",
      `POSTGRES_PASSWORD=${databasePassword}`,
      "-e",
      `POSTGRES_DB=${databaseName}`,
      "-p",
      "127.0.0.1::5432",
      postgresImage,
    ],
    { capture: true },
  );
  await waitForPostgres();
  const binding = await command("docker", ["port", containerName, "5432/tcp"], {
    capture: true,
  });
  const match = /127\.0\.0\.1:(\d+)/.exec(binding);
  if (!match) throw new Error("Could not resolve disposable PostgreSQL port");
  const ownerUrl = `postgresql://postgres:${databasePassword}@127.0.0.1:${match[1]}/${databaseName}`;

  await ensureMigrationOwner(ownerUrl);
  await command("pnpm", ["--filter", "@giromesa/db", "db:migrate"], {
    env: { DATABASE_URL: ownerUrl },
    capture: true,
  });
  await provisionFixtures(ownerUrl);
  const running = await startApi(ownerUrl);
  app = running.app;
  const { port } = running;
  await writeFile(fixturePath, `${JSON.stringify(fixture(), null, 2)}\n`, { flag: "wx" });
  await writeFile(
    k6EnvPath,
    [
      `K6_BASE_URL=http://host.docker.internal:${port}`,
      "K6_PROFILE=smoke",
      `K6_FIXTURE_PATH=./fixtures/${fixtureName}`,
      `K6_TENANT_A_COOKIE=giromesa_session=${tenants[0].sessionToken}`,
      `K6_TENANT_B_COOKIE=giromesa_session=${tenants[1].sessionToken}`,
      "",
    ].join("\n"),
    { flag: "wx", mode: 0o600 },
  );

  for (const script of ["k6-operational.js", "k6-public-qr.js", "k6-multitenant.js"]) {
    await runK6(script);
  }
  operationalEvidence = await verifyOperationalEffects(ownerUrl);
} catch (error) {
  runError = error;
}

try {
  await settleAfterCleanup(runError, [
    async () => {
      if (app) await app.close();
    },
    () => removeAndConfirm(fixturePath),
    () => removeAndConfirm(k6EnvPath),
    ...[...k6ContainerNames].map((name) => () => ensureContainerAbsent(name)),
    () => ensureContainerAbsent(containerName),
    async () => interruption.throwIfInterrupted(),
  ]);
  interruption.throwIfInterrupted();
} finally {
  interruption.dispose();
}

process.stdout.write(
  `${JSON.stringify({
    status: "passed",
    profiles: ["smoke"],
    tenants: tenants.length,
    operationalEvidence,
    cleanup: "confirmed",
    evidenceDirectory,
  })}\n`,
);
