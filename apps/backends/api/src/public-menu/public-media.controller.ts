import { createReadStream } from "node:fs";
import { Controller, Get, NotFoundException, Param, Res, StreamableFile } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { resolvePublicMedia } from "./public-media.js";

@Controller(["api/v1/public/media", "public/v1/media"])
export class PublicMediaController {
  @Get(":key")
  async media(@Param("key") key: string, @Res({ passthrough: true }) response: FastifyReply) {
    const file = await resolvePublicMedia(key, process.env.MEDIA_ROOT);
    if (!file) {
      throw new NotFoundException({
        code: "PUBLIC_MEDIA_NOT_FOUND",
        message: "Mídia não encontrada.",
      });
    }
    response.header("Cache-Control", "public, max-age=31536000, immutable");
    response.header("Content-Type", file.contentType);
    response.header("Content-Length", String(file.size));
    response.header("X-Content-Type-Options", "nosniff");
    return new StreamableFile(createReadStream(file.path));
  }
}
