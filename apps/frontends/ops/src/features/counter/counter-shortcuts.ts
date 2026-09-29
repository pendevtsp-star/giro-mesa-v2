type ShortcutEvent = Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey"> &
  Partial<Pick<KeyboardEvent, "repeat" | "isComposing" | "defaultPrevented" | "shiftKey">>;

export function isWorkspaceShortcutBlocked(workspace: Element | null): boolean {
  if (!workspace) return true;
  return Array.from(
    workspace.ownerDocument.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]'),
  ).some((dialog) => !dialog.contains(workspace));
}

export function counterShortcutAction(event: ShortcutEvent) {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    !event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  )
    return null;
  switch (event.key.toLowerCase()) {
    case "n":
      return "new";
    case "1":
      return "order";
    case "2":
      return "account";
    case "3":
      return "print";
    case "r":
      return "receive";
    default:
      return null;
  }
}
