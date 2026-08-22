import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { SessionGuard } from "./session.guard.js";
import { TerminalSessionController } from "./terminal-session.controller.js";
import { TerminalSessionService } from "./terminal-session.service.js";

@Module({
  controllers: [AuthController, TerminalSessionController],
  providers: [AuthService, TerminalSessionService, SessionGuard],
  exports: [AuthService, TerminalSessionService, SessionGuard],
})
export class AuthModule {}
