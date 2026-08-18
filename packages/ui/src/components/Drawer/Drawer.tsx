import type { ReactNode } from "react";
import { Button } from "../Button/Button";
import { Icon } from "../Icon/Icon";
import "./Drawer.css";

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
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="dialog"
      tabIndex={-1}
    >
      <div
        className="gm-drawer"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="document"
      >
        <div className="gm-drawer__header">
          <strong>{title}</strong>
          <Button size="sm" variant="ghost" onClick={onClose}>
            <Icon name="x" size={16} />
          </Button>
        </div>
        <div className="gm-drawer__body">{children}</div>
      </div>
    </div>
  );
}
