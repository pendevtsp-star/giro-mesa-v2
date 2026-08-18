import { OrderReadyDeliveryError } from "./order-ready.js";

const PHONE = /^\+[1-9]\d{7,14}$/;
const MAX_RESPONSE_BYTES = 64 * 1024;

export interface WhatsAppConfiguration {
  accessToken: string;
  phoneNumberId: string;
  graphApiVersion: string;
  template: string;
  language: string;
}

export interface WhatsAppReadyMessage {
  to: string;
  reference: string;
  idempotencyKey: string;
}

export function whatsappConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): WhatsAppConfiguration {
  if (environment.WHATSAPP_PROVIDER_ENABLED !== "true") {
    throw new OrderReadyDeliveryError("CUSTOMER_PROVIDER_UNAVAILABLE", false, true);
  }
  if (environment.WHATSAPP_PROVIDER_CREDENTIAL_REFERENCE !== "meta-cloud") {
    throw new OrderReadyDeliveryError("WHATSAPP_PROVIDER_REFERENCE_INVALID", false, true);
  }
  const accessToken = environment.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = environment.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const graphApiVersion = environment.WHATSAPP_GRAPH_API_VERSION?.trim();
  const template = environment.WHATSAPP_READY_TEMPLATE?.trim();
  if (!accessToken || !phoneNumberId || !graphApiVersion || !template) {
    throw new OrderReadyDeliveryError("WHATSAPP_CONFIGURATION_INCOMPLETE", false, true);
  }
  if (!/^v\d+\.\d+$/.test(graphApiVersion) || !/^\d+$/.test(phoneNumberId)) {
    throw new OrderReadyDeliveryError("WHATSAPP_CONFIGURATION_INVALID", false, true);
  }
  return {
    accessToken,
    phoneNumberId,
    graphApiVersion,
    template,
    language: environment.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || "pt_BR",
  };
}

function normalizePhone(value: string) {
  const normalized = `+${value.replace(/\D/g, "")}`;
  if (!PHONE.test(normalized)) {
    throw new OrderReadyDeliveryError("CUSTOMER_CONTACT_INVALID", false, true);
  }
  return normalized.slice(1);
}

async function boundedText(response: Response) {
  const text = await response.text();
  return text.slice(0, MAX_RESPONSE_BYTES);
}

export async function deliverWhatsAppReady(
  message: WhatsAppReadyMessage,
  options: {
    configuration?: WhatsAppConfiguration;
    environment?: NodeJS.ProcessEnv;
    fetcher?: typeof fetch;
    timeoutMs?: number;
  } = {},
) {
  const configuration = options.configuration ?? whatsappConfiguration(options.environment);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    const response = await (options.fetcher ?? fetch)(
      `https://graph.facebook.com/${configuration.graphApiVersion}/${configuration.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${configuration.accessToken}`,
          "Content-Type": "application/json",
          "X-GiroMesa-Idempotency-Key": message.idempotencyKey,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: normalizePhone(message.to),
          type: "template",
          template: {
            name: configuration.template,
            language: { code: configuration.language },
            components: [
              {
                type: "body",
                parameters: [{ type: "text", text: message.reference }],
              },
            ],
          },
        }),
        signal: controller.signal,
      },
    );
    const body = await boundedText(response);
    if (!response.ok) {
      throw new OrderReadyDeliveryError(
        `WHATSAPP_HTTP_${response.status}`,
        response.status === 408 || response.status === 429 || response.status >= 500,
      );
    }
    try {
      const parsed = JSON.parse(body) as { messages?: Array<{ id?: unknown }> };
      const providerReference = parsed.messages?.[0]?.id;
      if (typeof providerReference === "string" && providerReference.length > 5) {
        return { providerReference };
      }
    } catch {
      // Stable error below keeps provider payload out of logs.
    }
    throw new OrderReadyDeliveryError("WHATSAPP_RESPONSE_INVALID", true);
  } catch (error) {
    if (error instanceof OrderReadyDeliveryError) throw error;
    throw new OrderReadyDeliveryError("WHATSAPP_NETWORK_ERROR", true);
  } finally {
    clearTimeout(timeout);
  }
}
