import {
  type ContactRequestInput,
  contactRequestSchema,
  type TrialApplicationRequestInput,
  trialApplicationRequestSchema,
} from "@giromesa/contracts";
import { Body, Controller, Get, Header, Headers, Post } from "@nestjs/common";
import { z } from "zod";
import { ZodPipe } from "../common/zod.pipe.js";
import { CatalogService } from "./catalog.service.js";

@Controller(["api/v1/public", "public/v1"])
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get("commercial-catalog")
  @Header("Vary", "x-giromesa-visitor-id")
  @Header("Cache-Control", "private, no-store")
  catalog(@Headers("x-giromesa-visitor-id") rawVisitorId?: string) {
    const visitorId = rawVisitorId
      ? (new ZodPipe(
          z
            .string()
            .trim()
            .min(8)
            .max(160)
            .regex(/^[A-Za-z0-9._:-]+$/),
        ).transform(rawVisitorId) as string)
      : undefined;
    return this.catalogService.publicCatalog(visitorId);
  }

  @Post("commercial-experiment-impressions")
  experimentImpression(
    @Body(
      new ZodPipe(
        z
          .object({
            catalogVersion: z.number().int().positive(),
            experimentSlug: z.string().trim().min(2).max(80),
            variantKey: z.string().trim().min(1).max(40),
            visitorId: z
              .string()
              .trim()
              .min(8)
              .max(160)
              .regex(/^[A-Za-z0-9._:-]+$/),
          })
          .strict(),
      ),
    )
    body: { catalogVersion: number; experimentSlug: string; variantKey: string; visitorId: string },
  ) {
    return this.catalogService.recordExperimentImpression(body);
  }

  @Post("trial-applications")
  trialApplication(
    @Body(new ZodPipe(trialApplicationRequestSchema)) body: TrialApplicationRequestInput,
  ) {
    return this.catalogService.createTrialApplication(body);
  }

  @Post("contact")
  contact(@Body(new ZodPipe(contactRequestSchema)) body: ContactRequestInput) {
    return this.catalogService.createContactRequest(body);
  }
}
