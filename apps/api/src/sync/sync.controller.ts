import { Body, Controller, Headers, HttpCode, Post } from "@nestjs/common";
import { ZodPipe } from "../common/zod.pipe.js";
import { type SyncBatchInput, syncBatchSchema } from "./sync.schemas.js";
import { SyncService } from "./sync.service.js";

export function hubSyncKey(authorization: string | undefined) {
  if (!authorization?.startsWith("GiroMesaHub ")) return undefined;
  return authorization.slice("GiroMesaHub ".length).trim() || undefined;
}

@Controller(["api/v1/sync", "v1/sync"])
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @HttpCode(200)
  @Post("batches")
  synchronize(
    @Headers("authorization") authorization: string | undefined,
    @Body(new ZodPipe(syncBatchSchema)) body: SyncBatchInput,
  ) {
    return this.sync.synchronize(hubSyncKey(authorization), body);
  }
}
