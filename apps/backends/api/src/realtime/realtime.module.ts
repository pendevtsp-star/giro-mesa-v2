import { Global, Module } from "@nestjs/common";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { RealtimeService } from "./realtime.service.js";

@Global()
@Module({
  imports: [OrganizationsModule],
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
