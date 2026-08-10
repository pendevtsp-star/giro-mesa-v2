import { spawn } from "node:child_process";
import { dirname, join } from "node:path";

const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error("A command is required");

const windowsPnpm = process.platform === "win32" && command === "pnpm";
const executable = windowsPnpm ? process.execPath : command;
const childArgs = windowsPnpm
  ? [join(dirname(process.execPath), "node_modules/corepack/dist/pnpm.js"), ...args]
  : args;

const child = spawn(executable, childArgs, {
  env: process.env,
  stdio: "inherit",
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
