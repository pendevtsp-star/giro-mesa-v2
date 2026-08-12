import { type ArgumentsHost, Catch, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { platformHttpException } from "./platform-errors.js";

@Catch()
export class PlatformExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const mapped = platformHttpException(exception);
    host
      .switchToHttp()
      .getResponse<FastifyReply>()
      .status(mapped.getStatus())
      .send(mapped.getResponse());
  }
}
