import { MAX_SYNC_BATCH_EVENTS } from "@giromesa/domain";
import { Body, Controller, Headers, HttpCode, Post } from "@nestjs/common";
import { ApiBadRequestResponse, ApiResponse, type OpenAPIObject } from "@nestjs/swagger";
import { type SyncBatchInput, syncBatchSchema } from "./sync.schemas.js";
import { SyncService } from "./sync.service.js";
import {
  SYNC_ACK_SCHEMA_INVALID,
  SYNC_BATCH_SCHEMA_INVALID,
  SYNC_EVENT_SCHEMA_INVALID,
  SyncBatchPipe,
} from "./sync-validation.js";

type OpenApiComponents = NonNullable<OpenAPIObject["components"]>;
type OpenApiSchemas = NonNullable<OpenApiComponents["schemas"]>;
type OpenApiSchema = OpenApiSchemas[string];

const syncValidationProblemSchema: OpenApiSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["code", "scope", "eventIndexes"],
      properties: {
        code: { type: "string", enum: [SYNC_EVENT_SCHEMA_INVALID] },
        scope: { type: "string", enum: ["event"] },
        eventIndexes: {
          type: "array",
          minItems: 1,
          maxItems: MAX_SYNC_BATCH_EVENTS,
          uniqueItems: true,
          items: { type: "integer", minimum: 0, maximum: MAX_SYNC_BATCH_EVENTS - 1 },
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["code", "scope"],
      properties: {
        code: { type: "string", enum: [SYNC_BATCH_SCHEMA_INVALID] },
        scope: { type: "string", enum: ["batch"] },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["code", "scope"],
      properties: {
        code: { type: "string", enum: [SYNC_ACK_SCHEMA_INVALID] },
        scope: { type: "string", enum: ["ack"] },
      },
    },
  ],
};

export function hubSyncKey(authorization: string | undefined) {
  if (!authorization?.startsWith("GiroMesaHub ")) return undefined;
  return authorization.slice("GiroMesaHub ".length).trim() || undefined;
}

@Controller(["api/v1/sync", "v1/sync"])
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @HttpCode(200)
  @Post("batches")
  @ApiBadRequestResponse({
    description:
      "Validation problem. Only SYNC_EVENT_SCHEMA_INVALID/event permits event isolation; batch and ack scopes apply to the whole request section.",
    schema: syncValidationProblemSchema,
  })
  @ApiResponse({
    status: 422,
    description:
      "Structured sync validation problem with the same fail-closed scope contract as HTTP 400.",
    schema: syncValidationProblemSchema,
  })
  synchronize(
    @Headers("authorization") authorization: string | undefined,
    @Body(new SyncBatchPipe(syncBatchSchema)) body: SyncBatchInput,
  ) {
    return this.sync.synchronize(hubSyncKey(authorization), body);
  }
}
