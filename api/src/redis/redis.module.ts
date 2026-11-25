import { Global, Module, type DynamicModule } from "@nestjs/common";
import { defaultRedisConfig, REDIS_CONFIG, RedisService, type RedisConfig } from "./redis.service";

@Global()
@Module({})
export class RedisModule {
  static forRoot(config?: Partial<RedisConfig>): DynamicModule {
    return {
      module: RedisModule,
      providers: [{ provide: REDIS_CONFIG, useValue: { ...defaultRedisConfig(), ...config } }, RedisService],
      exports: [RedisService],
    };
  }
}
