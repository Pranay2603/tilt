import { Controller, Get, Inject } from "@nestjs/common";
import { DbService } from "./db/db.service";

@Controller("health")
export class HealthController {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  @Get()
  async check() {
    await this.db.query("SELECT 1");
    return { status: "ok" };
  }
}
