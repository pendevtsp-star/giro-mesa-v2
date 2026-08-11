import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
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
const maliciousInternalRunId = crypto.randomUUID();
const maliciousUnavailableRunId = crypto.randomUUID();
const nestedCauseRunId = crypto.randomUUID();
const unitScopedRunId = crypto.randomUUID();
let updateCalls = 0;
const fakeService = {
  get(actorIdentityId: string) {
    if (actorIdentityId === managerIdentityId) {
      throw new ForbiddenException({
        code: "ONBOARDING_UNIT_SCOPE_DENIED",
        message: "O onboarding selecionado pertence a outra unidade.",
      });
    }
    throw new NotFoundException();
  },
  update(actorIdentityId: string) {
    updateCalls += 1;
    if (actorIdentityId === managerIdentityId) {
      throw new ForbiddenException({
        code: "ONBOARDING_UNIT_SCOPE_DENIED",
        message: "O onboarding selecionado pertence a outra unidade.",
      });
    }
    throw new ConflictException({
      code: "ONBOARDING_ALREADY_ACTIVATED",
      message: "O onboarding já foi ativado.",
    });
  },
  select(actorIdentityId: string) {
    if (actorIdentityId === managerIdentityId) {
      throw new ForbiddenException({
        code: "INSUFFICIENT_ROLE",
        message: "Acesso não autorizado.",
      });
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
        code: "PROVISIONING_TRANSIENT_FAILURE_SECRET",
        message: "database password must never cross this boundary",
        details: { provisioningRunId: crashingRunId, secret: "provider-token" },
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
    if (_identityId === managerIdentityId && runId === unitScopedRunId) {
      throw new ForbiddenException({
        code: "ONBOARDING_UNIT_SCOPE_DENIED",
        message: "O onboarding selecionado pertence a outra unidade.",
      });
    }
    if (runId === crashingRunId) {
      throw new Error("database password and internal stack must stay private");
    }
    if (runId === maliciousInternalRunId) {
      throw new InternalServerErrorException({
        code: "MALICIOUS_INTERNAL_CODE",
        message: "resend api key and sql must stay private",
        details: { provisioningRunId: crashingRunId, secret: "resend-secret" },
      });
    }
    if (runId === maliciousUnavailableRunId) {
      throw new HttpException(
        {
          code: "MALICIOUS_UPSTREAM_CODE",
          message: "upstream authorization header must stay private",
          details: { provisioningRunId: crashingRunId, secret: "bearer-secret" },
        },
        503,
      );
    }
    if (runId === nestedCauseRunId) {
      throw new Error("outer database secret", {
        cause: new Error("nested provider secret and internal stack"),
      });
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

function exactInternalError(payload: unknown) {
  assert.deepEqual(payload, {
    statusCode: 500,
    code: "INTERNAL_SERVER_ERROR",
    message: "Não foi possível concluir a solicitação.",
  });
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

      for (const request of [
        { method: "GET" as const, url: base },
        {
          method: "PATCH" as const,
          url: base,
          payload: { items: { training: { status: "pending" } } },
        },
        { method: "GET" as const, url: `${base}/provisioning/${unitScopedRunId}` },
      ]) {
        const crossUnit = await app.inject({
          ...request,
          headers: { authorization: "Bearer manager" },
        });
        exactError(crossUnit.json(), 403, "ONBOARDING_UNIT_SCOPE_DENIED");
      }

      const internal = await app.inject({
        method: "GET",
        url: `${base}/provisioning/${crashingRunId}`,
        headers: { authorization: "Bearer test" },
      });
      assert.equal(internal.statusCode, 500);
      exactInternalError(internal.json());
      assert.doesNotMatch(internal.body, /password|stack|private|database/i);

      for (const [runId, forbiddenContent] of [
        [maliciousInternalRunId, /MALICIOUS|resend|secret|sql/i],
        [maliciousUnavailableRunId, /MALICIOUS|upstream|authorization|bearer|secret/i],
        [nestedCauseRunId, /outer|nested|provider|secret|stack/i],
      ] as const) {
        const serverFailure = await app.inject({
          method: "GET",
          url: `${base}/provisioning/${runId}`,
          headers: { authorization: "Bearer test" },
        });
        assert.equal(serverFailure.statusCode, 500);
        exactInternalError(serverFailure.json());
        assert.doesNotMatch(serverFailure.body, forbiddenContent);
      }

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
            fiscalChoice: {
              status: "verified",
              evidenceReference: "fiscal-http-contract",
              evidence: { choice: "must-not-cross-secret" },
            },
          },
        },
      });
      const invalidEvidenceBody = exactError(invalidEvidence.json(), 400, "VALIDATION_ERROR");
      assert.deepEqual(invalidEvidenceBody.details, {
        fieldErrors: {
          "items.fiscalChoice.evidence.choice": ["Valor inválido."],
        },
      });
      assert.equal(updateCalls, callsBeforeInvalidEvidence);
      assert.doesNotMatch(invalidEvidence.body, /must-not-cross-secret/i);

      const unavailable = await app.inject({
        method: "POST",
        url: `${base}/activate`,
        headers: {
          authorization: "Bearer test",
          "idempotency-key": "http-contract-key-0002",
        },
        payload: { planSlug: "rede" },
      });
      assert.equal(unavailable.statusCode, 500);
      exactInternalError(unavailable.json());
      assert.doesNotMatch(
        unavailable.body,
        /PROVISIONING|database|password|provider|token|secret/i,
      );
    });
  }
});
