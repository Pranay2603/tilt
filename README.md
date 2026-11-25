# Tilt

An A/B testing engine that moves traffic toward the winning variant while the test is still running.

Fixed 50/50 tests keep sending visitors to variants they already suspect are worse. Tilt uses Thompson sampling to shift traffic toward the winner as evidence builds. The same TypeScript engine runs on the server and in the browser, so every figure on the website is the real engine, not a recording.

## Layout

| Folder | What it is |
| --- | --- |
| `engine/` | Thompson sampling, Beta posteriors, seeded PRNG, deterministic simulator. Pure TypeScript, tested with Vitest. |
| `web/` | The project website. React, Vite, Three.js. |
| `api/` | NestJS and PostgreSQL service. Assignment, rewards and live posteriors over HTTP. |

## Run it

```bash
npm install
docker compose up -d   # PostgreSQL on localhost:5433 (databases: tilt, tilt_test)
npm test               # engine tests, then API tests against the real database
npm run dev:web        # website at http://localhost:5173
npm run dev:api        # API at http://localhost:3000
npm run build:web      # production build
```

Requires Node 20 or newer and Docker.

## API

| Method and path | What it does |
| --- | --- |
| `POST /experiments` | Create an experiment with 2 to 10 variants. |
| `GET /experiments/:key` | Impressions, conversions, rate and probability of being best per variant. |
| `POST /experiments/:key/assign` | Body `{ "userKey": "..." }`. Samples a variant from the posteriors; the same visitor always gets the same variant. |
| `POST /experiments/:key/reward` | Body `{ "userKey": "..." }`. Records a conversion, counted once per visitor. |

Correctness is enforced in the database, not just the code: `UNIQUE (experiment_id, user_key)` for sticky assignment, a single guarded `UPDATE ... WHERE converted_at IS NULL` for exactly-once rewards, and `CHECK (conversions <= impressions)`. Tests fire 25 simultaneous first visits from one visitor and 60 from different visitors, then assert nothing is double-counted or lost.

A visitor who has not converted yet counts as a non-conversion. In production you would add an attribution window.

## Status

See the lab log at the bottom of the website. Engine and service are done; fast path, load test and contextual mode are next.
