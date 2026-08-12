import { BadRequestException } from "@nestjs/common";

export const POSTGRES_INT4_MAX = 2_147_483_647;
export const POSTGRES_INT4_MIN = -2_147_483_648;

export function assertPostgresInt4(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < POSTGRES_INT4_MIN || value > POSTGRES_INT4_MAX) {
    throw new BadRequestException({
      code: "INTEGER_STORAGE_LIMIT_EXCEEDED",
      message: `${field} excede o limite de armazenamento permitido.`,
    });
  }
  return value;
}

export function assertPostgresCents(value: number, field: string, allowNegative = false) {
  assertPostgresInt4(value, field);
  if ((!allowNegative && value < 0) || (allowNegative && value < POSTGRES_INT4_MIN)) {
    throw new BadRequestException({
      code: "MONETARY_STORAGE_LIMIT_EXCEEDED",
      message: `${field} excede o limite monetário permitido.`,
    });
  }
  return value;
}
