import { Global, Module } from "@nestjs/common";
import type { DynamicModule } from "@nestjs/common";
import { DATABASE_URL, DbService } from "./db.service";

export const DEFAULT_DATABASE_URL = "postgres://tilt:tilt@localhost:5433/tilt";

@Global()
@Module({})
export class DbModule {
  static forRoot(url?: string): DynamicModule {
    return {
      module: DbModule,
      providers: [
        { provide: DATABASE_URL, useValue: url ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL },
        DbService,
      ],
      exports: [DbService],
    };
  }
}
