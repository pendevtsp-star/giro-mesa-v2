import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDemoResetEnvironment,
  resolvePackageRunner,
  runDemoReset,
} from "./reset-demo-tenant.mjs";

const safeInput = {
  confirmation: "RESET_GIROMESA_DEMO",
  demoDatabaseUrl: "postgresql://demo_user:local-only@127.0.0.1:5432/giromesa_demo",
};

test("reset refuses to run without the explicit confirmation", () => {
  assert.throws(
    () => buildDemoResetEnvironment({ ...safeInput, confirmation: undefined }),
    /RESET_GIROMESA_DEMO/,
  );
});

test("reset refuses a database whose name is not explicitly demo", () => {
  assert.throws(
    () =>
      buildDemoResetEnvironment({
        ...safeInput,
        demoDatabaseUrl: "postgresql://demo_user:local-only@127.0.0.1:5432/giromesa",
      }),
    /database name must end with _demo/,
  );
});

test("reset invokes only the database seed with the isolated demo URL and explicit marker", async () => {
  const calls = [];
  const result = await runDemoReset(
    safeInput,
    async (command, args, options) => {
      calls.push({ command, args, options });
      return 0;
    },
    "linux",
  );

  assert.equal(result, 0);
  assert.deepEqual(calls, [
    {
      command: "pnpm",
      args: ["--filter", "@giromesa/db", "db:seed"],
      options: {
        env: {
          DATABASE_URL: safeInput.demoDatabaseUrl,
          GIROMESA_DEMO_RESET_CONFIRM: "RESET_GIROMESA_DEMO",
        },
      },
    },
  ]);
});

test("reset resolves the executable without enabling a command shell", () => {
  assert.deepEqual(resolvePackageRunner("win32", "C:\\node\\node.exe"), {
    command: "C:\\node\\node.exe",
    argsPrefix: ["C:\\node\\node_modules\\corepack\\dist\\pnpm.js"],
  });
  assert.deepEqual(resolvePackageRunner("linux", "/usr/local/bin/node"), {
    command: "pnpm",
    argsPrefix: [],
  });
});
