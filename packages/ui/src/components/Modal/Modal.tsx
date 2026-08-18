import { type ReactNode, useEffect, useId, useRef } from "react";
import { Button } from "../Button/Button";
import { Icon } from "../Icon/Icon";
import "./Modal.css";

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  size = "md",
  className = "",
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
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
      className={`gm-modal-backdrop ${className}`.trim()}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => event.target === event.currentTarget && requestClose()}
      ref={dialogRef}
    >
      <div className={`gm-modal gm-modal--${size}`}>
        <div className="gm-modal__header">
          <strong id={titleId}>{title}</strong>
          {description && <div className="gm-modal__description">{description}</div>}
          <Button aria-label="Fechar" onClick={requestClose} size="sm" variant="ghost">
            <Icon name="x" size={16} />
          </Button>
        </div>
        <div className="gm-modal__body">{children}</div>
      </div>
    </dialog>
  );
}
