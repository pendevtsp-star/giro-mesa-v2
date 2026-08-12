import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const uiFiles = [
  "App.tsx",
  "ErrorBoundary.tsx",
  "growth-pages.tsx",
  "management.tsx",
  "operations.tsx",
  "platform.tsx",
];

describe("integridade visual da operação", () => {
  it("não usa glifos Unicode ou texto como pseudo-ícones", () => {
    const source = uiFiles
      .map((file) => readFileSync(new URL(file, import.meta.url), "utf8"))
      .join("\n");

    expect(source).not.toMatch(/[⌂◫＋▦▤◉◇▱↗♙▻◷♡⌘◎✓☰⌄⌖✉≡]/u);
    expect(source).not.toMatch(/<EmptyState[\s\S]{0,180}?icon="[^"]+"/u);
    expect(source).not.toMatch(/className="action-icon[^"]*"[^>]*>\s*[!?$i]\s*</u);
    expect(source).not.toMatch(/>\s*×\s*</u);
  });
});
