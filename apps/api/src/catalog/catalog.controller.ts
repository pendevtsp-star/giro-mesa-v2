import {
  type ContactRequestInput,
  contactRequestSchema,
  type TrialApplicationRequestInput,
  trialApplicationRequestSchema,
} from "@giromesa/contracts";
import { Body, Controller, Get, Post } from "@nestjs/common";
import { ZodPipe } from "../common/zod.pipe.js";
import { DatabaseContext } from "../database/database-context.decorator.js";
import { CatalogService } from "./catalog.service.js";

@DatabaseContext("public")
@Controller(["api/v1/public", "public/v1"])
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get("commercial-catalog")
  catalog() {
    return this.catalogService.publicCatalog();
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
