import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { chooseThompson, probabilityBest, type Arm, type Rng } from "@tilt/engine";
import { DbService } from "../db/db.service";
import { EventsQueue } from "../queue/events.queue";
import { RedisService } from "../redis/redis.service";
import type { CreateExperiment } from "./experiments.schemas";

export const RNG = Symbol("RNG");

interface Meta {
  key: string;
  name: string;
  createdAt: string;
  variants: { key: string; name: string }[];
}

/**
 * Redis layout (all keys start with the configured prefix):
 *   exp:<key>        JSON Meta, written last so its presence means the cache is warm
 *   cnt:<key>        hash, "<variant>:i" impressions and "<variant>:c" conversions
 *   asg:<key>:<user> the variant a visitor was given, written once with SET NX
 *   cv:<key>:<user>  "1" once a visitor's conversion has been counted
 *
 * The request path only touches Redis. PostgreSQL is filled in behind it by the queue
 * worker and stays the source of truth: a cold or flushed cache is rebuilt from it.
 */

// SET NX and HINCRBY in one script: a visitor is never given a variant without it being counted.
const ASSIGN = `
if redis.call('SET', KEYS[1], ARGV[1], 'NX') then
  redis.call('HINCRBY', KEYS[2], ARGV[1] .. ':i', 1)
  return 1
end
return 0`;

const REWARD = `
if redis.call('SET', KEYS[1], '1', 'NX') then
  redis.call('HINCRBY', KEYS[2], ARGV[1] .. ':c', 1)
  return 1
end
return 0`;

@Injectable()
export class ExperimentsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(EventsQueue) private readonly events: EventsQueue,
    @Inject(RNG) private readonly rng: Rng,
  ) {}

  async create(input: CreateExperiment) {
    try {
      await this.db.tx(async (c) => {
        const exp = await c.query<{ id: string }>(
          "INSERT INTO experiments (key, name) VALUES ($1, $2) RETURNING id",
          [input.key, input.name],
        );
        const experimentId = exp.rows[0]!.id;
        for (const [position, v] of input.variants.entries()) {
          await c.query("INSERT INTO variants (experiment_id, key, name, position) VALUES ($1, $2, $3, $4)", [
            experimentId,
            v.key,
            v.name,
            position,
          ]);
        }
      });
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw new ConflictException(`An experiment with key "${input.key}" already exists`);
      }
      throw err;
    }
    return this.state(input.key);
  }

  async state(key: string) {
    const meta = await this.meta(key);
    const counts = await this.counts(key, meta);
    const arms = counts.map(toArm);
    const best = probabilityBest(arms, this.rng, 4000);

    const variants = meta.variants.map((v, i) => {
      const { impressions, conversions } = counts[i]!;
      return {
        key: v.key,
        name: v.name,
        impressions,
        conversions,
        rate: impressions === 0 ? 0 : conversions / impressions,
        probabilityBest: best[i] ?? 0,
      };
    });
    return {
      key: meta.key,
      name: meta.name,
      createdAt: meta.createdAt,
      impressions: variants.reduce((s, v) => s + v.impressions, 0),
      conversions: variants.reduce((s, v) => s + v.conversions, 0),
      variants,
    };
  }

  /**
   * Give a visitor a variant. The first call samples each variant's posterior
   * (Thompson sampling); every later call returns the same variant.
   */
  async assign(key: string, userKey: string) {
    const r = this.redis;
    const meta = await this.meta(key);
    const asgKey = r.key("asg", key, userKey);

    const existing = await r.client.get(asgKey);
    if (existing) return this.assigned(meta, key, userKey, existing, true);

    const counts = await this.counts(key, meta);
    const chosen = meta.variants[chooseThompson(counts.map(toArm), this.rng)]!;

    const won = await r.client.eval(ASSIGN, 2, asgKey, r.key("cnt", key), chosen.key);
    if (won !== 1) {
      // Two first visits raced and the other one won; return its variant.
      const winner = (await r.client.get(asgKey)) ?? chosen.key;
      return this.assigned(meta, key, userKey, winner, true);
    }

    try {
      await this.events.add({ type: "assign", experiment: key, userKey, variant: chosen.key });
    } catch (err) {
      // Could not queue the write: undo the Redis side so state never claims more than the queue holds.
      await r.client.del(asgKey);
      await r.client.hincrby(r.key("cnt", key), `${chosen.key}:i`, -1);
      throw err;
    }
    return this.assigned(meta, key, userKey, chosen.key, false);
  }

  /** Record a conversion. Counted at most once per visitor, however often it is reported. */
  async reward(key: string, userKey: string) {
    const r = this.redis;
    await this.meta(key); // 404 for an unknown experiment
    const asgKey = r.key("asg", key, userKey);
    const cvKey = r.key("cv", key, userKey);

    let variant = await r.client.get(asgKey);
    if (!variant) {
      // Cache miss (for example Redis was flushed): fall back to PostgreSQL.
      const row = await this.db.query<{ variant: string; converted: boolean }>(
        `SELECT v.key AS variant, a.converted_at IS NOT NULL AS converted
           FROM assignments a JOIN variants v ON v.id = a.variant_id JOIN experiments ex ON ex.id = a.experiment_id
          WHERE ex.key = $1 AND a.user_key = $2`,
        [key, userKey],
      );
      const found = row.rows[0];
      if (!found) throw new NotFoundException(`"${userKey}" has no assignment in "${key}"`);
      variant = found.variant;
      await r.client.set(asgKey, variant, "NX");
      if (found.converted) {
        await r.client.set(cvKey, "1", "NX");
        return { experiment: key, userKey, counted: false };
      }
    }

    const won = await r.client.eval(REWARD, 2, cvKey, r.key("cnt", key), variant);
    if (won !== 1) return { experiment: key, userKey, counted: false };

    try {
      await this.events.add({ type: "reward", experiment: key, userKey });
    } catch (err) {
      await r.client.del(cvKey);
      await r.client.hincrby(r.key("cnt", key), `${variant}:c`, -1);
      throw err;
    }
    return { experiment: key, userKey, counted: true };
  }

  /**
   * Compare what Redis served with what PostgreSQL has stored, plus the queue backlog.
   * `consistent` is true once the worker has caught up and the two agree exactly.
   */
  async audit(key: string) {
    const meta = await this.meta(key);
    const redis = await this.counts(key, meta);
    const stored = await this.db.query<{ key: string; impressions: string; conversions: string }>(
      `SELECT v.key, v.impressions, v.conversions FROM variants v JOIN experiments e ON e.id = v.experiment_id
        WHERE e.key = $1 ORDER BY v.position`,
      [key],
    );
    const postgres = stored.rows.map((v) => ({
      impressions: Number(v.impressions),
      conversions: Number(v.conversions),
    }));
    const queue = await this.events.depth();
    const same = JSON.stringify(redis) === JSON.stringify(postgres);
    const sum = (rows: { impressions: number; conversions: number }[], f: "impressions" | "conversions") =>
      rows.reduce((t, r) => t + r[f], 0);
    return {
      key,
      redis: { impressions: sum(redis, "impressions"), conversions: sum(redis, "conversions") },
      postgres: { impressions: sum(postgres, "impressions"), conversions: sum(postgres, "conversions") },
      queue,
      consistent: same && queue.waiting + queue.active + queue.delayed === 0,
    };
  }

  private assigned(meta: Meta, key: string, userKey: string, variantKey: string, returning: boolean) {
    const v = meta.variants.find((x) => x.key === variantKey);
    return { experiment: key, userKey, variant: { key: variantKey, name: v?.name ?? variantKey }, returning };
  }

  /** Experiment definition from Redis, rebuilt from PostgreSQL when the cache is cold. */
  private async meta(key: string): Promise<Meta> {
    const r = this.redis;
    const cached = await r.client.get(r.key("exp", key));
    if (cached) return JSON.parse(cached) as Meta;

    const exp = await this.db.query<{ id: string; name: string; created_at: Date }>(
      "SELECT id, name, created_at FROM experiments WHERE key = $1",
      [key],
    );
    const row = exp.rows[0];
    if (!row) throw new NotFoundException(`Experiment "${key}" not found`);
    const vars = (
      await this.db.query<{ key: string; name: string; impressions: string; conversions: string }>(
        "SELECT key, name, impressions, conversions FROM variants WHERE experiment_id = $1 ORDER BY position",
        [row.id],
      )
    ).rows;

    // HSETNX, not HSET: if another request already warmed the cache and started counting,
    // its numbers are newer than what PostgreSQL has and must not be overwritten.
    const pipe = r.client.pipeline();
    for (const v of vars) {
      pipe.hsetnx(r.key("cnt", key), `${v.key}:i`, v.impressions);
      pipe.hsetnx(r.key("cnt", key), `${v.key}:c`, v.conversions);
    }
    await pipe.exec();

    await this.restoreAssignments(key, row.id);

    const meta: Meta = {
      key,
      name: row.name,
      createdAt: row.created_at.toISOString(),
      variants: vars.map((v) => ({ key: v.key, name: v.name })),
    };
    await r.client.set(r.key("exp", key), JSON.stringify(meta), "NX");
    return meta;
  }

  /**
   * After a cold start, put every saved assignment (and conversion flag) back into Redis, so a
   * returning visitor is never drawn a second time. SET NX never overwrites a newer value.
   */
  private async restoreAssignments(key: string, experimentId: string) {
    const r = this.redis;
    let after = "0";
    for (;;) {
      const page = await this.db.query<{ id: string; user_key: string; variant: string; converted: boolean }>(
        `SELECT a.id, a.user_key, v.key AS variant, a.converted_at IS NOT NULL AS converted
           FROM assignments a JOIN variants v ON v.id = a.variant_id
          WHERE a.experiment_id = $1 AND a.id > $2
          ORDER BY a.id LIMIT 5000`,
        [experimentId, after],
      );
      if (page.rows.length === 0) return;
      const pipe = r.client.pipeline();
      for (const a of page.rows) {
        pipe.set(r.key("asg", key, a.user_key), a.variant, "NX");
        if (a.converted) pipe.set(r.key("cv", key, a.user_key), "1", "NX");
      }
      await pipe.exec();
      after = page.rows[page.rows.length - 1]!.id;
    }
  }

  private async counts(key: string, meta: Meta) {
    const h = await this.redis.client.hgetall(this.redis.key("cnt", key));
    return meta.variants.map((v) => ({
      impressions: Number(h[`${v.key}:i`] ?? 0),
      conversions: Number(h[`${v.key}:c`] ?? 0),
    }));
  }
}

const toArm = (c: { impressions: number; conversions: number }): Arm => ({
  alpha: 1 + c.conversions,
  beta: 1 + (c.impressions - c.conversions),
});
