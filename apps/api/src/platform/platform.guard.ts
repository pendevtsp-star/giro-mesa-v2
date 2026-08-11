import { CanActivate, type ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { platformAccessFor } from "./platform-access.js";

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const access = platformAccessFor(request.auth.email);
    if (!access.permissions.includes("platform.read")) throw new ForbiddenException();
    return true;
  }
}
