import { Module } from "@nestjs/common";
import { DoseClubController } from "./doseclub.controller.js";
import { DoseClubService } from "./doseclub.service.js";

@Module({ controllers: [DoseClubController], providers: [DoseClubService] })
export class DoseClubModule {}
