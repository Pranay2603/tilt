import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRng } from "@tilt/engine";
import { DbModule } from "../src/db/db.module";
import { DbService } from "../src/db/db.service";
import { ExperimentsController } from "../src/experiments/experiments.controller";
import { ExperimentsService, RNG } from "../src/experiments/experiments.service";
import { HealthController } from "../src/health.controller";
import { EventsQueue } from "../src/queue/events.queue";
import { QueueModule } from "../src/queue/queue.module";
import { RedisModule } from "../src/redis/redis.module";
import { RedisService } from "../src/redis/redis.service";

const TEST_URL = process.env.TEST_DATABASE_URL ?? "postgres://tilt:tilt@localhost:5433/tilt_test";
const REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6380";
const PREFIX = "tilt-test";

let app: INestApplication;
let db: DbService;
let redis: RedisService;
let events: EventsQueue;

/** Remove every key this test suite owns, and nothing else in the Redis instance. */
const clearRedis = async () => {
  const keys = await redis.client.keys(`${PREFIX}:*`);
  if (keys.length > 0) await redis.client.del(...keys);
};

/** Wait for the worker to finish, then read what PostgreSQL holds. */
const settled = async (key = "cta-copy") => {
  await events.drain();
  const r = await db.query<{ key: string; impressions: string; conversions: string }>(
    `SELECT v.key, v.impressions, v.conversions FROM variants v JOIN experiments e ON e.id = v.experiment_id
      WHERE e.key = $1 ORDER BY v.position`,
    [key],
  );
  return r.rows.map((v) => ({ key: v.key, impressions: Number(v.impressions), conversions: Number(v.conversions) }));
};

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [DbModule.forRoot(TEST_URL), RedisModule.forRoot({ url: REDIS_URL, prefix: PREFIX }), QueueModule],
    controllers: [ExperimentsController, HealthController],
    providers: [ExperimentsService, { provide: RNG, useValue: createRng(1234) }],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  db = app.get(DbService);
  redis = app.get(RedisService);
  events = app.get(EventsQueue);
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await events.drain();
  await events.queue.obliterate({ force: true });
  await clearRedis();
  await db.query("TRUNCATE assignments, variants, experiments RESTART IDENTITY CASCADE");
});

const body = {
  key: "cta-copy",
  name: "Checkout button copy",
  variants: [
    { key: "control", name: "Buy now" },
    { key: "b", name: "Get it today" },
  ],
};

describe("health", () => {
  it("reports ok when the database answers", async () => {
    const res = await request(app.getHttpServer()).get("/health").expect(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.queue).toMatchObject({ waiting: 0, failed: 0 });
  });
});

describe("creating experiments", () => {
  it("creates an experiment with zeroed variants", async () => {
    const res = await request(app.getHttpServer()).post("/experiments").send(body).expect(201);
    expect(res.body.key).toBe("cta-copy");
    expect(res.body.variants.map((v: { key: string }) => v.key)).toEqual(["control", "b"]);
    expect(res.body.impressions).toBe(0);
  });

  it("rejects a duplicate key with 409", async () => {
    await request(app.getHttpServer()).post("/experiments").send(body).expect(201);
    await request(app.getHttpServer()).post("/experiments").send(body).expect(409);
  });

  it("rejects bad input with 400 and a readable list of issues", async () => {
    const res = await request(app.getHttpServer())
      .post("/experiments")
      .send({ key: "Bad Key", name: "", variants: [{ key: "a", name: "A" }] })
      .expect(400);
    expect(res.body.issues.length).toBeGreaterThan(0);
  });

  it("rejects duplicate variant keys", async () => {
    await request(app.getHttpServer())
      .post("/experiments")
      .send({ ...body, variants: [{ key: "a", name: "A" }, { key: "a", name: "Again" }] })
      .expect(400);
  });

  it("returns 404 for an unknown experiment", async () => {
    await request(app.getHttpServer()).get("/experiments/nope").expect(404);
  });
});

describe("assignment", () => {
  beforeEach(async () => {
    await request(app.getHttpServer()).post("/experiments").send(body).expect(201);
  });

  it("is sticky: a visitor always gets the same variant", async () => {
    const first = await request(app.getHttpServer()).post("/experiments/cta-copy/assign").send({ userKey: "u1" });
    expect(first.body.returning).toBe(false);
    for (let i = 0; i < 5; i++) {
      const again = await request(app.getHttpServer()).post("/experiments/cta-copy/assign").send({ userKey: "u1" });
      expect(again.body.variant.key).toBe(first.body.variant.key);
      expect(again.body.returning).toBe(true);
    }
    const state = await request(app.getHttpServer()).get("/experiments/cta-copy");
    expect(state.body.impressions).toBe(1);
  });

  it("counts one impression per visitor even under concurrent first visits", async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        request(app.getHttpServer()).post("/experiments/cta-copy/assign").send({ userKey: "racer" }),
      ),
    );
    const variants = new Set(results.map((r) => r.body.variant.key));
    expect(variants.size).toBe(1);
    expect(results.filter((r) => r.body.returning === false)).toHaveLength(1);
    const state = await request(app.getHttpServer()).get("/experiments/cta-copy");
    expect(state.body.impressions).toBe(1);
  });

  it("never loses an impression when many different visitors arrive at once", async () => {
    await Promise.all(
      Array.from({ length: 60 }, (_, i) =>
        request(app.getHttpServer()).post("/experiments/cta-copy/assign").send({ userKey: `v${i}` }),
      ),
    );
    const state = await request(app.getHttpServer()).get("/experiments/cta-copy");
    expect(state.body.impressions).toBe(60);
  });

  it("404s for an unknown experiment", async () => {
    await request(app.getHttpServer()).post("/experiments/missing/assign").send({ userKey: "u" }).expect(404);
  });
});

describe("rewards", () => {
  beforeEach(async () => {
    await request(app.getHttpServer()).post("/experiments").send(body).expect(201);
  });

  it("counts a conversion once, however often it is reported", async () => {
    await request(app.getHttpServer()).post("/experiments/cta-copy/assign").send({ userKey: "u1" });
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app.getHttpServer()).post("/experiments/cta-copy/reward").send({ userKey: "u1" }),
      ),
    );
    expect(results.filter((r) => r.body.counted === true)).toHaveLength(1);
    const state = await request(app.getHttpServer()).get("/experiments/cta-copy");
    expect(state.body.conversions).toBe(1);
  });

  it("rejects a reward from a visitor who was never assigned", async () => {
    await request(app.getHttpServer()).post("/experiments/cta-copy/reward").send({ userKey: "ghost" }).expect(404);
  });

  it("the database refuses conversions above impressions", async () => {
    await db.query("INSERT INTO experiments (key, name) VALUES ('x-check', 'x')");
    await expect(
      db.query(
        "INSERT INTO variants (experiment_id, key, name, position, impressions, conversions) SELECT id, 'a', 'A', 0, 1, 2 FROM experiments WHERE key = 'x-check'",
      ),
    ).rejects.toThrow();
  });
});

describe("queue and persistence", () => {
  beforeEach(async () => {
    await request(app.getHttpServer()).post("/experiments").send(body).expect(201);
  });

  it("PostgreSQL ends up exactly equal to what Redis served", async () => {
    const rng = createRng(5);
    for (let i = 0; i < 120; i++) {
      await request(app.getHttpServer()).post("/experiments/cta-copy/assign").send({ userKey: `s${i}` });
      if (rng() < 0.3) await request(app.getHttpServer()).post("/experiments/cta-copy/reward").send({ userKey: `s${i}` });
    }
    const live = (await request(app.getHttpServer()).get("/experiments/cta-copy")).body;
    const stored = await settled();
    expect(stored.map((v) => v.impressions)).toEqual(live.variants.map((v: { impressions: number }) => v.impressions));
    expect(stored.map((v) => v.conversions)).toEqual(live.variants.map((v: { conversions: number }) => v.conversions));
    expect(live.impressions).toBe(120);
  });

  it("a conversion that arrives before its assignment is saved is retried, not lost", async () => {
    // Stop the worker's view of the queue so the assignment is certainly not in PostgreSQL yet.
    await events.queue.pause();
    await request(app.getHttpServer()).post("/experiments/cta-copy/assign").send({ userKey: "early" });
    await request(app.getHttpServer()).post("/experiments/cta-copy/reward").send({ userKey: "early" });
    expect((await db.query("SELECT 1 FROM assignments")).rowCount).toBe(0);
    await events.queue.resume();
    const stored = await settled();
    expect(stored.reduce((s, v) => s + v.impressions, 0)).toBe(1);
    expect(stored.reduce((s, v) => s + v.conversions, 0)).toBe(1);
  });

  it("serves requests while the worker is far behind", async () => {
    await events.queue.pause();
    const t0 = Date.now();
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        request(app.getHttpServer()).post("/experiments/cta-copy/assign").send({ userKey: `fast${i}` }).expect(200),
      ),
    );
    expect(Date.now() - t0).toBeLessThan(5000);
    expect((await events.depth()).waiting).toBe(50);
    await events.queue.resume();
    const stored = await settled();
    expect(stored.reduce((s, v) => s + v.impressions, 0)).toBe(50);
  });

  it("rebuilds from PostgreSQL after Redis is wiped, and keeps visitors on their variant", async () => {
    const first: Record<string, string> = {};
    for (let i = 0; i < 20; i++) {
      const r = await request(app.getHttpServer()).post("/experiments/cta-copy/assign").send({ userKey: `w${i}` });
      first[`w${i}`] = r.body.variant.key;
    }
    await request(app.getHttpServer()).post("/experiments/cta-copy/reward").send({ userKey: "w0" });
    await settled();

    await clearRedis(); // simulate a flushed or restarted cache

    const state = await request(app.getHttpServer()).get("/experiments/cta-copy");
    expect(state.body.impressions).toBe(20);
    expect(state.body.conversions).toBe(1);

    // The conversion survives too: reporting it again must not count twice.
    const again = await request(app.getHttpServer()).post("/experiments/cta-copy/reward").send({ userKey: "w0" });
    expect(again.body.counted).toBe(false);

    // Visitors may briefly be re-drawn, but PostgreSQL wins and the cache is repaired.
    for (let i = 0; i < 20; i++) {
      await request(app.getHttpServer()).post("/experiments/cta-copy/assign").send({ userKey: `w${i}` });
    }
    const stored = await settled();
    const live = (await request(app.getHttpServer()).get("/experiments/cta-copy")).body;
    expect(live.impressions).toBe(20);
    expect(stored.map((v) => v.impressions)).toEqual(live.variants.map((v: { impressions: number }) => v.impressions));
    for (let i = 0; i < 20; i++) {
      const r = await request(app.getHttpServer()).post("/experiments/cta-copy/assign").send({ userKey: `w${i}` });
      expect(r.body.variant.key).toBe(first[`w${i}`]);
    }
  });
});

describe("learning", () => {
  it("shifts traffic toward the better variant as evidence builds", async () => {
    await request(app.getHttpServer()).post("/experiments").send(body).expect(201);
    const rates: Record<string, number> = { control: 0.03, b: 0.2 };
    const rng = createRng(99);
    const served: Record<string, number> = { control: 0, b: 0 };
    for (let i = 0; i < 400; i++) {
      const a = await request(app.getHttpServer()).post("/experiments/cta-copy/assign").send({ userKey: `p${i}` });
      const k = a.body.variant.key as string;
      served[k] = (served[k] ?? 0) + 1;
      if (rng() < rates[k]!) {
        await request(app.getHttpServer()).post("/experiments/cta-copy/reward").send({ userKey: `p${i}` });
      }
    }
    expect(served.b!).toBeGreaterThan(served.control!);
    const state = await request(app.getHttpServer()).get("/experiments/cta-copy");
    const b = state.body.variants.find((v: { key: string }) => v.key === "b");
    expect(b.probabilityBest).toBeGreaterThan(0.95);
  });
});
