import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  ServiceUnavailableException,
} from "@nestjs/common";

const platformErrorStatus = {
  INVALID_PLATFORM_ACTION: 400,
  INVALID_CURSOR: 400,
  INVALID_LIMIT: 400,
  PLATFORM_ACTION_VERSION_CONFLICT: 409,
  PLATFORM_ACTION_TERMINAL: 409,
  PLATFORM_IDEMPOTENCY_CONFLICT: 409,
  PLATFORM_ACTION_EXPIRED: 410,
  DUAL_CONTROL_REQUIRED: 403,
} as const;

export type PlatformDomainErrorCode = keyof typeof platformErrorStatus;

export class PlatformDomainError extends Error {
  constructor(readonly code: PlatformDomainErrorCode) {
    super(code);
    this.name = "PlatformDomainError";
  }
}

export class PlatformDurableOutcomeError extends Error {
  constructor(readonly originalError: unknown) {
    super(originalError instanceof Error ? originalError.message : "PLATFORM_DURABLE_OUTCOME");
    this.name = "PlatformDurableOutcomeError";
  }
}

function response(statusCode: number, code: string) {
  return { statusCode, code, message: "A operação administrativa não pôde ser concluída." };
}

export function platformHttpException(error: unknown): HttpException {
  if (error instanceof PlatformDurableOutcomeError)
    return platformHttpException(error.originalError);
  if (error instanceof HttpException) return error;
  const code = error instanceof Error ? error.message : "";
  if (!(code in platformErrorStatus))
    return new ServiceUnavailableException(response(503, "PLATFORM_OPERATION_FAILED"));
  const typedCode = code as PlatformDomainErrorCode;
  const status = platformErrorStatus[typedCode];
  if (status === 400) return new BadRequestException(response(status, typedCode));
  if (status === 403) return new ForbiddenException(response(status, typedCode));
  if (status === 409) return new ConflictException(response(status, typedCode));
  return new GoneException(response(status, typedCode));
}

export function isPlatformPolicyError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return code in platformErrorStatus;
}
