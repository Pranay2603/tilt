import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import { DbService } from "../db/db.service";
import { RedisService, connectionOptions } from "../redis/redis.service";
import { QUEUE_NAME } from "./events.queue";
import type { TiltEvent } from "./events";

/**
 * Copies events from the queue into PostgreSQL. Each write is idempotent, so BullMQ can
 * retry or replay a job without double counting.
 */
@Injectable()
export class EventsWorker implements OnModuleInit, OnModuleDestroy {
  private worker?: Worker<TiltEvent>;

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  onModuleInit() {
    if (process.env.RUN_WORKER === "false") return; // lets you run the worker as its own process
    this.worker = new Worker<TiltEvent>(QUEUE_NAME, (job) => this.handle(job.data), {
      connection: connectionOptions(this.redis.config.url),
      prefix: `${this.redis.prefix}:bull`,
      concurrency: 16,
    });
    this.worker.on("error", () => {}); // connection blips are retried by BullMQ itself
  }

  async handle(event: TiltEvent) {
    return event.type === "assign" ? this.persistAssign(event) : this.persistReward(event);
  }

  private persistAssign(e: Extract<TiltEvent, { type: "assign" }>) {
    return this.db.tx(async (c) => {
      const inserted = await c.query(
        `INSERT INTO assignments (experiment_id, variant_id, user_key)
         SELECT ex.id, v.id, $3
           FROM experiments ex JOIN variants v ON v.experiment_id = ex.id
          WHERE ex.key = $1 AND v.key = $2
         ON CONFLICT (experiment_id, user_key) DO NOTHING
         RETURNING variant_id`,
        [e.experiment, e.variant, e.userKey],
      );
      // Only the job that actually inserted the row counts the impression.
      if (inserted.rowCount === 1) {
        await c.query("UPDATE variants SET impressions = impressions + 1 WHERE id = $1", [
          inserted.rows[0].variant_id,
        ]);
        return null;
      }
      const saved = await c.query<{ key: string }>(
        `SELECT v.key FROM assignments a JOIN variants v ON v.id = a.variant_id JOIN experiments ex ON ex.id = a.experiment_id
          WHERE ex.key = $1 AND a.user_key = $2`,
        [e.experiment, e.userKey],
      );
      return saved.rows[0]?.key ?? null;
    }).then((saved) => this.repairCache(e, saved));
  }

  /**
   * PostgreSQL already had a different variant for this visitor. After a cold start the cache
   * is rebuilt from the database, so this only happens if Redis dropped a single key (for
   * example under memory pressure; run it with maxmemory-policy noeviction). The database
   * wins: restore its variant and take back the impression Redis counted for the wrong one.
   */
  private async repairCache(e: Extract<TiltEvent, { type: "assign" }>, saved: string | null) {
    if (!saved || saved === e.variant) return;
    const r = this.redis;
    await r.client.set(r.key("asg", e.experiment, e.userKey), saved);
    await r.client.hincrby(r.key("cnt", e.experiment), `${e.variant}:i`, -1);
  }

  private persistReward(e: Extract<TiltEvent, { type: "reward" }>) {
    return this.db.tx(async (c) => {
      const flipped = await c.query<{ variant_id: string }>(
        `UPDATE assignments a SET converted_at = now()
           FROM experiments ex
          WHERE ex.id = a.experiment_id AND ex.key = $1 AND a.user_key = $2 AND a.converted_at IS NULL
         RETURNING a.variant_id`,
        [e.experiment, e.userKey],
      );
      if (flipped.rowCount === 1) {
        await c.query("UPDATE variants SET conversions = conversions + 1 WHERE id = $1", [
          flipped.rows[0]!.variant_id,
        ]);
        return;
      }
      // Nothing flipped. Either this visitor was already counted (fine, skip) or their assignment
      // is not saved yet (retry later). Only a row that says "converted" proves the first case; a
      // row that merely exists may have been committed between the two statements.
      const done = await c.query(
        `SELECT 1 FROM assignments a JOIN experiments ex ON ex.id = a.experiment_id
          WHERE ex.key = $1 AND a.user_key = $2 AND a.converted_at IS NOT NULL`,
        [e.experiment, e.userKey],
      );
      if (done.rowCount === 0) throw new Error("assignment not persisted yet");
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
