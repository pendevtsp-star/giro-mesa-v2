import type { ReactNode } from "react";
import { Button } from "../Button/Button";
import { Icon } from "../Icon/Icon";

export function Drawer({
  isOpen,
  onClose,
  title,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!isOpen) return null;
  return (
    <div
      aria-modal="true"
      className="gm-drawer-overlay"
      data-slot="sheet-overlay"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="dialog"
      tabIndex={-1}
    >
      <div
        className="gm-drawer"
        data-slot="sheet-content"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="document"
      >
        <div className="gm-drawer__header" data-slot="sheet-header">
          <strong>{title}</strong>
          <Button size="sm" variant="ghost" onClick={onClose}>
            <Icon name="x" size={16} />
          </Button>
        </div>
        <div className="gm-drawer__body" data-slot="sheet-body">
          {children}
        </div>
      </div>
    </div>
  );
}
