import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ZodPipe } from "../common/zod.pipe.js";
import { type AuthenticatedRequest, SessionGuard } from "./session.guard.js";
import {
  clearSessionCookieOptions,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "./session-cookie.js";
import { TerminalSessionService } from "./terminal-session.service.js";

const id = z.string().uuid();
const pin = z.string().regex(/^\d{6}$/, "O PIN deve ter exatamente 6 dígitos.");
const configurePinSchema = z
  .object({ membershipId: id, currentPassword: z.string().min(1).max(128), pin })
  .strict();
const createTerminalSchema = z
  .object({ organizationId: id, unitId: id, deviceId: id.optional() })
  .strict();
const unlockSchema = z.object({ membershipId: id, pin }).strict();
const activitySchema = z.object({ actorEpoch: z.number().int().nonnegative() }).strict();
const lockSchema = z
  .object({ reason: z.enum(["manual", "idle", "switch"]).default("manual") })
  .strict()
  .default({ reason: "manual" });

function terminalToken(request: FastifyRequest) {
  const token = request.cookies[SESSION_COOKIE_NAME];
  if (!token) throw new UnauthorizedException({ code: "TERMINAL_SESSION_REQUIRED" });
  return token;
}

@Controller(["api/v1/auth", "v1/auth"])
export class TerminalSessionController {
  constructor(private readonly terminals: TerminalSessionService) {}

  @UseGuards(SessionGuard)
  @Put("terminal-pin")
  configurePin(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodPipe(configurePinSchema)) body: z.infer<typeof configurePinSchema>,
  ) {
    if (request.auth.authKind === "terminal") {
      throw new UnauthorizedException({ code: "IDENTITY_SESSION_REQUIRED" });
    }
    return this.terminals.configurePin(request.auth.identityId, body);
  }

  @HttpCode(204)
  @UseGuards(SessionGuard)
  @Delete("terminal-pin/:membershipId")
  async revokePin(
    @Req() request: AuthenticatedRequest,
    @Param("membershipId") membershipId: string,
  ) {
    if (request.auth.authKind === "terminal") {
      throw new UnauthorizedException({ code: "IDENTITY_SESSION_REQUIRED" });
    }
    await this.terminals.revokePin(request.auth.identityId, id.parse(membershipId));
  }

  @UseGuards(SessionGuard)
  @Post("terminal-session")
  async create(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body(new ZodPipe(createTerminalSchema)) body: z.infer<typeof createTerminalSchema>,
  ) {
    const result = await this.terminals.create(request.auth, body);
    reply.setCookie(SESSION_COOKIE_NAME, result.token, sessionCookieOptions(result.expiresAt));
    return result.view;
  }

  @Get("terminal-session")
  status(@Req() request: FastifyRequest) {
    return this.terminals.status(terminalToken(request));
  }

  @HttpCode(200)
  @Post("terminal-session/unlock")
  unlock(
    @Req() request: FastifyRequest,
    @Body(new ZodPipe(unlockSchema)) body: z.infer<typeof unlockSchema>,
  ) {
    return this.terminals.unlock(terminalToken(request), body.membershipId, body.pin);
  }

  @HttpCode(200)
  @Post("terminal-session/activity")
  activity(
    @Req() request: FastifyRequest,
    @Body(new ZodPipe(activitySchema)) body: z.infer<typeof activitySchema>,
  ) {
    return this.terminals.activity(terminalToken(request), body.actorEpoch);
  }

  @HttpCode(200)
  @Post("terminal-session/lock")
  lock(
    @Req() request: FastifyRequest,
    @Body(new ZodPipe(lockSchema)) body: z.infer<typeof lockSchema>,
  ) {
    return this.terminals.lock(terminalToken(request), body.reason);
  }

  @HttpCode(204)
  @Delete("terminal-session")
  async close(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.terminals.close(terminalToken(request));
    reply.clearCookie(SESSION_COOKIE_NAME, clearSessionCookieOptions());
  }
}
