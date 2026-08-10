import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const requiredFields = ["level", "artifact", "migration"];

const isPresentString = (value) => typeof value === "string" && value.trim().length > 0;

export function validateProductionBaseline(baseline) {
  const errors = [];

  for (const field of requiredFields) {
    if (!isPresentString(baseline?.[field])) errors.push(`Missing release baseline ${field}.`);
  }

  const gateResults = baseline?.gateResults;
  if (
    !gateResults ||
    typeof gateResults !== "object" ||
    Array.isArray(gateResults) ||
    Object.entries(gateResults).length === 0 ||
    Object.entries(gateResults).some(
      ([name, result]) => !isPresentString(name) || !isPresentString(result),
    )
  ) {
    errors.push("Missing release baseline gate results.");
  }

  return errors;
}

const packagePath = fileURLToPath(new URL("../package.json", import.meta.url));
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const errors = validateProductionBaseline(packageJson.productionBaseline);

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log("Production baseline manifest is complete.");
}
