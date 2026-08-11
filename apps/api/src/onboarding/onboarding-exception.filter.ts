import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from "@nestjs/common";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_CODES: Record<number, string> = {
  400: "VALIDATION_ERROR",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "ONBOARDING_NOT_FOUND",
  409: "ONBOARDING_CONFLICT",
};
const DEFAULT_MESSAGES: Record<number, string> = {
  400: "Dados inválidos.",
  401: "Autenticação necessária.",
  403: "Acesso não autorizado.",
  404: "Onboarding não encontrado.",
  409: "A operação conflita com o estado atual do onboarding.",
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function strings(value: unknown, maximum = 20) {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .slice(0, maximum)
    .map((entry) => entry.slice(0, 240));
}

function safeDetails(value: unknown) {
  const source = record(value);
  const result: {
    provisioningRunId?: string;
    missingItems?: string[];
    fieldErrors?: Record<string, string[]>;
    formErrors?: string[];
  } = {};
  if (typeof source.provisioningRunId === "string" && UUID.test(source.provisioningRunId)) {
    result.provisioningRunId = source.provisioningRunId;
  }
  const missingItems = strings(source.missingItems, 12);
  if (missingItems?.length) result.missingItems = missingItems;
  const formErrors = strings(source.formErrors, 10);
  if (formErrors?.length) result.formErrors = formErrors;
  const rawFieldErrors = record(source.fieldErrors);
  const fieldErrors = Object.fromEntries(
    Object.entries(rawFieldErrors)
      .slice(0, 30)
      .flatMap(([field, messages]) => {
        const safeMessages = strings(messages, 5);
        return safeMessages?.length ? [[field.slice(0, 120), safeMessages]] : [];
      }),
  );
  if (Object.keys(fieldErrors).length) result.fieldErrors = fieldErrors;
  return Object.keys(result).length ? result : undefined;
}

@Catch()
export class OnboardingExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<{
      status(code: number): { send(body: unknown): void };
    }>();
    const statusCode = exception instanceof HttpException ? exception.getStatus() : 500;
    if (statusCode >= 500) {
      response.status(500).send({
        statusCode: 500,
        code: "INTERNAL_SERVER_ERROR",
        message: "Não foi possível concluir a solicitação.",
      });
      return;
    }
    const payload =
      exception instanceof HttpException ? record(exception.getResponse()) : ({} as const);
    const code =
      typeof payload.code === "string" && /^[A-Z][A-Z0-9_]{2,79}$/.test(payload.code)
        ? payload.code
        : (DEFAULT_CODES[statusCode] ?? "INTERNAL_ERROR");
    const message =
      typeof payload.message === "string" && payload.message.length <= 240
        ? payload.message
        : (DEFAULT_MESSAGES[statusCode] ?? "Não foi possível concluir a solicitação.");
    const details = safeDetails(payload.details);
    response
      .status(statusCode)
      .send({ statusCode, code, message, ...(details ? { details } : {}) });
  }
}
