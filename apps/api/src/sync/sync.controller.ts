import { MAX_SYNC_BATCH_EVENTS } from "@giromesa/domain";
import { Body, Controller, Headers, HttpCode, Post } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiResponse,
  type OpenAPIObject,
} from "@nestjs/swagger";
import { ZodPipe } from "../common/zod.pipe.js";
import {
  type DispatchOutcomeBatchInput,
  dispatchOutcomeBatchSchema,
  type SyncBatchInput,
  syncBatchSchema,
} from "./sync.schemas.js";
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

const jsonRecordSchema: OpenApiSchema = {
  type: "object",
  additionalProperties: true,
};

const dateTimeSchema: OpenApiSchema = {
  type: "string",
  format: "date-time",
};

const syncSuccessResponseSchema: OpenApiSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "acceptedEventIds",
    "rejectedEvents",
    "eventResults",
    "commands",
    "snapshot",
    "serverTime",
  ],
  properties: {
    acceptedEventIds: {
      type: "array",
      items: { type: "string", format: "uuid" },
    },
    rejectedEvents: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "code"],
        properties: {
          id: { type: "string", format: "uuid" },
          code: { type: "string" },
        },
      },
    },
    eventResults: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "replayed", "result"],
        properties: {
          id: { type: "string", format: "uuid" },
          replayed: { type: "boolean" },
          result: {
            type: "object",
            required: ["status"],
            properties: {
              status: { type: "string" },
              code: { type: "string" },
            },
            additionalProperties: true,
          },
        },
      },
    },
    commands: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "type", "payload", "createdAt", "expiresAt"],
        properties: {
          id: { type: "string", format: "uuid" },
          type: { type: "string" },
          payload: jsonRecordSchema,
          createdAt: dateTimeSchema,
          expiresAt: dateTimeSchema,
        },
      },
    },
    snapshot: {
      type: "object",
      additionalProperties: false,
      required: [
        "organizationId",
        "unitId",
        "capturedAt",
        "approvals",
        "catalog",
        "floor",
        "tabs",
        "tabDetails",
        "kds",
      ],
      properties: {
        organizationId: { type: "string", format: "uuid" },
        unitId: { type: "string", format: "uuid" },
        capturedAt: dateTimeSchema,
        approvals: {
          type: "object",
          additionalProperties: false,
          required: ["validUntil", "actors", "managers"],
          properties: {
            validUntil: dateTimeSchema,
            actors: { type: "array", items: jsonRecordSchema },
            managers: { type: "array", items: jsonRecordSchema },
          },
        },
        catalog: {
          type: "object",
          additionalProperties: false,
          required: [
            "categories",
            "products",
            "modifierGroups",
            "modifierOptions",
            "productModifierGroups",
            "prices",
            "availability",
            "productStations",
          ],
          properties: {
            categories: { type: "array", items: jsonRecordSchema },
            products: { type: "array", items: jsonRecordSchema },
            modifierGroups: { type: "array", items: jsonRecordSchema },
            modifierOptions: { type: "array", items: jsonRecordSchema },
            productModifierGroups: { type: "array", items: jsonRecordSchema },
            prices: { type: "array", items: jsonRecordSchema },
            availability: { type: "array", items: jsonRecordSchema },
            productStations: { type: "array", items: jsonRecordSchema },
          },
        },
        floor: {
          type: "object",
          additionalProperties: false,
          required: ["rooms", "tables", "openTabs"],
          properties: {
            rooms: { type: "array", items: jsonRecordSchema },
            tables: { type: "array", items: jsonRecordSchema },
            openTabs: { type: "array", items: jsonRecordSchema },
          },
        },
        tabs: { type: "array", items: jsonRecordSchema },
        tabDetails: { type: "object", additionalProperties: jsonRecordSchema },
        kds: {
          type: "object",
          additionalProperties: false,
          required: ["tickets", "items"],
          properties: {
            tickets: { type: "array", items: jsonRecordSchema },
            items: { type: "array", items: jsonRecordSchema },
          },
        },
      },
    },
    serverTime: dateTimeSchema,
  },
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
  @ApiOkResponse({
    description: "Authoritative sync outcomes, pending cloud commands and operational snapshot.",
    schema: syncSuccessResponseSchema,
  })
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

  @HttpCode(200)
  @Post("dispatch-outcomes")
  @ApiOkResponse({
    description: "Idempotent dispatch outcomes accepted from the authenticated Hub.",
  })
  dispatchOutcomes(
    @Headers("authorization") authorization: string | undefined,
    @Body(new ZodPipe(dispatchOutcomeBatchSchema)) body: DispatchOutcomeBatchInput,
  ) {
    return this.sync.applyDispatchOutcomes(hubSyncKey(authorization), body.outcomes);
  }
}
