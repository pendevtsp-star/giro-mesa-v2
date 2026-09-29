import { describe, expect, it } from "vitest";
import { counterShortcutAction, isWorkspaceShortcutBlocked } from "./counter-shortcuts";

describe("atalhos do balcão", () => {
  it("permite o modal ancestral, mas bloqueia outro modal aberto ou workspace ausente", () => {
    expect(isWorkspaceShortcutBlocked(null)).toBe(true);
    for (const [containsWorkspace, blocked] of [
      [[], false],
      [[true], false],
      [[true, true], false],
      [[false], true],
      [[true, false], true],
    ] as const) {
      const workspace = {
        ownerDocument: {
          querySelectorAll: (selector: string) => {
            expect(selector).toBe('dialog[open], [role="dialog"][aria-modal="true"]');
            return containsWorkspace.map((contains) => ({
              contains: (element: Element) => {
                expect(element).toBe(workspace);
                return contains;
              },
            }));
          },
        },
      } as unknown as Element;
      expect(isWorkspaceShortcutBlocked(workspace)).toBe(blocked);
    }
  });
  const event = { key: "n", altKey: true, ctrlKey: false, metaKey: false };
  it("reconhece apenas as cinco ações aprovadas", () => {
    for (const [key, action] of [
      ["n", "new"],
      ["N", "new"],
      ["1", "order"],
      ["2", "account"],
      ["3", "print"],
      ["r", "receive"],
      ["R", "receive"],
    ] as const) {
      expect(counterShortcutAction({ ...event, key })).toBe(action);
    }
    for (const key of ["Enter", "F2", "4", "/"]) {
      expect(counterShortcutAction({ ...event, key })).toBeNull();
    }
  });
  it("não captura digitação, AltGr, repetição, composição ou eventos já tratados", () => {
    for (const override of [
      { altKey: false },
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { repeat: true },
      { isComposing: true },
      { defaultPrevented: true },
    ]) {
      expect(counterShortcutAction({ ...event, ...override })).toBeNull();
    }
  });
});
