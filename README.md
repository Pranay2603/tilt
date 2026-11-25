# Tilt

An A/B testing engine that moves traffic toward the winning variant while the test is still running.

Fixed 50/50 tests keep sending visitors to variants they already suspect are worse. Tilt uses Thompson sampling to shift traffic toward the winner as evidence builds. The same TypeScript engine runs on the server and in the browser, so every figure on the website is the real engine, not a recording.

## Layout

| Folder | What it is |
| --- | --- |
| `engine/` | Thompson sampling, Beta posteriors, seeded PRNG, deterministic simulator. Pure TypeScript, tested with Vitest. |
| `web/` | The project website. React, Vite, Three.js. |
| `api/` | NestJS and PostgreSQL service (in progress). |

## Run it

```bash
npm install
npm test            # engine tests
npm run dev:web     # website at http://localhost:5173
npm run build:web   # production build
```

Requires Node 20 or newer.

## Status

See the lab log at the bottom of the website. Engine is done; service, fast path, load test and contextual mode are planned.
