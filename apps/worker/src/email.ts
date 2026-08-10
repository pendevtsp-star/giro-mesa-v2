const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface EmailProviderConfiguration {
  apiKey: string;
  appUrl: string;
  apiUrl: string;
  from: string;
  replyTo?: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  headers?: Record<string, string>;
  tags?: Array<{ name: string; value: string }>;
}

export interface EmailDeliveryOptions {
  configuration?: EmailProviderConfiguration;
  environment?: NodeJS.ProcessEnv;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

export class EmailDeliveryError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super(code);
    this.name = "EmailDeliveryError";
  }
}

function configuredUrl(value: string | undefined, name: string, environment: NodeJS.ProcessEnv) {
  try {
    const url = new URL(value ?? "");
    const allowedProtocol =
      url.protocol === "https:" ||
      (environment.NODE_ENV !== "production" && url.protocol === "http:");
    if (!allowedProtocol || url.username || url.password) throw new Error("invalid URL");
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new EmailDeliveryError(`${name}_NOT_CONFIGURED`, true);
  }
}

export function emailProviderConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): EmailProviderConfiguration {
  if (environment.EMAIL_PROVIDER_ENABLED !== "true") {
    throw new EmailDeliveryError("EMAIL_PROVIDER_DISABLED", true);
  }
  if (environment.EMAIL_PROVIDER_CREDENTIAL_REFERENCE?.trim().toLowerCase() !== "resend") {
    throw new EmailDeliveryError("EMAIL_PROVIDER_REFERENCE_INVALID", true);
  }
  const apiKey = environment.RESEND_API_KEY?.trim();
  const from = environment.RESEND_FROM?.trim();
  const replyTo = environment.RESEND_REPLY_TO?.trim();
  if (!apiKey || apiKey.length < 12) throw new EmailDeliveryError("RESEND_API_KEY_MISSING", true);
  if (!from) throw new EmailDeliveryError("RESEND_FROM_MISSING", true);
  if (replyTo && !EMAIL.test(replyTo)) {
    throw new EmailDeliveryError("RESEND_REPLY_TO_INVALID", true);
  }
  return {
    apiKey,
    appUrl: configuredUrl(environment.APP_URL, "APP_URL", environment),
    apiUrl: configuredUrl(environment.API_URL, "API_URL", environment),
    from,
    ...(replyTo ? { replyTo } : {}),
  };
}

export function emailProviderReady(environment: NodeJS.ProcessEnv = process.env) {
  try {
    emailProviderConfiguration(environment);
    return true;
  } catch {
    return false;
  }
}

async function boundedResponseText(response: Response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new EmailDeliveryError("RESEND_RESPONSE_TOO_LARGE", true);
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(result);
}

function resendErrorCode(status: number, body: string) {
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "name" in parsed &&
      typeof parsed.name === "string" &&
      /^[a-z0-9_]{1,80}$/i.test(parsed.name)
    ) {
      return parsed.name.toUpperCase();
    }
  } catch {
    // Provider bodies are deliberately not propagated to logs or the outbox.
  }
  return `HTTP_${status}`;
}

export async function deliverEmail(message: EmailMessage, options: EmailDeliveryOptions = {}) {
  const configuration =
    options.configuration ?? emailProviderConfiguration(options.environment ?? process.env);
  if (!EMAIL.test(message.to) || message.subject.trim().length === 0) {
    throw new EmailDeliveryError("EMAIL_MESSAGE_INVALID", false);
  }
  if (message.idempotencyKey.length < 1 || message.idempotencyKey.length > 256) {
    throw new EmailDeliveryError("EMAIL_IDEMPOTENCY_KEY_INVALID", false);
  }
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(RESEND_EMAIL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${configuration.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": message.idempotencyKey,
        "User-Agent": "GiroMesa-Worker/2.0",
      },
      body: JSON.stringify({
        from: configuration.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(configuration.replyTo ? { reply_to: configuration.replyTo } : {}),
        ...(message.headers ? { headers: message.headers } : {}),
        ...(message.tags ? { tags: message.tags } : {}),
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof EmailDeliveryError) throw error;
    throw new EmailDeliveryError("RESEND_NETWORK_ERROR", true);
  }
  const body = await boundedResponseText(response);
  if (!response.ok) {
    const code = resendErrorCode(response.status, body);
    const retryable =
      response.status === 408 ||
      response.status === 425 ||
      response.status === 429 ||
      response.status >= 500 ||
      code === "CONCURRENT_IDEMPOTENT_REQUESTS";
    throw new EmailDeliveryError(`RESEND_${code}`, retryable);
  }
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "id" in parsed &&
      typeof parsed.id === "string" &&
      parsed.id.length >= 8 &&
      parsed.id.length <= 180
    ) {
      return { providerReference: parsed.id };
    }
  } catch {
    // Fall through to a stable error code.
  }
  throw new EmailDeliveryError("RESEND_RESPONSE_INVALID", true);
}

export function escapeEmailHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function emailHtml(input: {
  title: string;
  greeting: string;
  body: string;
  actionLabel: string;
  actionUrl: string;
  footer: string;
}) {
  const actionUrl = escapeEmailHtml(input.actionUrl);
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f4f1ec;color:#181714;font-family:Arial,sans-serif"><div style="display:none;max-height:0;overflow:hidden">${escapeEmailHtml(input.body)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #ded8cf;border-radius:18px"><tr><td style="padding:32px"><p style="margin:0 0 24px;color:#b64322;font-weight:700">GIROMESA</p><h1 style="margin:0 0 16px;font-size:28px">${escapeEmailHtml(input.title)}</h1><p style="font-size:16px;line-height:1.6">${escapeEmailHtml(input.greeting)}</p><p style="font-size:16px;line-height:1.6">${escapeEmailHtml(input.body)}</p><p style="margin:28px 0"><a href="${actionUrl}" style="display:inline-block;background:#bc4b2c;color:#fff;text-decoration:none;padding:14px 20px;border-radius:10px;font-weight:700">${escapeEmailHtml(input.actionLabel)}</a></p><p style="font-size:13px;line-height:1.6;color:#69645d;word-break:break-all">Se o botão não funcionar, copie este endereço:<br>${actionUrl}</p><p style="margin-top:28px;font-size:13px;line-height:1.6;color:#69645d">${escapeEmailHtml(input.footer)}</p></td></tr></table></td></tr></table></body></html>`;
}
