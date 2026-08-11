import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Module,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AuthService } from "../auth/auth.service.js";
import { SessionGuard } from "../auth/session.guard.js";
import { DatabaseService } from "../database/database.module.js";
import { OnboardingController } from "./onboarding.controller.js";
import { OnboardingService } from "./onboarding.service.js";

const organizationId = crypto.randomUUID();
const identityId = crypto.randomUUID();
const managerIdentityId = crypto.randomUUID();
const crashingRunId = crypto.randomUUID();
let updateCalls = 0;
const fakeService = {
  get() {
    throw new NotFoundException();
  },
  update() {
    updateCalls += 1;
    throw new ConflictException({
      code: "ONBOARDING_ALREADY_ACTIVATED",
      message: "O onboarding já foi ativado.",
    });
  },
  select(actorIdentityId: string) {
    if (actorIdentityId === managerIdentityId) {
      throw new ForbiddenException({ code: "INSUFFICIENT_ROLE", message: "Acesso não autorizado." });
    }
    throw new BadRequestException({
      code: "INVALID_ONBOARDING_UNIT",
      message: "Selecione uma unidade ativa desta organização.",
    });
  },
  activate(
    _identityId: string,
    _organizationId: string,
    _idempotencyKey: string,
    input: { planSlug?: string },
  ) {
    if (input.planSlug === "rede") {
      throw new ServiceUnavailableException({
        code: "PROVISIONING_TRANSIENT_FAILURE",
        message: "O provisionamento foi preservado e pode ser retomado.",
      });
    }
    throw new BadRequestException({
      code: "ONBOARDING_INCOMPLETE",
      message: "Finalize o checklist verificado antes de ativar o teste.",
      details: {
        missingItems: ["training"],
        secret: "must-not-cross-http-boundary",
      },
    });
  },
  provisioningStatus(_identityId: string, _organizationId: string, runId: string) {
    if (runId === crashingRunId) {
      throw new Error("database password and internal stack must stay private");
    }
    throw new NotFoundException();
  },
};

const fakeAuth = {
  authenticate(token: string) {
    return {
      identityId: token === "manager" ? managerIdentityId : identityId,
      email: "owner@example.test",
      displayName: "Owner",
      sessionId: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
    };
  },
};
const fakeDatabase = {
  withRoleContext(_role: string, _organizationId: string | null, work: () => unknown) {
    return work();
  },
};

@Module({
  controllers: [OnboardingController],
  providers: [
    { provide: OnboardingService, useValue: fakeService },
    { provide: AuthService, useValue: fakeAuth },
    { provide: DatabaseService, useValue: fakeDatabase },
    SessionGuard,
  ],
})
class OnboardingHttpContractModule {}

function exactError(payload: unknown, statusCode: number, code: string) {
  assert.ok(payload && typeof payload === "object" && !Array.isArray(payload));
  const body = payload as Record<string, unknown>;
  assert.equal(body.statusCode, statusCode);
  assert.equal(body.code, code);
  assert.equal(typeof body.message, "string");
  assert.deepEqual(
    Object.keys(body).sort(),
    body.details ? ["code", "details", "message", "statusCode"] : ["code", "message", "statusCode"],
  );
  return body;
}

describe("onboarding real HTTP error contract", () => {
  let app: NestFastifyApplication;

  before(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      OnboardingHttpContractModule,
      new FastifyAdapter({ logger: false }),
    );
    await app.init();
  });

  after(async () => {
    await app.close();
  });

  for (const prefix of ["/api/v1", "/v1"]) {
    it(`normalizes validation, not-found and conflict responses on ${prefix}`, async () => {
      const base = `${prefix}/organizations/${organizationId}/onboarding`;
      const unauthenticated = await app.inject({ method: "GET", url: base });
      exactError(unauthenticated.json(), 401, "UNAUTHORIZED");

      const forbidden = await app.inject({
        method: "PUT",
        url: `${base}/selection`,
        headers: { authorization: "Bearer manager" },
        payload: { planSlug: "operacao", selectedUnitId: crypto.randomUUID() },
      });
      exactError(forbidden.json(), 403, "INSUFFICIENT_ROLE");

      const internal = await app.inject({
        method: "GET",
        url: `${base}/provisioning/${crashingRunId}`,
        headers: { authorization: "Bearer test" },
      });
      exactError(internal.json(), 500, "INTERNAL_ERROR");
      assert.doesNotMatch(internal.body, /password|stack|private|database/i);

      const invalidHeader = await app.inject({
        method: "POST",
        url: `${base}/activate`,
        headers: { authorization: "Bearer test", "idempotency-key": "short" },
        payload: {},
      });
      exactError(invalidHeader.json(), 400, "VALIDATION_ERROR");

      const badUuid = await app.inject({
        method: "GET",
        url: `${prefix}/organizations/not-a-uuid/onboarding`,
        headers: { authorization: "Bearer test" },
      });
      exactError(badUuid.json(), 400, "VALIDATION_ERROR");

      const notFound = await app.inject({
        method: "GET",
        url: base,
        headers: { authorization: "Bearer test" },
      });
      exactError(notFound.json(), 404, "ONBOARDING_NOT_FOUND");

      const incomplete = await app.inject({
        method: "POST",
        url: `${base}/activate`,
        headers: {
          authorization: "Bearer test",
          "idempotency-key": "http-contract-key-0001",
        },
        payload: {},
      });
      const incompleteBody = exactError(incomplete.json(), 400, "ONBOARDING_INCOMPLETE");
      assert.deepEqual(incompleteBody.details, { missingItems: ["training"] });
      assert.doesNotMatch(incomplete.body, /secret|must-not-cross/i);

      const conflict = await app.inject({
        method: "PATCH",
        url: base,
        headers: { authorization: "Bearer test" },
        payload: { checklist: { business: true } },
      });
      exactError(conflict.json(), 409, "ONBOARDING_ALREADY_ACTIVATED");

      const callsBeforeInvalidEvidence = updateCalls;
      const invalidEvidence = await app.inject({
        method: "PATCH",
        url: base,
        headers: { authorization: "Bearer test" },
        payload: {
          items: {
            training: {
              status: "verified",
              evidenceReference: "training-http-contract",
              evidence: { completed: true, secret: "must-not-be-stored", note: "x".repeat(1_000) },
            },
          },
        },
      });
      exactError(invalidEvidence.json(), 400, "VALIDATION_ERROR");
      assert.equal(updateCalls, callsBeforeInvalidEvidence);
      assert.doesNotMatch(invalidEvidence.body, /must-not-be-stored/i);

      const unavailable = await app.inject({
        method: "POST",
        url: `${base}/activate`,
        headers: {
          authorization: "Bearer test",
          "idempotency-key": "http-contract-key-0002",
        },
        payload: { planSlug: "rede" },
      });
      exactError(unavailable.json(), 503, "PROVISIONING_TRANSIENT_FAILURE");
    });
  }
});
