import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/session.guard.js";
import { OnboardingController } from "./onboarding.controller.js";

describe("OnboardingController", () => {
  it("maps an invalid Idempotency-Key to the typed 400 boundary", () => {
    const controller = new OnboardingController({} as never);
    const request = { auth: { identityId: crypto.randomUUID() } } as AuthenticatedRequest;
    assert.throws(
      () => controller.activate(request, crypto.randomUUID(), "short", {}),
      (error: unknown) => error instanceof BadRequestException && error.getStatus() === 400,
    );
  });
});
