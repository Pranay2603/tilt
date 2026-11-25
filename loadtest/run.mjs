// Load test for the Tilt API. Needs the API running (npm run dev:api) and nothing else.
//
//   npm run loadtest
//   BASE_URL=https://your-host VISITORS=50000 CONNECTIONS=128 npm run loadtest
//
// Phase 1 sends one assign request per unique visitor. Phase 2 sends a reward for every
// visitor who "converts" under hidden true rates, each one TWICE, to prove exactly-once.
// Then it waits for the queue to empty and checks that Redis and PostgreSQL agree exactly
// with what was sent. Exit code 1 means an event was lost or double counted.

import autocannon from "autocannon";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const VISITORS = Number(process.env.VISITORS ?? 20000);
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 64);
const TRUE_RATES = { control: 0.04, b: 0.05, c: 0.07 };

const key = `lt-${Date.now().toString(36)}`;
const json = { "content-type": "application/json" };

const call = async (method, path, body) => {
  const res = await fetch(BASE + path, { method, headers: json, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
};

const run = (opts) =>
  new Promise((resolve, reject) => {
    const started = performance.now();
    const inst = autocannon({ url: BASE, connections: CONNECTIONS, pipelining: 1, ...opts }, (err, res) => {
      if (err) return reject(err);
      res.wallSeconds = (performance.now() - started) / 1000; // autocannon rounds duration to whole seconds
      resolve(res);
    });
    autocannon.track(inst, { renderProgressBar: false, renderResultsTable: false, renderLatencyTable: false });
  });

const ms = (n) => `${n} ms`;
const rows = [];
let failed = false;
const check = (label, ok, detail) => {
  rows.push(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed = true;
};

console.log(`Target ${BASE}, ${VISITORS} visitors in waves, ${CONNECTIONS} connections, experiment ${key}\n`);

await call("POST", "/experiments", {
  key,
  name: "Load test",
  variants: [
    { key: "control", name: "Control" },
    { key: "b", name: "Variant B" },
    { key: "c", name: "Variant C" },
  ],
});

// ---- Throughput: one unbroken burst against its own experiment ------------------------
const BURST = Number(process.env.BURST ?? 20000);
const burstKey = `${key}-burst`;
await call("POST", "/experiments", {
  key: burstKey,
  name: "Load test burst",
  variants: [
    { key: "control", name: "Control" },
    { key: "b", name: "Variant B" },
    { key: "c", name: "Variant C" },
  ],
});
let burstNext = 0;
const burstAssign = await run({
  amount: BURST,
  requests: [
    {
      method: "POST",
      path: `/experiments/${burstKey}/assign`,
      headers: json,
      setupRequest: (req) => {
        req.body = JSON.stringify({ userKey: `b${burstNext++}` });
        return req;
      },
    },
  ],
});
let burstRewardNext = 0;
const burstRewards = Math.floor(BURST / 10);
const burstReward = await run({
  amount: burstRewards,
  requests: [
    {
      method: "POST",
      path: `/experiments/${burstKey}/reward`,
      headers: json,
      setupRequest: (req) => {
        req.body = JSON.stringify({ userKey: `b${burstRewardNext++}` });
        return req;
      },
    },
  ],
});

// ---- Traffic in waves: assign, then report that wave's conversions, then repeat ----------
// Waves are what lets the engine learn: each wave's conversions are in before the next begins.
const WAVES = Number(process.env.WAVES ?? 20);
const served = new Map(); // userKey -> variant key
const rng = (() => {
  let s = 20260101;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
})();
const counted = { yes: 0, no: 0 };
const stats = {
  assign: { sent: 0, ok: 0, secs: 0, p50: [], p99: [], max: 0 },
  reward: { sent: 0, ok: 0, secs: 0, p50: [], p99: [], max: 0 },
};
const fold = (name, res, sent) => {
  const t = stats[name];
  t.sent += sent;
  t.ok += res["2xx"];
  t.secs += res.wallSeconds;
  t.p50.push(res.latency.p50);
  t.p99.push(res.latency.p99);
  t.max = Math.max(t.max, res.latency.max);
};
const clean = (res) => res.non2xx === 0 && res.errors === 0 && res.timeouts === 0;
let allClean = true;
let converters = 0;
let next = 0;

const perWave = Math.ceil(VISITORS / WAVES);
for (let w = 0; w < WAVES; w++) {
  const n = Math.min(perWave, VISITORS - w * perWave);
  if (n <= 0) break;
  const wave = [];
  const assign = await run({
    amount: n,
    requests: [
      {
        method: "POST",
        path: `/experiments/${key}/assign`,
        headers: json,
        setupRequest: (req, context) => {
          context.user = `v${next++}`;
          req.body = JSON.stringify({ userKey: context.user });
          return req;
        },
        onResponse: (status, body, context) => {
          if (status === 200) {
            const v = JSON.parse(body).variant.key;
            served.set(context.user, v);
            wave.push([context.user, v]);
          }
        },
      },
    ],
  });
  fold("assign", assign, n);
  allClean &&= clean(assign);

  // Every conversion is reported twice, to prove it is only counted once.
  const winners = wave.filter(([, v]) => rng() < TRUE_RATES[v]).map(([u]) => u);
  converters += winners.length;
  const sends = winners.flatMap((u) => [u, u]);
  if (sends.length === 0) continue;
  let r = 0;
  const reward = await run({
    amount: sends.length,
    requests: [
      {
        method: "POST",
        path: `/experiments/${key}/reward`,
        headers: json,
        setupRequest: (req, context) => {
          context.user = sends[r++ % sends.length];
          req.body = JSON.stringify({ userKey: context.user });
          return req;
        },
        onResponse: (status, body) => {
          if (status === 200) JSON.parse(body).counted ? counted.yes++ : counted.no++;
        },
      },
    ],
  });
  fold("reward", reward, sends.length);
  allClean &&= clean(reward);
}

// ---- Wait for the worker, then audit ----------------------------------------------
const t0 = Date.now();
let audit;
for (;;) {
  audit = await call("GET", `/experiments/${key}/audit`);
  if (audit.consistent || Date.now() - t0 > 120_000) break;
  await new Promise((res) => setTimeout(res, 100));
}
const catchUp = Date.now() - t0;
const burstAudit = await call("GET", `/experiments/${burstKey}/audit`);
const state = await call("GET", `/experiments/${key}`);

// ---- Report ------------------------------------------------------------------------
const burstLine = (name, res, sent) =>
  `${name.padEnd(8)} ${String(Math.round(sent / res.wallSeconds)).padStart(7)} req/s   p50 ${ms(res.latency.p50).padStart(8)}   p99 ${ms(res.latency.p99).padStart(8)}   max ${ms(res.latency.max).padStart(8)}   ${sent} sent`;
console.log(`Throughput (one unbroken burst, ${CONNECTIONS} connections, worker saving to PostgreSQL at the same time)`);
console.log("  " + burstLine("assign", burstAssign, BURST));
console.log("  " + burstLine("reward", burstReward, burstRewards));
console.log(`\nQueue backlog fully saved to PostgreSQL ${catchUp} ms after the last request\n`);

console.log("Traffic the engine sent to each variant (true rates 4%, 5%, 7%)");
for (const v of state.variants) {
  const share = ((v.impressions / state.impressions) * 100).toFixed(1);
  console.log(`  ${v.key.padEnd(8)} ${String(v.impressions).padStart(7)} visitors (${share}%)   observed rate ${(v.rate * 100).toFixed(2)}%`);
}
const fixed = (VISITORS / 3) * (TRUE_RATES.control + TRUE_RATES.b + TRUE_RATES.c);
console.log(`  conversions: ${state.conversions} (a fixed even split would expect about ${Math.round(fixed)})\n`);

console.log("Correctness");
check("every assign request succeeded", allClean && stats.assign.ok === VISITORS, `${stats.assign.ok}/${VISITORS}`);
check("every reward request succeeded", allClean && stats.reward.ok === stats.reward.sent, `${stats.reward.ok}/${stats.reward.sent}`);
check("each visitor got exactly one variant", served.size === VISITORS, `${served.size} unique`);
check("duplicate rewards were ignored", counted.yes === converters && counted.no === converters, `${counted.yes} counted, ${counted.no} ignored`);
check("Redis impressions equal visitors sent", audit.redis.impressions === VISITORS, `${audit.redis.impressions}`);
check("PostgreSQL impressions equal visitors sent", audit.postgres.impressions === VISITORS, `${audit.postgres.impressions}`);
check("Redis conversions equal distinct converters", audit.redis.conversions === converters, `${audit.redis.conversions}`);
check("PostgreSQL conversions equal distinct converters", audit.postgres.conversions === converters, `${audit.postgres.conversions}`);
check("burst: every request succeeded", clean(burstAssign) && clean(burstReward) && burstAssign["2xx"] === BURST && burstReward["2xx"] === burstRewards, `${burstAssign["2xx"]} + ${burstReward["2xx"]}`);
check("burst: PostgreSQL matches what was sent", burstAudit.postgres.impressions === BURST && burstAudit.postgres.conversions === burstRewards, `${burstAudit.postgres.impressions} / ${burstAudit.postgres.conversions}`);
check("queue empty and no failed jobs", audit.queue.failed === 0 && audit.consistent, JSON.stringify(audit.queue));
console.log(rows.map((x) => "  " + x).join("\n"));
console.log(failed ? "\nFAILED: an event was lost or double counted." : "\nPASSED: nothing lost, nothing double counted.");
process.exit(failed ? 1 : 0);
