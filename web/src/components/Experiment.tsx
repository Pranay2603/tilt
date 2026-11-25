import { useMemo, useState } from "react";
import { run } from "@tilt/engine";
import { Section } from "./Section";
import { Reveal } from "./Reveal";
import { fmt, int, pct } from "../lib/format";

const NAMES = ["A", "B", "C"];

const W = 720;
const H = 320;
const M = { l: 58, r: 96, t: 18, b: 44 };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  const n = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
  return n * p;
}

function RegretChart({
  fixed,
  tilt,
  visitors,
  seed,
}: {
  fixed: number[];
  tilt: number[];
  visitors: number;
  seed: number;
}) {
  const top = niceMax(Math.max(fixed.at(-1) ?? 0, tilt.at(-1) ?? 0) * 1.05);
  const pw = W - M.l - M.r;
  const ph = H - M.t - M.b;
  const px = (i: number, len: number) => M.l + ((i + 1) / len) * pw;
  const py = (v: number) => M.t + ph * (1 - v / top);
  const path = (c: number[]) =>
    `M ${M.l} ${py(0)} ` + c.map((v, i) => `L ${px(i, c.length).toFixed(1)} ${py(v).toFixed(1)}`).join(" ");
  const endF = py(fixed.at(-1) ?? 0);
  let endT = py(tilt.at(-1) ?? 0);
  if (Math.abs(endT - endF) < 16) endT = endF + (endT >= endF ? 16 : -16);
  const yTicks = [0, top / 2, top];
  const xTicks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cumulative regret for a fixed split versus Tilt">
      {yTicks.map((t) => (
        <g key={t}>
          <line x1={M.l} x2={W - M.r} y1={py(t)} y2={py(t)} className="svg-grid" />
          <text x={M.l - 10} y={py(t) + 4} textAnchor="end" className="svg-mono svg-tick">
            {fmt(t, t < 10 ? 1 : 0)}
          </text>
        </g>
      ))}
      {xTicks.map((t) => (
        <text key={t} x={M.l + t * pw} y={H - 18} textAnchor={t === 0 ? "start" : t === 1 ? "end" : "middle"} className="svg-mono svg-tick">
          {int(visitors * t)}
        </text>
      ))}
      <text x={M.l} y={H - 2} className="svg-mono svg-axis">
        visitors →
      </text>
      <text x={M.l} y={10} className="svg-mono svg-axis">
        expected conversions lost
      </text>
      <path key={`f${seed}`} d={path(fixed)} pathLength={1} className="line line-fixed draw" />
      <path key={`t${seed}`} d={path(tilt)} pathLength={1} className="line line-tilt draw" />
      <text x={W - M.r + 8} y={endF + 4} className="svg-mono svg-end">
        Fixed {fmt(fixed.at(-1) ?? 0)}
      </text>
      <text x={W - M.r + 8} y={endT + 4} className="svg-mono svg-end hot">
        Tilt {fmt(tilt.at(-1) ?? 0)}
      </text>
    </svg>
  );
}

export function Experiment() {
  const [rates, setRates] = useState([3, 4.5, 7.5]);
  const [visitors, setVisitors] = useState(8000);
  const [seed, setSeed] = useState(11);

  const res = useMemo(() => {
    const tr = rates.map((r) => r / 100);
    const every = Math.max(1, Math.floor(visitors / 120));
    return {
      u: run({ trueRates: tr, policy: "uniform", visitors, seed, every }),
      t: run({ trueRates: tr, policy: "thompson", visitors, seed, every }),
    };
  }, [rates, visitors, seed]);

  const best = rates.indexOf(Math.max(...rates));
  const flat = new Set(rates).size === 1;
  const recovered = res.u.regret - res.t.regret;

  return (
    <Section
      id="experiment"
      no={2}
      label="Experiment 01"
      title={<>Set the true conversion rates yourself. Watch what each policy costs.</>}
    >
      <div className="lab">
        <Reveal className="controls">
          <p className="prose small">
            Pick how well each variant really converts. Neither policy is told. Both see the same random visitors and
            have to find out.
          </p>

          {rates.map((r, i) => (
            <label key={i} className="slider">
              <span className="mono">
                Variant {NAMES[i]} <b>{fmt(r)}%</b>
                {i === best && !flat ? <em> best</em> : null}
              </span>
              <input
                type="range"
                min={1}
                max={12}
                step={0.5}
                value={r}
                onChange={(e) => setRates((cur) => cur.map((x, k) => (k === i ? Number(e.target.value) : x)))}
              />
            </label>
          ))}

          <label className="slider">
            <span className="mono">
              Visitors <b>{int(visitors)}</b>
            </span>
            <input
              type="range"
              min={1000}
              max={20000}
              step={500}
              value={visitors}
              onChange={(e) => setVisitors(Number(e.target.value))}
            />
          </label>

          <button type="button" className="btn" onClick={() => setSeed((s) => s + 1)}>
            Draw new visitors <span className="mono">seed {seed}</span>
          </button>
        </Reveal>

        <Reveal className="figure" delay={100}>
          <div className="fig-head mono">
            <span className="fig">Fig. 3</span>
            <span>Cumulative regret. Lower is better.</span>
          </div>
          <RegretChart fixed={res.u.regretCurve} tilt={res.t.regretCurve} visitors={visitors} seed={seed} />

          {flat ? (
            <p className="note mono">All three variants are identical, so there is nothing to learn. Move a slider.</p>
          ) : (
            <dl className="readout">
              <div>
                <dt className="mono">Recovered by Tilt</dt>
                <dd className="num hot">+{fmt(recovered)}</dd>
                <dd className="mono sub">expected conversions</dd>
              </div>
              <div>
                <dt className="mono">Traffic to the best variant</dt>
                <dd className="num">
                  {pct(res.u.share[best] ?? 0)} <small>→</small> <span className="hot">{pct(res.t.share[best] ?? 0)}</span>
                </dd>
                <dd className="mono sub">fixed split → Tilt</dd>
              </div>
              <div>
                <dt className="mono">Conversions this run</dt>
                <dd className="num">
                  {int(res.u.conversions)} <small>→</small> <span className="hot">{int(res.t.conversions)}</span>
                </dd>
                <dd className="mono sub">realised, includes luck</dd>
              </div>
            </dl>
          )}
        </Reveal>
      </div>
    </Section>
  );
}
