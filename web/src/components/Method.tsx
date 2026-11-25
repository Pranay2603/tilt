import { useEffect, useMemo, useRef, useState } from "react";
import { Simulation, betaPdf, createRng, probabilityBest } from "@tilt/engine";
import { Section } from "./Section";
import { Reveal } from "./Reveal";
import { pct } from "../lib/format";
import { useInView } from "../lib/useInView";

const RATES = [0.04, 0.05, 0.07];
const COLORS = ["#8a8679", "#3a362f", "#e5421a"];
const NAMES = ["A", "B", "C"];
const MAX_N = 3000;

const W = 720;
const H = 300;
const M = { l: 36, r: 20, t: 16, b: 38 };
const X_MAX = 0.14;
const POINTS = 140;

export function Method() {
  const [n, setN] = useState(0);
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);
  const [scrubRef, seen] = useInView<HTMLDivElement>("0px 0px -25% 0px");

  // Play once, the first time the figure scrolls into view.
  useEffect(() => {
    if (!seen) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setN(MAX_N);
    else setPlaying(true);
  }, [seen]);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = (t - last) / 1000;
      last = t;
      let done = false;
      setN((cur) => {
        const next = Math.min(MAX_N, cur + dt * 360);
        if (next >= MAX_N) done = true;
        return next;
      });
      if (done) setPlaying(false);
      else raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing]);

  const visitors = Math.round(n);
  const world = useMemo(() => {
    const sim = new Simulation({ trueRates: RATES, policy: "thompson", seed: 5 });
    for (let i = 0; i < visitors; i++) sim.step();
    const best = probabilityBest(sim.arms, createRng(99), 1500);
    const curves = sim.arms.map((a) =>
      Array.from({ length: POINTS }, (_, k) => {
        const x = ((k + 0.5) / POINTS) * X_MAX;
        return { x, y: betaPdf(x, a.alpha, a.beta) };
      }),
    );
    return { share: sim.share(), best, curves, arms: sim.arms.map((a) => ({ ...a })) };
  }, [visitors]);

  const yMax = Math.max(1.2, ...world.curves.flat().map((p) => p.y)) * 1.08;
  const pw = W - M.l - M.r;
  const ph = H - M.t - M.b;
  const px = (x: number) => M.l + (x / X_MAX) * pw;
  const py = (y: number) => M.t + ph * (1 - Math.min(y, yMax) / yMax);
  const line = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i ? "L" : "M"} ${px(p.x).toFixed(1)} ${py(p.y).toFixed(1)}`).join(" ");
  const area = (pts: { x: number; y: number }[]) =>
    `${line(pts)} L ${px(pts.at(-1)!.x)} ${py(0)} L ${px(pts[0]!.x)} ${py(0)} Z`;
  const xTicks = [0, 0.02, 0.04, 0.06, 0.08, 0.1, 0.12, 0.14];

  return (
    <Section
      id="method"
      no={3}
      label="Method"
      title={<>Tilt keeps a belief about each variant, and lets chance decide who gets the next visitor.</>}
    >
      <div className="cols">
        <Reveal className="prose">
          <ol className="steps">
            <li>
              <b>Believe.</b> Every variant carries a Beta distribution: its best guess at the true conversion rate
              and how unsure that guess is. It starts flat, so nothing is assumed.
            </li>
            <li>
              <b>Draw.</b> For each new visitor, Tilt draws one random number from every variant's distribution and
              shows the variant with the highest draw. A confident leader wins most draws. An uncertain variant still
              wins some, which is how Tilt avoids writing off a late bloomer too early.
            </li>
            <li>
              <b>Learn.</b> The visitor converts or leaves. That variant's distribution is updated, and the next
              draw is already a little better informed.
            </li>
          </ol>
          <p className="note mono">
            This method is Thompson sampling. The posterior update is two integer increments, so it is cheap enough to
            run under a row lock in PostgreSQL.
          </p>
        </Reveal>

        <Reveal className="figure" delay={100}>
          <div className="fig-head mono">
            <span className="fig">Fig. 4</span>
            <span>What Tilt believes after {visitors.toLocaleString("en-US")} visitors.</span>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Posterior belief for each variant narrowing as visitors arrive">
            <line x1={M.l} x2={W - M.r} y1={py(0)} y2={py(0)} className="svg-axisline" />
            {xTicks.map((t) => (
              <g key={t}>
                <line x1={px(t)} x2={px(t)} y1={py(0)} y2={py(0) + 5} className="svg-axisline" />
                <text x={px(t)} y={H - 18} textAnchor="middle" className="svg-mono svg-tick">
                  {Math.round(t * 100)}%
                </text>
              </g>
            ))}
            <text x={M.l} y={H - 2} className="svg-mono svg-axis">
              conversion rate →
            </text>
            {world.curves.map((c, i) => (
              <g key={i}>
                <path d={area(c)} fill={COLORS[i]} opacity={0.1} />
                <path d={line(c)} fill="none" stroke={COLORS[i]} strokeWidth={i === 2 ? 2.4 : 1.8} />
              </g>
            ))}
            {RATES.map((r, i) => (
              <g key={i}>
                <line x1={px(r)} x2={px(r)} y1={py(0)} y2={M.t + 6} stroke={COLORS[i]} strokeDasharray="2 4" opacity={0.6} />
                <text x={px(r)} y={M.t} textAnchor="middle" className="svg-mono svg-tick" fill={COLORS[i]}>
                  {NAMES[i]} true
                </text>
              </g>
            ))}
          </svg>

          <div className="scrub" ref={scrubRef}>
            <button type="button" className="btn small" onClick={() => {
              if (n >= MAX_N) setN(0);
              setPlaying((p) => !p);
            }}>
              {playing ? "Pause" : n >= MAX_N ? "Replay" : "Play"}
            </button>
            <input
              type="range"
              min={0}
              max={MAX_N}
              step={25}
              value={visitors}
              aria-label="Number of visitors seen"
              onChange={(e) => {
                setPlaying(false);
                setN(Number(e.target.value));
              }}
            />
          </div>

          <dl className="readout three">
            {NAMES.map((name, i) => (
              <div key={name}>
                <dt className="mono">
                  <i style={{ background: COLORS[i] }} /> Variant {name}
                </dt>
                <dd className="num">{pct(world.best[i] ?? 0)}</dd>
                <dd className="mono sub">chance it is best</dd>
                <dd className="mono sub">{pct(world.share[i] ?? 0)} of traffic so far</dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </div>
    </Section>
  );
}
