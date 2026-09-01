"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../Icon/Icon";

const TOAST_DURATION_MS = 2_000;

export function Toast({
  message,
  tone = "info",
  title,
  onDismiss,
  actionLabel,
  onAction,
}: {
  message: string;
  tone?: "success" | "danger" | "info";
  title?: string;
  onDismiss: () => void;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const dismissRef = useRef(onDismiss);
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => dismissRef.current(), TOAST_DURATION_MS);
    return () => clearTimeout(t);
  }, [message]);
  useEffect(() => {
    const findOpenDialog = () => {
      const dialogs = document.querySelectorAll("dialog[open]");
      setPortalTarget(dialogs.item(dialogs.length - 1));
    };
    findOpenDialog();
    const frame = requestAnimationFrame(findOpenDialog);
    return () => cancelAnimationFrame(frame);
  }, []);
  const toast = (
    <aside
      aria-atomic="true"
      aria-live={tone === "danger" ? "assertive" : "polite"}
      className={`gm-toast gm-toast--${tone}`}
      data-slot="toast"
      role={tone === "danger" ? "alert" : "status"}
    >
      <span className="gm-toast__icon">
        <Icon name={tone === "success" ? "check" : tone === "danger" ? "alert-circle" : "salon"} />
      </span>
      <span className="gm-toast__content" data-slot="toast-content">
        <strong>
          {title ?? (tone === "danger" ? "Não foi possível concluir" : "Atualização")}
        </strong>
        <small>{message}</small>
        {actionLabel && onAction && (
          <button
            className="gm-toast__action"
            data-slot="toast-action"
            onClick={() => {
              onAction();
              onDismiss();
            }}
            type="button"
          >
            {actionLabel}
          </button>
        )}
      </span>
      <button aria-label="Fechar aviso" data-slot="toast-close" onClick={onDismiss} type="button">
        <Icon name="x" size={16} />
      </button>
    </aside>
  );
  return portalTarget ? createPortal(toast, portalTarget) : toast;
}
