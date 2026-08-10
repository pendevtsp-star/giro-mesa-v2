import { CanActivate, type ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { isPlatformAdminEmail } from "./platform-access.js";

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    if (!isPlatformAdminEmail(request.auth.email)) throw new ForbiddenException();
    return true;
  }
}
