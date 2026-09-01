import assert from "node:assert/strict";
import test from "node:test";
import { normalizeThemePreference, resolveTheme } from "./theme.ts";

test("normaliza e resolve a preferência visual do cardápio", () => {
  assert.equal(normalizeThemePreference("dark"), "dark");
  assert.equal(normalizeThemePreference("invalid"), "system");
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("light", true), "light");
});
