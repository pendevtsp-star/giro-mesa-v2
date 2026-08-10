import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createApplication } from "./app-factory.js";

const outputDirectory = resolve("openapi");
const outputFile = resolve(outputDirectory, "openapi.json");
const { app, document } = await createApplication();
try {
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  process.stdout.write(`OpenAPI written to ${outputFile}\n`);
} finally {
  await app.close();
}
