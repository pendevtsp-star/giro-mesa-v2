import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  decidePilotConflict,
  type PilotConflictDecision,
  type PilotConflictInput,
} from "./conflict-matrix.js";

type Fixture = Readonly<{
  name: string;
  input: PilotConflictInput;
  expected: PilotConflictDecision;
}>;

const fixtures = JSON.parse(
  readFileSync(new URL("../fixtures/conflict-matrix.json", import.meta.url), "utf8"),
) as Fixture[];

describe("pilot conflict matrix", () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      assert.deepEqual(decidePilotConflict(fixture.input), fixture.expected);
    });
  }
});
