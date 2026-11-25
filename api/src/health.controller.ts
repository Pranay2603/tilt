import { Controller, Get, Inject } from "@nestjs/common";
import { DbService } from "./db/db.service";
import { EventsQueue } from "./queue/events.queue";
import { RedisService } from "./redis/redis.service";

@Controller("health")
export class HealthController {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(EventsQueue) private readonly events: EventsQueue,
  ) {}

  @Get()
  async check() {
    await this.db.query("SELECT 1");
    await this.redis.client.ping();
    return { status: "ok", queue: await this.events.depth() };
  }
}
