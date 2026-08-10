import { Module } from "@nestjs/common";
import { PilotOperationsModule } from "../pilot-operations/pilot-operations.module.js";
import { OperationalSnapshotService } from "./operational-snapshot.service.js";
import { SyncController } from "./sync.controller.js";
import { SyncService } from "./sync.service.js";
import { SyncPilotService } from "./sync-pilot.service.js";

@Module({
  imports: [PilotOperationsModule],
  controllers: [SyncController],
  providers: [SyncService, SyncPilotService, OperationalSnapshotService],
  exports: [SyncService],
})
export class SyncModule {}
