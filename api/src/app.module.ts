import { Module } from "@nestjs/common";
import { DbModule } from "./db/db.module";
import { ExperimentsModule } from "./experiments/experiments.module";
import { HealthController } from "./health.controller";
import { QueueModule } from "./queue/queue.module";
import { RedisModule } from "./redis/redis.module";

@Module({
  imports: [DbModule.forRoot(), RedisModule.forRoot(), QueueModule, ExperimentsModule],
  controllers: [HealthController],
})
export class AppModule {}
