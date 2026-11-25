import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { chooseThompson, probabilityBest, type Arm, type Rng } from "@tilt/engine";
import { DbService } from "../db/db.service";
import type { CreateExperiment } from "./experiments.schemas";

export const RNG = Symbol("RNG");

interface VariantRow {
  id: string;
  key: string;
  name: string;
  position: number;
  impressions: string; // bigint arrives as a string from node-postgres
  conversions: string;
}

/**
 * Posterior for a variant. A visitor who has not converted yet counts as a
 * failure, which makes Tilt slightly cautious early and exact once rewards land.
 * Real deployments usually add an attribution window; see the README.
 */
const toArm = (v: VariantRow): Arm => {
  const impressions = Number(v.impressions);
  const conversions = Number(v.conversions);
  return { alpha: 1 + conversions, beta: 1 + (impressions - conversions) };
};

@Injectable()
export class ExperimentsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
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
    const exp = await this.db.query<{ id: string; key: string; name: string; created_at: Date }>(
      "SELECT id, key, name, created_at FROM experiments WHERE key = $1",
      [key],
    );
    const experiment = exp.rows[0];
    if (!experiment) throw new NotFoundException(`Experiment "${key}" not found`);

    const rows = (
      await this.db.query<VariantRow>(
        "SELECT id, key, name, position, impressions, conversions FROM variants WHERE experiment_id = $1 ORDER BY position",
        [experiment.id],
      )
    ).rows;
    const arms = rows.map(toArm);
    const best = probabilityBest(arms, this.rng, 4000);

    const variants = rows.map((v, i) => {
      const impressions = Number(v.impressions);
      const conversions = Number(v.conversions);
      return {
        key: v.key,
        name: v.name,
        impressions,
        conversions,
        rate: impressions === 0 ? 0 : conversions / impressions,
        probabilityBest: best[i] ?? 0,
      };
    });
    const impressions = variants.reduce((s, v) => s + v.impressions, 0);
    const conversions = variants.reduce((s, v) => s + v.conversions, 0);

    return {
      key: experiment.key,
      name: experiment.name,
      createdAt: experiment.created_at,
      impressions,
      conversions,
      variants,
    };
  }

  /**
   * Give a visitor a variant. The first call samples from each variant's
   * posterior (Thompson sampling); later calls return the same variant.
   */
  async assign(key: string, userKey: string) {
    return this.db.tx(async (c) => {
      const exp = await c.query<{ id: string }>("SELECT id FROM experiments WHERE key = $1", [key]);
      const experimentId = exp.rows[0]?.id;
      if (!experimentId) throw new NotFoundException(`Experiment "${key}" not found`);

      const existing = await this.existingAssignment(c, experimentId, userKey);
      if (existing) return { experiment: key, userKey, variant: existing, returning: true };

      const rows = (
        await c.query<VariantRow>(
          "SELECT id, key, name, position, impressions, conversions FROM variants WHERE experiment_id = $1 ORDER BY position",
          [experimentId],
        )
      ).rows;
      const chosen = rows[chooseThompson(rows.map(toArm), this.rng)]!;

      // ON CONFLICT makes two simultaneous first visits from the same visitor safe:
      // exactly one inserts, the other falls through and reads the winner's row.
      const inserted = await c.query(
        `INSERT INTO assignments (experiment_id, variant_id, user_key)
         VALUES ($1, $2, $3)
         ON CONFLICT (experiment_id, user_key) DO NOTHING
         RETURNING id`,
        [experimentId, chosen.id, userKey],
      );
      if (inserted.rowCount === 0) {
        const winner = await this.existingAssignment(c, experimentId, userKey);
        return { experiment: key, userKey, variant: winner!, returning: true };
      }

      // A single UPDATE takes the row lock, so concurrent increments never lose a write.
      await c.query("UPDATE variants SET impressions = impressions + 1 WHERE id = $1", [chosen.id]);
      return { experiment: key, userKey, variant: { key: chosen.key, name: chosen.name }, returning: false };
    });
  }

  /** Record a conversion. Counted at most once per visitor, however often it is reported. */
  async reward(key: string, userKey: string) {
    return this.db.tx(async (c) => {
      const exp = await c.query<{ id: string }>("SELECT id FROM experiments WHERE key = $1", [key]);
      const experimentId = exp.rows[0]?.id;
      if (!experimentId) throw new NotFoundException(`Experiment "${key}" not found`);

      // Only the request that flips converted_at from NULL gets a row back. A concurrent
      // duplicate waits for this row lock, re-checks the condition, and matches nothing.
      const flipped = await c.query<{ variant_id: string }>(
        `UPDATE assignments SET converted_at = now()
         WHERE experiment_id = $1 AND user_key = $2 AND converted_at IS NULL
         RETURNING variant_id`,
        [experimentId, userKey],
      );
      if (flipped.rowCount === 1) {
        await c.query("UPDATE variants SET conversions = conversions + 1 WHERE id = $1", [
          flipped.rows[0]!.variant_id,
        ]);
        return { experiment: key, userKey, counted: true };
      }

      const known = await this.existingAssignment(c, experimentId, userKey);
      if (!known) throw new NotFoundException(`"${userKey}" has no assignment in "${key}"`);
      return { experiment: key, userKey, counted: false };
    });
  }

  private async existingAssignment(
    c: { query: DbService["query"] },
    experimentId: string,
    userKey: string,
  ): Promise<{ key: string; name: string } | undefined> {
    const r = await c.query<{ key: string; name: string }>(
      `SELECT v.key, v.name
         FROM assignments a JOIN variants v ON v.id = a.variant_id
        WHERE a.experiment_id = $1 AND a.user_key = $2`,
      [experimentId, userKey],
    );
    return r.rows[0];
  }
}
