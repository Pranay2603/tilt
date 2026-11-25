import { Module } from "@nestjs/common";
import { DbModule } from "./db/db.module";
import { ExperimentsModule } from "./experiments/experiments.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [DbModule.forRoot(), ExperimentsModule],
  controllers: [HealthController],
})
export class AppModule {}
