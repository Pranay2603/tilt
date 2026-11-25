import { Inject, Injectable } from "@nestjs/common";
import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import pg from "pg";
import { MIGRATIONS } from "./migrations";

export const DATABASE_URL = Symbol("DATABASE_URL");

/** Any key works, as long as every instance of the server uses the same one. */
const MIGRATION_LOCK_KEY = 727_274;

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  readonly pool: pg.Pool;

  constructor(@Inject(DATABASE_URL) url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: 20 });
  }

  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]) {
    return this.pool.query<R>(text, params);
  }

  /** Run `fn` inside one transaction. Rolls back and rethrows on any error. */
  async tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async onModuleInit() {
    await this.migrate();
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  /** Apply pending migrations. An advisory lock keeps two starting servers from racing. */
  private async migrate() {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id         text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )`);
      const done = new Set(
        (await client.query<{ id: string }>("SELECT id FROM schema_migrations")).rows.map((r) => r.id),
      );
      for (const m of MIGRATIONS) {
        if (done.has(m.id)) continue;
        await client.query("BEGIN");
        try {
          await client.query(m.sql);
          await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [m.id]);
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => undefined);
      client.release();
    }
  }
}
