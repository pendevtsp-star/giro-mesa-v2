import { Icon } from "@giromesa/ui";
import type { ReactNode } from "react";
import { ApiClientError } from "../../api";

export type CrmFeedback = { tone: "success" | "danger"; message: string };
export const crmCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export function crmError(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError && error.code === "EVOLUTION_PROVIDER_DISABLED")
    return "A conexão com a Evolution Go ainda não foi habilitada neste ambiente.";
  if (error instanceof ApiClientError && error.code === "EVOLUTION_HTTP_503")
    return "A licença da Evolution Go ainda não foi ativada neste ambiente.";
  return error instanceof Error ? error.message : fallback;
}
export function CrmFormPanel({
  children,
  description,
  id,
  title,
}: {
  children: ReactNode;
  description: string;
  id?: string;
  title: string;
}) {
  return (
    <details className="action-panel">
      <summary id={id} tabIndex={id ? -1 : undefined}>
        <span>
          <strong>{title}</strong>
          <small>{description}</small>
        </span>
        <Icon name="plus" size={18} />
      </summary>
      {children}
    </details>
  );
}
