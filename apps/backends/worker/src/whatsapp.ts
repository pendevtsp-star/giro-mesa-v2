import {
  evolutionCredentialReference,
  evolutionInstanceToken,
  normalizeWhatsAppPhone,
} from "@giromesa/domain";
import { OrderReadyDeliveryError } from "./order-ready.js";

const MAX_RESPONSE_BYTES = 64 * 1024;

export interface WhatsAppConfiguration {
  baseUrl: string;
  token: string;
}

export interface WhatsAppTextMessage {
  to: string;
  text: string;
  idempotencyKey: string;
}

export interface WhatsAppMediaMessage extends WhatsAppTextMessage {
  content: Buffer;
  fileName: string;
  mimeType: string;
  type: "audio" | "document" | "image" | "video";
}

export function whatsappConfiguration(
  integration: { id: string; credentialReference: string | null; status: string },
  environment: NodeJS.ProcessEnv = process.env,
): WhatsAppConfiguration {
  if (environment.WHATSAPP_PROVIDER_ENABLED !== "true" || integration.status !== "ready")
    throw new OrderReadyDeliveryError("CUSTOMER_PROVIDER_UNAVAILABLE", false, true);
  const baseUrl = environment.WHATSAPP_EVOLUTION_API_URL?.trim().replace(/\/$/, "");
  const secret = environment.WHATSAPP_EVOLUTION_TOKEN_SECRET?.trim();
  if (!baseUrl || !secret)
    throw new OrderReadyDeliveryError("WHATSAPP_CONFIGURATION_INCOMPLETE", false, true);
  try {
    const url = new URL(baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    const token = evolutionInstanceToken(integration.id, secret);
    if (evolutionCredentialReference(token) !== integration.credentialReference)
      throw new OrderReadyDeliveryError("WHATSAPP_CREDENTIAL_REFERENCE_INVALID", false, true);
    return { baseUrl, token };
  } catch (error) {
    if (error instanceof OrderReadyDeliveryError) throw error;
    throw new OrderReadyDeliveryError("WHATSAPP_CONFIGURATION_INVALID", false, true);
  }
}

export async function deliverWhatsAppText(
  message: WhatsAppTextMessage,
  options: {
    configuration: WhatsAppConfiguration;
    fetcher?: typeof fetch;
    timeoutMs?: number;
  },
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    const response = await (options.fetcher ?? fetch)(
      `${options.configuration.baseUrl}/send/text`,
      {
        method: "POST",
        headers: { apikey: options.configuration.token, "Content-Type": "application/json" },
        body: JSON.stringify({
          number: normalizeWhatsAppPhone(message.to),
          text: message.text,
          id: message.idempotencyKey,
        }),
        signal: controller.signal,
      },
    );
    const raw = (await response.text()).slice(0, MAX_RESPONSE_BYTES);
    if (!response.ok) {
      const safeRetry = [400, 401, 404, 503].includes(response.status);
      throw new OrderReadyDeliveryError(`EVOLUTION_HTTP_${response.status}`, safeRetry);
    }
    try {
      const payload = JSON.parse(raw) as {
        data?: { Info?: { ID?: unknown }; info?: { id?: unknown } };
      };
      const providerReference = payload.data?.Info?.ID ?? payload.data?.info?.id;
      if (typeof providerReference === "string" && providerReference.length > 3)
        return { providerReference };
    } catch {
      // Stable error below keeps provider data out of logs.
    }
    throw new OrderReadyDeliveryError("EVOLUTION_RESPONSE_INVALID", false);
  } catch (error) {
    if (error instanceof OrderReadyDeliveryError) throw error;
    // A timeout after dispatch may already have reached WhatsApp. Retrying can duplicate it.
    throw new OrderReadyDeliveryError("WHATSAPP_DELIVERY_UNCERTAIN", false);
  } finally {
    clearTimeout(timeout);
  }
}

export async function deliverWhatsAppMedia(
  message: WhatsAppMediaMessage,
  options: Parameters<typeof deliverWhatsAppText>[1],
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  try {
    const response = await (options.fetcher ?? fetch)(
      `${options.configuration.baseUrl}/send/media`,
      {
        method: "POST",
        headers: { apikey: options.configuration.token, "Content-Type": "application/json" },
        body: JSON.stringify({
          number: normalizeWhatsAppPhone(message.to),
          url: `data:${message.mimeType};base64,${message.content.toString("base64")}`,
          type: message.type,
          caption: message.text,
          filename: message.fileName,
          id: message.idempotencyKey,
        }),
        signal: controller.signal,
      },
    );
    const raw = (await response.text()).slice(0, MAX_RESPONSE_BYTES);
    if (!response.ok) {
      const safeRetry = [400, 401, 404, 503].includes(response.status);
      throw new OrderReadyDeliveryError(`EVOLUTION_HTTP_${response.status}`, safeRetry);
    }
    try {
      const payload = JSON.parse(raw) as {
        data?: { Info?: { ID?: unknown }; info?: { id?: unknown } };
      };
      const providerReference = payload.data?.Info?.ID ?? payload.data?.info?.id;
      if (typeof providerReference === "string" && providerReference.length > 3)
        return { providerReference };
    } catch {
      // Stable error below keeps provider data out of logs.
    }
    throw new OrderReadyDeliveryError("EVOLUTION_RESPONSE_INVALID", false);
  } catch (error) {
    if (error instanceof OrderReadyDeliveryError) throw error;
    throw new OrderReadyDeliveryError("WHATSAPP_DELIVERY_UNCERTAIN", false);
  } finally {
    clearTimeout(timeout);
  }
}

export function deliverWhatsAppReady(
  message: { to: string; reference: string; idempotencyKey: string },
  options: Parameters<typeof deliverWhatsAppText>[1],
) {
  return deliverWhatsAppText(
    {
      to: message.to,
      text: `Seu pedido ${message.reference} está pronto para retirada.`,
      idempotencyKey: message.idempotencyKey,
    },
    options,
  );
}
