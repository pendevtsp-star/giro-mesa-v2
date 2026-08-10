import { Controller, Get, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../auth/session.guard.js";
import { PlatformAdminGuard } from "./platform.guard.js";
import { PlatformService } from "./platform.service.js";

@UseGuards(SessionGuard, PlatformAdminGuard)
@Controller(["api/v1/platform", "v1/platform"])
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get("overview")
  overview() {
    return this.platform.overview();
  }
}
