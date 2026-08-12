import { publicMenuSlugSchema } from "@giromesa/contracts";
import {
  Body,
  Controller,
  Get,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { AuthModule } from "../auth/auth.module.js";
import { type AuthenticatedRequest, SessionGuard } from "../auth/session.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { DatabaseContext } from "../database/database-context.decorator.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { MediaService } from "./media.service.js";

const mediaUploadSchema = z.object({
  kind: z.enum(["logo", "cover", "product"]),
  declaredMimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  contentBase64: z.string().min(4).max(12_000_000),
});

@UseGuards(SessionGuard)
@Controller([
  "api/v1/organizations/:organizationId/units/:unitId/media/images",
  "v1/organizations/:organizationId/units/:unitId/media/images",
])
export class MediaAdminController {
  constructor(private readonly media: MediaService) {}

  @Post()
  upload(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(mediaUploadSchema)) body: z.infer<typeof mediaUploadSchema>,
  ) {
    return this.media.upload(request.auth.identityId, organizationId, unitId, body);
  }
}

@DatabaseContext("public-menu")
@Controller(["api/v1/public/menus", "public/v1/menus"])
export class PublicMediaController {
  constructor(private readonly media: MediaService) {}

  @Get(":slug/assets/:assetId")
  async asset(
    @Param("slug", new ZodPipe(publicMenuSlugSchema)) slug: string,
    @Param("assetId", ParseUUIDPipe) assetId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const asset = await this.media.publicAsset(slug, assetId);
    if (!asset)
      throw new NotFoundException({ code: "MEDIA_NOT_FOUND", message: "Imagem não encontrada." });
    reply.header("Content-Type", asset.mimeType);
    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    reply.header("ETag", `"${asset.sha256}"`);
    return asset.bytes;
  }
}

@Module({
  imports: [AuthModule, OrganizationsModule],
  controllers: [MediaAdminController, PublicMediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
