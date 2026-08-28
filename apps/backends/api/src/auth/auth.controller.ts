import {
  type ConfirmPasswordResetInput,
  confirmPasswordResetSchema,
  type LoginRequestInput,
  loginRequestSchema,
  publicRegisterSchema,
  type RegisterRequestInput,
  type RequestPasswordResetInput,
  requestPasswordResetSchema,
} from "@giromesa/contracts";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ApiBody } from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { toOpenApiSchema } from "../common/openapi-zod.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { AuthService } from "./auth.service.js";
import {
  beginGoogleOAuth,
  consumeGoogleState,
  exchangeGoogleCode,
  type GoogleAuthIntent,
  type GoogleOAuthPrepareInput,
  googleConfiguration,
  googleOAuthPrepareSchema,
} from "./google-oauth.js";
import {
  type ConfirmMfaSetupInput,
  confirmMfaSetupSchema,
  type DisableMfaInput,
  disableMfaSchema,
  type VerifyMfaChallengeInput,
  type VerifyOAuthMfaInput,
  verifyMfaChallengeSchema,
  verifyOAuthMfaSchema,
} from "./mfa.schemas.js";
import { type AuthenticatedRequest, SessionGuard } from "./session.guard.js";
import {
  clearSessionCookieOptions,
  GOOGLE_STATE_COOKIE_NAME,
  OAUTH_MFA_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  shortLivedAuthCookieOptions,
} from "./session-cookie.js";

@Controller(["api/v1/auth", "v1/auth", "public/v1/auth"])
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  async register(
    @Body(new ZodPipe(publicRegisterSchema)) body: RegisterRequestInput,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.authService.register(body);
    reply.setCookie(SESSION_COOKIE_NAME, result.token, sessionCookieOptions(result.expiresAt));
    const { token: _token, ...browserResult } = result;
    return browserResult;
  }

  @HttpCode(200)
  @Post("login")
  async login(
    @Body(new ZodPipe(loginRequestSchema)) body: LoginRequestInput,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.authService.login(body);
    if ("token" in result) {
      reply.setCookie(SESSION_COOKIE_NAME, result.token, sessionCookieOptions(result.expiresAt));
      const { token: _token, ...browserResult } = result;
      return browserResult;
    }
    return result;
  }

  @HttpCode(200)
  @Post("mfa/challenge/verify")
  async verifyMfaChallenge(
    @Body(new ZodPipe(verifyMfaChallengeSchema)) body: VerifyMfaChallengeInput,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.authService.verifyMfaChallenge(body);
    reply.setCookie(SESSION_COOKIE_NAME, result.token, sessionCookieOptions(result.expiresAt));
    const { token: _token, ...browserResult } = result;
    return browserResult;
  }

  @HttpCode(200)
  @Post("mfa/oauth/verify")
  async verifyOAuthMfa(
    @Req() request: FastifyRequest,
    @Body(new ZodPipe(verifyOAuthMfaSchema)) body: VerifyOAuthMfaInput,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const challengeToken = request.cookies[OAUTH_MFA_COOKIE_NAME];
    if (!challengeToken) throw new UnauthorizedException({ code: "OAUTH_MFA_REQUIRED" });
    const result = await this.authService.verifyMfaChallenge({ challengeToken, ...body });
    reply.clearCookie(OAUTH_MFA_COOKIE_NAME, clearSessionCookieOptions());
    reply.setCookie(SESSION_COOKIE_NAME, result.token, sessionCookieOptions(result.expiresAt));
    const { token: _token, ...browserResult } = result;
    return browserResult;
  }

  @UseGuards(SessionGuard)
  @Get("mfa")
  mfaStatus(@Req() request: AuthenticatedRequest) {
    return this.authService.mfaStatus(request.auth.identityId);
  }

  @UseGuards(SessionGuard)
  @Post("mfa/setup")
  beginMfaSetup(@Req() request: AuthenticatedRequest) {
    return this.authService.beginMfaSetup(request.auth.identityId);
  }

  @UseGuards(SessionGuard)
  @Post("mfa/setup/confirm")
  confirmMfaSetup(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodPipe(confirmMfaSetupSchema)) body: ConfirmMfaSetupInput,
  ) {
    return this.authService.confirmMfaSetup(
      request.auth.identityId,
      request.auth.sessionId,
      body.code,
    );
  }

  @HttpCode(204)
  @UseGuards(SessionGuard)
  @Post("mfa/disable")
  async disableMfa(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodPipe(disableMfaSchema)) body: DisableMfaInput,
  ) {
    await this.authService.disableMfa(request.auth.identityId, body);
  }

  @HttpCode(204)
  @UseGuards(SessionGuard)
  @Post("logout")
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.authService.revoke(request.auth.sessionId, request.auth.identityId);
    reply.clearCookie(SESSION_COOKIE_NAME, clearSessionCookieOptions());
    reply.clearCookie(GOOGLE_STATE_COOKIE_NAME, clearSessionCookieOptions());
    reply.clearCookie(OAUTH_MFA_COOKIE_NAME, clearSessionCookieOptions());
  }

  @UseGuards(SessionGuard)
  @Get("me")
  me(@Req() request: AuthenticatedRequest) {
    return this.authService.me(request.auth.identityId);
  }

  @HttpCode(202)
  @Post(["password-reset/request", "password/forgot"])
  async requestReset(
    @Body(new ZodPipe(requestPasswordResetSchema)) body: RequestPasswordResetInput,
  ) {
    await this.authService.requestPasswordReset(body);
    return { accepted: true };
  }

  @HttpCode(204)
  @Post("password-reset/confirm")
  async confirmReset(
    @Body(new ZodPipe(confirmPasswordResetSchema)) body: ConfirmPasswordResetInput,
  ) {
    await this.authService.confirmPasswordReset(body);
  }

  @Get("google/login")
  googleLogin(@Query("returnTo") returnTo: string | undefined, @Res() reply: FastifyReply) {
    return this.startGoogle("login", reply, returnTo);
  }

  @Get("google/signup")
  googleSignup(
    @Query("termsAccepted") termsAccepted: string,
    @Query("returnTo") returnTo: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    if (termsAccepted !== "true") {
      throw new UnauthorizedException({ code: "TERMS_ACCEPTANCE_REQUIRED" });
    }
    return this.startGoogle("signup", reply, returnTo);
  }

  @Get("google/start")
  googleStart(
    @Query("intent") intent: string,
    @Query("termsAccepted") termsAccepted: string | undefined,
    @Query("returnTo") returnTo: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    if (intent !== "login" && intent !== "signup") this.googleDisabled();
    if (intent === "signup" && termsAccepted !== "true") {
      throw new UnauthorizedException({ code: "TERMS_ACCEPTANCE_REQUIRED" });
    }
    return this.startGoogle(intent, reply, returnTo);
  }

  @HttpCode(200)
  @Post("google/prepare")
  @ApiBody({ schema: toOpenApiSchema(googleOAuthPrepareSchema) })
  googlePrepare(
    @Body(new ZodPipe(googleOAuthPrepareSchema)) body: GoogleOAuthPrepareInput,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (body.intent === "signup" && !body.termsAccepted) {
      throw new UnauthorizedException({ code: "TERMS_ACCEPTANCE_REQUIRED" });
    }
    const flow = this.prepareGoogle(body.intent, reply, body.returnTo);
    return { authorizationUrl: flow.authorizationUrl };
  }

  @Get("google/callback")
  async googleCallback(
    @Query("code") code: string | undefined,
    @Query("state") returnedState: string | undefined,
    @Query("error") providerError: string | undefined,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const config = this.googleConfig();
    const state = consumeGoogleState(
      request.cookies[GOOGLE_STATE_COOKIE_NAME],
      returnedState,
      config,
    );
    reply.clearCookie(GOOGLE_STATE_COOKIE_NAME, clearSessionCookieOptions());
    if (!state) throw new UnauthorizedException({ code: "INVALID_GOOGLE_STATE" });
    const failureTarget = this.siteTarget(state.intent, "failed", state.returnTo);
    if (providerError || !code) return this.redirect(reply, failureTarget);
    try {
      const profile = await exchangeGoogleCode(code, state, config);
      const result = await this.authService.authenticateGoogle(profile, state.intent);
      if ("mfaRequired" in result) {
        reply.setCookie(
          OAUTH_MFA_COOKIE_NAME,
          result.challengeToken,
          shortLivedAuthCookieOptions(5 * 60),
        );
        return this.redirect(reply, this.siteTarget("login", "mfa", state.returnTo));
      }
      reply.clearCookie(OAUTH_MFA_COOKIE_NAME, clearSessionCookieOptions());
      reply.setCookie(SESSION_COOKIE_NAME, result.token, sessionCookieOptions(result.expiresAt));
      return this.redirect(
        reply,
        state.returnTo
          ? new URL(state.returnTo, this.absoluteTarget("APP_URL")).toString()
          : this.absoluteTarget("OPS_APP_URL"),
      );
    } catch {
      return this.redirect(reply, failureTarget);
    }
  }

  private googleDisabled(): never {
    throw new ServiceUnavailableException({
      code: "GOOGLE_AUTH_DISABLED",
      message: "Login Google ainda não foi configurado para este ambiente.",
    });
  }

  private startGoogle(intent: GoogleAuthIntent, reply: FastifyReply, returnTo?: string) {
    if (returnTo?.includes("#platform=")) {
      throw new UnauthorizedException({ code: "SENSITIVE_RETURN_TARGET_REQUIRES_POST" });
    }
    const flow = this.prepareGoogle(intent, reply, returnTo);
    return this.redirect(reply, flow.authorizationUrl);
  }

  private prepareGoogle(intent: GoogleAuthIntent, reply: FastifyReply, returnTo?: string) {
    let flow: ReturnType<typeof beginGoogleOAuth>;
    try {
      flow = beginGoogleOAuth(intent, this.googleConfig(), returnTo);
    } catch {
      throw new UnauthorizedException({ code: "INVALID_RETURN_TARGET" });
    }
    reply.clearCookie(OAUTH_MFA_COOKIE_NAME, clearSessionCookieOptions());
    reply.setCookie(GOOGLE_STATE_COOKIE_NAME, flow.stateCookie, shortLivedAuthCookieOptions());
    return flow;
  }

  private googleConfig() {
    const config = googleConfiguration();
    if (!config) this.googleDisabled();
    return config;
  }

  private siteTarget(intent: GoogleAuthIntent, google: "failed" | "mfa", returnTo?: string) {
    const base = this.absoluteTarget("APP_URL");
    const target = new URL(intent === "signup" ? "/criar-conta" : "/login", base);
    target.searchParams.set("google", google);
    if (returnTo) target.hash = new URLSearchParams({ returnTo }).toString();
    return target.toString();
  }

  private absoluteTarget(name: "APP_URL" | "OPS_APP_URL") {
    const value = process.env[name];
    try {
      const target = new URL(value ?? "");
      if (
        (target.protocol !== "https:" && process.env.NODE_ENV === "production") ||
        (target.protocol !== "http:" && target.protocol !== "https:")
      ) {
        throw new Error("invalid redirect protocol");
      }
      return target.toString();
    } catch {
      throw new ServiceUnavailableException({ code: `${name}_NOT_CONFIGURED` });
    }
  }

  private redirect(reply: FastifyReply, target: string) {
    return reply.code(302).header("location", target).send();
  }
}
