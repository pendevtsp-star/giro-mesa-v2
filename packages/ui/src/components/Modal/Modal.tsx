"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";
import { cn } from "../../lib/utils";
import { Button } from "../Button/Button";
import { Icon } from "../Icon/Icon";

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  size = "md",
  className = "",
  contentClassName = "",
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  contentClassName?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  function requestClose() {
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    onClose();
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !isOpen) return;
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: O dialog nativo trata Escape via onCancel; o clique fecha apenas o backdrop.
    <dialog
      aria-labelledby={titleId}
      className={cn("gm-modal-backdrop", className)}
      data-slot="dialog"
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => event.target === event.currentTarget && requestClose()}
      ref={dialogRef}
    >
      <div
        className={cn(`gm-modal gm-modal--${size}`, contentClassName)}
        data-slot="dialog-content"
      >
        <div className="gm-modal__header" data-slot="dialog-header">
          <strong data-slot="dialog-title" id={titleId}>
            {title}
          </strong>
          {description && (
            <div className="gm-modal__description" data-slot="dialog-description">
              {description}
            </div>
          )}
          <Button aria-label="Fechar" onClick={requestClose} size="sm" variant="ghost">
            <Icon name="x" size={16} />
          </Button>
        </div>
        <div className="gm-modal__body" data-slot="dialog-body">
          {children}
        </div>
      </div>
    </dialog>
  );
}
