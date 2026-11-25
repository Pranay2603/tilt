# Tilt

An A/B testing engine that moves traffic toward the winning variant while the test is still running.

Fixed 50/50 tests keep sending visitors to variants they already suspect are worse. Tilt uses Thompson sampling to shift traffic toward the winner as evidence builds. The same TypeScript engine runs on the server and in the browser, so every figure on the website is the real engine, not a recording.

## Layout

| Folder | What it is |
| --- | --- |
| `engine/` | Thompson sampling, Beta posteriors, seeded PRNG, deterministic simulator. Pure TypeScript, tested with Vitest. |
| `web/` | The project website. React, Vite, Three.js. |
| `loadtest/` | Load test that also audits that nothing was lost. |
| `api/` | NestJS service. Redis serves requests, a BullMQ worker writes to PostgreSQL. |

## Run it

```bash
npm install
docker compose up -d   # PostgreSQL on localhost:5433 and Redis on localhost:6380
npm test               # engine tests, then API tests against the real database
npm run dev:web        # website at http://localhost:5173
npm run dev:api        # API at http://localhost:3000
npm run build:web      # production build
npm run loadtest       # needs the API running; see below
```

Requires Node 20 or newer and Docker.

## How a request flows

```
POST /assign  ->  Redis (atomic Lua: pick variant, count it)  ->  queue  ->  worker  ->  PostgreSQL
POST /reward  ->  Redis (atomic Lua: count once)              ->  queue  ->  worker  ->  PostgreSQL
```

The request path only touches Redis, so it does not wait on the database. PostgreSQL stays the source of truth: the worker's writes are idempotent, so BullMQ can retry or replay any job without double counting, and a wiped Redis is rebuilt from the database (including every saved assignment, so visitors keep their variant).

A conversion can reach the queue before its assignment has been saved. The worker fails that job and BullMQ retries it with backoff, so no ordering guarantee is needed on the way in.

## Load test

With the API running (`npm run dev:api` in one terminal), run `npm run loadtest` in another. It sends 20,000 visitors in waves so the engine can learn, reports every conversion twice, then waits for the queue to empty and checks that Redis and PostgreSQL both match exactly what was sent. It exits with an error if any event was lost or double counted. Tune it with `VISITORS`, `CONNECTIONS`, `BURST` and `BASE_URL`.

`GET /experiments/:key/audit` is the endpoint behind that check: it returns the totals held in Redis and in PostgreSQL plus the queue backlog.

## API

| Method and path | What it does |
| --- | --- |
| `POST /experiments` | Create an experiment with 2 to 10 variants. |
| `GET /experiments/:key` | Impressions, conversions, rate and probability of being best per variant. |
| `POST /experiments/:key/assign` | Body `{ "userKey": "..." }`. Samples a variant from the posteriors; the same visitor always gets the same variant. |
| `POST /experiments/:key/reward` | Body `{ "userKey": "..." }`. Records a conversion, counted once per visitor. |
| `GET /experiments/:key/audit` | Redis totals, PostgreSQL totals and queue backlog, and whether they agree. |

Correctness is enforced in the database, not just the code: `UNIQUE (experiment_id, user_key)` for sticky assignment, a single guarded `UPDATE ... WHERE converted_at IS NULL` for exactly-once rewards, and `CHECK (conversions <= impressions)`. Tests fire 25 simultaneous first visits from one visitor and 60 from different visitors, pause the worker to prove requests keep being served, wipe Redis mid-run, then assert PostgreSQL and Redis agree exactly and nothing is double-counted or lost.

A visitor who has not converted yet counts as a non-conversion. In production you would add an attribution window.

## Status

See the lab log at the bottom of the website. Engine, service, fast path and load test are done; contextual mode and an SDK are next.
