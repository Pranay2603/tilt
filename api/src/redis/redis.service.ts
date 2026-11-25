import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Redis } from "ioredis";

export const REDIS_CONFIG = Symbol("REDIS_CONFIG");

export interface RedisConfig {
  url: string;
  /** Every key and queue name starts with this, so tests and apps can share one Redis safely. */
  prefix: string;
}

export const defaultRedisConfig = (): RedisConfig => ({
  url: process.env.REDIS_URL ?? "redis://localhost:6380",
  prefix: process.env.REDIS_PREFIX ?? "tilt",
});

/** BullMQ wants connection options rather than a shared client, so parse the URL once. */
export const connectionOptions = (url: string) => {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password || undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === "rediss:" ? {} : undefined,
  };
};

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;
  readonly prefix: string;

  constructor(@Inject(REDIS_CONFIG) readonly config: RedisConfig) {
    this.prefix = config.prefix;
    this.client = new Redis(connectionOptions(config.url));
  }

  key(...parts: string[]): string {
    return [this.prefix, ...parts].join(":");
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
