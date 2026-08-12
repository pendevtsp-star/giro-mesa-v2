import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEMO_RESET_CONFIRMATION = "RESET_GIROMESA_DEMO";

export function buildDemoResetEnvironment({ confirmation, demoDatabaseUrl }) {
  if (confirmation !== DEMO_RESET_CONFIRMATION) {
    throw new Error(`Pass --confirm ${DEMO_RESET_CONFIRMATION} to reset the demo tenant.`);
  }
  if (!demoDatabaseUrl) throw new Error("DEMO_DATABASE_URL is required.");

  let parsed;
  try {
    parsed = new URL(demoDatabaseUrl);
  } catch {
    throw new Error("DEMO_DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DEMO_DATABASE_URL must use PostgreSQL.");
  }
  const databaseName = parsed.pathname.replace(/^\//, "");
  if (!databaseName.endsWith("_demo")) {
    throw new Error("The demo database name must end with _demo.");
  }

  return {
    DATABASE_URL: demoDatabaseUrl,
    GIROMESA_DEMO_RESET_CONFIRM: DEMO_RESET_CONFIRMATION,
  };
}

async function spawnSeed(command, args, options) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...options.env },
      shell: false,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Demo reset stopped by signal ${signal}.`));
      else resolve(code ?? 1);
    });
  });
}

export function resolvePackageRunner(
  platform = process.platform,
  nodeExecutable = process.execPath,
) {
  if (platform !== "win32") return { command: "pnpm", argsPrefix: [] };
  return {
    command: nodeExecutable,
    argsPrefix: [resolve(dirname(nodeExecutable), "node_modules", "corepack", "dist", "pnpm.js")],
  };
}

export async function runDemoReset(input, runner = spawnSeed, platform = process.platform) {
  const env = buildDemoResetEnvironment(input);
  const packageRunner = resolvePackageRunner(platform);
  return await runner(
    packageRunner.command,
    [...packageRunner.argsPrefix, "--filter", "@giromesa/db", "db:seed"],
    { env },
  );
}

function argumentValue(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function main() {
  const exitCode = await runDemoReset({
    confirmation: argumentValue(process.argv.slice(2), "--confirm"),
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: standalone safety gate runs outside Turbo tasks.
    demoDatabaseUrl: process.env.DEMO_DATABASE_URL,
  });
  process.exitCode = exitCode;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Demo reset failed.");
    process.exitCode = 1;
  });
}
