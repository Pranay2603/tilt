import { useMemo } from "react";
import { Simulation } from "@tilt/engine";
import { Section } from "./Section";
import { Reveal } from "./Reveal";
import { pct } from "../lib/format";

const RATES = [0.04, 0.05, 0.07];
const DAYS = 14;
const PER_DAY = 400;
/** A typical run: closest to the median of 300 seeds on both regret cut and traffic to the best variant. */
const SEED = 276;
const PROMOS = ["20% off", "Free garlic bread", "Free delivery"];
const COLORS = ["#b9b5a8", "#6f6b60", "#e5421a"];

function dailyShares(policy: "uniform" | "thompson") {
  const sim = new Simulation({ trueRates: RATES, policy, seed: SEED });
  const out: number[][] = [];
  let prev = [0, 0, 0];
  for (let d = 0; d < DAYS; d++) {
    for (let i = 0; i < PER_DAY; i++) sim.step();
    const now = [...sim.counts];
    out.push(now.map((c, k) => (c - prev[k]!) / PER_DAY));
    prev = now;
  }
  return out;
}

function Bars({ data, y0, label }: { data: number[][]; y0: number; label: string }) {
  const bw = 34;
  const gap = 12;
  const h = 110;
  const x0 = 150;
  return (
    <g transform={`translate(0 ${y0})`}>
      <text x="0" y={h / 2 + 4} className="svg-mono svg-label">
        {label}
      </text>
      {data.map((day, d) => {
        let acc = 0;
        return (
          <g key={d} transform={`translate(${x0 + d * (bw + gap)} 0)`}>
            {day.map((share, k) => {
              const hh = share * h;
              const y = h - acc - hh;
              acc += hh;
              return <rect key={k} x="0" y={y} width={bw} height={Math.max(0, hh)} fill={COLORS[k]} />;
            })}
            {(d === 0 || d === 6 || d === DAYS - 1) && (
              <text x={bw / 2} y={h + 16} textAnchor="middle" className="svg-mono svg-tick">
                D{d + 1}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

export function Observation() {
  const { fixed, tilt } = useMemo(() => ({ fixed: dailyShares("uniform"), tilt: dailyShares("thompson") }), []);
  const lastFixed = 1 - fixed[DAYS - 1]![2]!;
  const lastTilt = 1 - tilt[DAYS - 1]![2]!;

  return (
    <Section
      id="observation"
      no={1}
      label="Observation"
      title={<>Every visitor sent to the weaker promo is a sale you chose not to make.</>}
    >
      <div className="cols">
        <Reveal className="prose">
          <p>
            Take a delivery app testing three promos: <b>20% off</b>, <b>free garlic bread</b> and{" "}
            <b>free delivery</b>. A classic A/B test splits visitors three ways and waits two weeks for the verdict.
          </p>
          <p>
            Early on, the data already leans one way. A fixed split ignores that until the last day, so a third of
            visitors keep seeing each promo whether it is working or not. Every one of those visitors had a lower
            chance of ordering. That shortfall has a name, <i>regret</i>, and Tilt is built to keep it small.
          </p>
          <p className="note mono">
            On day 14, the fixed split still sends {pct(lastFixed)} of visitors to the two weaker promos. Tilt sends{" "}
            {pct(lastTilt)}.
          </p>
        </Reveal>

        <Reveal className="figure" delay={120}>
          <div className="fig-head mono">
            <span className="fig">Fig. 2</span>
            <span>Share of each day's visitors. 400 a day, true rates 4%, 5%, 7%, hidden from both. A typical run (seed {SEED}).</span>
          </div>
          <svg viewBox="0 0 800 300" role="img" aria-label="Daily traffic share by promo for a fixed split and for Tilt">
            <Bars data={fixed} y0={14} label="FIXED SPLIT" />
            <Bars data={tilt} y0={170} label="TILT" />
          </svg>
          <ul className="legend mono">
            {PROMOS.map((p, i) => (
              <li key={p}>
                <i style={{ background: COLORS[i] }} />
                {p}
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </Section>
  );
}
