import { Module } from "@nestjs/common";
import { ExperimentsController } from "./experiments.controller";
import { ExperimentsService, RNG } from "./experiments.service";

@Module({
  controllers: [ExperimentsController],
  providers: [ExperimentsService, { provide: RNG, useValue: () => Math.random() }],
})
export class ExperimentsModule {}
