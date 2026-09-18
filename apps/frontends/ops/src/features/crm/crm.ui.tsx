import { Icon } from "@giromesa/ui";
import type { ReactNode } from "react";
import { ApiClientError } from "../../api";

export type CrmFeedback = { tone: "success" | "danger"; message: string };
export const crmCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export function crmFailureMessage(code: string, fallback: string): string {
  const messages: Record<string, string> = {
    EVOLUTION_PROVIDER_DISABLED:
      "A conexão com o WhatsApp ainda não está disponível. Peça ao responsável pelo sistema para habilitá-la.",
    EVOLUTION_INTEGRATION_NOT_FOUND: "Salve a conexão antes de conectar o WhatsApp.",
    EVOLUTION_NOT_LOGGED_IN:
      "O WhatsApp está desconectado. Peça ao proprietário para conectar o número.",
    EVOLUTION_HTTP_401:
      "Não foi possível autorizar a conexão com o WhatsApp. Peça ao responsável pelo sistema para verificá-la.",
    EVOLUTION_HTTP_403:
      "Não foi possível autorizar a conexão com o WhatsApp. Peça ao responsável pelo sistema para verificá-la.",
    EVOLUTION_HTTP_429: "Aguarde alguns instantes antes de tentar conectar o WhatsApp novamente.",
    EVOLUTION_HTTP_503:
      "O serviço de WhatsApp está indisponível no momento. Tente novamente em instantes. Se continuar, avise o responsável pelo sistema.",
    EVOLUTION_UNAVAILABLE:
      "Não foi possível acessar o serviço de WhatsApp. Tente novamente em instantes.",
    WHATSAPP_DELIVERY_UNCERTAIN:
      "Não foi possível confirmar a entrega. Confira a conversa antes de reenviar para evitar uma mensagem duplicada.",
    CRM_AUTOMATION_DELIVERY_UNCERTAIN:
      "O reenvio foi bloqueado porque a entrega anterior não pôde ser confirmada. Confira a conversa para evitar uma mensagem duplicada.",
    CUSTOMER_PROVIDER_UNAVAILABLE:
      "O canal de envio está indisponível. Peça ao responsável pelo sistema para verificar a conexão.",
    PROVIDER_NOT_CONFIGURED:
      "O canal de envio ainda não foi configurado. Peça ao responsável pelo sistema para configurá-lo.",
    WHATSAPP_FREQUENCY_CAP: "O cliente já atingiu o limite de mensagens neste período.",
    WHATSAPP_QUIET_HOURS: "O envio foi pausado para respeitar o horário de descanso.",
    WHATSAPP_PHONE_INVALID: "Confira o número de WhatsApp do cliente, incluindo o DDD.",
    WHATSAPP_MEDIA_UNAVAILABLE: "O anexo não está disponível para envio.",
    CONSENT_OR_ADDRESS_UNAVAILABLE:
      "Envio não realizado. Verifique a autorização do cliente e o contato.",
    CAMPAIGN_CANCELED: "Envio não realizado porque a campanha foi cancelada.",
  };
  return messages[code] ?? fallback;
}

export function crmError(error: unknown, fallback: string): string {
  if (!(error instanceof ApiClientError)) return fallback;
  const message = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/.test(error.message) ? fallback : error.message;
  return crmFailureMessage(error.code, message);
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
