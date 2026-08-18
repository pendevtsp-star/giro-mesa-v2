import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants.js";
import { toOpenApiSchema } from "../common/openapi-zod.js";
import { PilotPosController } from "./pilot-pos.controller.js";
import {
  kdsAnalyticsResponseSchema,
  kdsAttentionAcknowledgeResponseSchema,
  kdsBatchReadSchema,
  kdsBlockResponseSchema,
  kdsMutationResponseSchema,
  kdsOrderPriorityResponseSchema,
  kdsOrderPrioritySchema,
  kdsProductAvailabilityListResponseSchema,
  kdsProductAvailabilityResponseSchema,
  kdsProductAvailabilitySchema,
  kdsReadModelSchema,
  kdsRerouteResponseSchema,
  kdsTerminalProfileResponseSchema,
  kdsTerminalProfileSchema,
} from "./pilot-schemas.js";

describe("pilot KDS HTTP contract", () => {
  it("documents stationId as an optional UUID query", () => {
    const parameters = Reflect.getMetadata(
      "swagger/apiParameters",
      PilotPosController.prototype.kds,
    ) as { name: string; required: boolean; format?: string }[];
    assert.deepEqual(
      parameters.find((parameter) => parameter.name === "stationId"),
      { name: "stationId", required: false, in: "query", format: "uuid" },
    );
  });

  it("returns 200 consistently for every documented POST action", () => {
    for (const method of [
      PilotPosController.prototype.transitionKds,
      PilotPosController.prototype.transitionKdsItem,
      PilotPosController.prototype.blockKdsItem,
      PilotPosController.prototype.unblockKdsItem,
      PilotPosController.prototype.acknowledgeKdsAttention,
      PilotPosController.prototype.rerouteKdsItem,
      PilotPosController.prototype.createKdsBatch,
      PilotPosController.prototype.completeKdsBatch,
      PilotPosController.prototype.cancelKdsBatch,
      PilotPosController.prototype.cancelKdsTicket,
      PilotPosController.prototype.recallKdsTicket,
      PilotPosController.prototype.refireKdsItem,
      PilotPosController.prototype.setKdsCourseState,
      PilotPosController.prototype.handoffKdsOrder,
    ]) {
      assert.equal(Reflect.getMetadata(HTTP_CODE_METADATA, method), 200);
      const responses = Reflect.getMetadata("swagger/apiResponse", method) as Record<
        string,
        unknown
      >;
      assert.ok(responses["200"]);
      assert.ok(responses["409"]);
      assert.ok(responses["503"]);
    }
  });

  it("converts every KDS response model to OpenAPI", () => {
    for (const schema of [
      kdsReadModelSchema,
      kdsMutationResponseSchema,
      kdsOrderPriorityResponseSchema,
      kdsProductAvailabilityListResponseSchema,
      kdsProductAvailabilityResponseSchema,
      kdsTerminalProfileResponseSchema,
      kdsBlockResponseSchema,
      kdsAttentionAcknowledgeResponseSchema,
      kdsRerouteResponseSchema,
      kdsBatchReadSchema,
      kdsAnalyticsResponseSchema,
    ]) {
      const document = toOpenApiSchema(schema);
      assert.equal(document.type, "object");
      assert.ok(document.properties);
    }
  });

  it("validates pass identity and bounded availability lifecycle inputs", () => {
    const installationId = "00000000-0000-4000-8000-000000000001";
    assert.equal(
      kdsOrderPrioritySchema.safeParse({
        priority: 70,
        reason: "Atraso informado no passe",
        installationId,
      }).success,
      true,
    );
    assert.equal(
      kdsTerminalProfileSchema.safeParse({
        mode: "station",
        stationId: null,
        label: "Grelha",
        soundEnabled: true,
        fullscreenPreferred: true,
      }).success,
      false,
    );
    assert.equal(
      kdsProductAvailabilitySchema.safeParse({
        available: false,
        reason: "Sem insumo na praça",
        resetAt: "2026-08-18T03:00:00.000Z",
        dailyStock: 20,
      }).success,
      true,
    );
    assert.equal(
      kdsProductAvailabilitySchema.safeParse({
        available: true,
        reason: "Produto reativado",
        resetAt: "2026-08-18T03:00:00.000Z",
      }).success,
      false,
    );
  });
});
