import { useEffect, useState } from "react";
import { run } from "@tilt/engine";
import { Section } from "./Section";
import { Reveal } from "./Reveal";
import { useInView } from "../lib/useInView";
import { fmt, int, mean, pct, quantile } from "../lib/format";

const RATES = [0.04, 0.05, 0.07];
const VISITORS = 6000;
const SEEDS = 100;

interface Summary {
  regretMedian: [number, number];
  regretP10P90: [[number, number], [number, number]];
  conversions: [number, number];
  shareBest: [number, number];
  tiltWins: number;
}

export function Results() {
  const [ref, seen] = useInView<HTMLDivElement>("0px 0px 10% 0px");
  const [done, setDone] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    if (!seen) return;
    let cancelled = false;
    const rU: number[] = [];
    const rT: number[] = [];
    const cU: number[] = [];
    const cT: number[] = [];
    const sU: number[] = [];
    const sT: number[] = [];
    let wins = 0;
    let seed = 1;

    const chunk = () => {
      if (cancelled) return;
      const stop = Math.min(SEEDS, seed + 4);
      for (; seed <= stop; seed++) {
        const u = run({ trueRates: RATES, policy: "uniform", visitors: VISITORS, seed });
        const t = run({ trueRates: RATES, policy: "thompson", visitors: VISITORS, seed });
        rU.push(u.regret);
        rT.push(t.regret);
        cU.push(u.conversions);
        cT.push(t.conversions);
        sU.push(u.share[2]!);
        sT.push(t.share[2]!);
        if (t.regret < u.regret) wins++;
      }
      setDone(seed - 1);
      if (seed > SEEDS) {
        const a = [...rU].sort((x, y) => x - y);
        const b = [...rT].sort((x, y) => x - y);
        setSummary({
          regretMedian: [quantile(a, 0.5), quantile(b, 0.5)],
          regretP10P90: [
            [quantile(a, 0.1), quantile(a, 0.9)],
            [quantile(b, 0.1), quantile(b, 0.9)],
          ],
          conversions: [mean(cU), mean(cT)],
          shareBest: [mean(sU), mean(sT)],
          tiltWins: wins,
        });
      } else {
        setTimeout(chunk, 0);
      }
    };
    setTimeout(chunk, 60);
    return () => {
      cancelled = true;
    };
  }, [seen]);

  const cut = summary ? 1 - summary.regretMedian[1] / summary.regretMedian[0] : 0;

  return (
    <Section
      id="results"
      no={4}
      label="Results"
      title={<>One hundred seeded runs, computed live as you scrolled here.</>}
    >
      <div ref={ref} className="results">
        <Reveal className="headline-stat">
          <p className="num huge hot">{summary ? `−${pct(cut)}` : `${done}/${SEEDS}`}</p>
          <p className="prose small">
            {summary
              ? "median regret, Tilt versus a fixed split. Same visitors, same variants, 6,000 visitors per run."
              : "running simulations in your browser…"}
          </p>
        </Reveal>

        <Reveal className="table-wrap" delay={100}>
          <table className="ledger">
            <thead>
              <tr>
                <th className="mono" />
                <th className="mono">Fixed split</th>
                <th className="mono hot">Tilt</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>Median regret</th>
                <td>{summary ? fmt(summary.regretMedian[0]) : "…"}</td>
                <td className="hot">{summary ? fmt(summary.regretMedian[1]) : "…"}</td>
              </tr>
              <tr>
                <th>Regret, 10th to 90th percentile</th>
                <td>{summary ? `${fmt(summary.regretP10P90[0][0])} to ${fmt(summary.regretP10P90[0][1])}` : "…"}</td>
                <td className="hot">
                  {summary ? `${fmt(summary.regretP10P90[1][0])} to ${fmt(summary.regretP10P90[1][1])}` : "…"}
                </td>
              </tr>
              <tr>
                <th>Traffic to the best variant</th>
                <td>{summary ? pct(summary.shareBest[0]) : "…"}</td>
                <td className="hot">{summary ? pct(summary.shareBest[1]) : "…"}</td>
              </tr>
              <tr>
                <th>Mean conversions per run</th>
                <td>{summary ? int(summary.conversions[0]) : "…"}</td>
                <td className="hot">{summary ? int(summary.conversions[1]) : "…"}</td>
              </tr>
              <tr>
                <th>Runs where Tilt lost less</th>
                <td colSpan={2} className="span">
                  {summary ? `${summary.tiltWins} of ${SEEDS}` : "…"}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="note mono">
            True rates 4%, 5%, 7%. Seeds 1 to {SEEDS}. Regret is expected conversions lost versus always showing
            variant C. The engine is deterministic, so you and I get the same numbers.
          </p>
        </Reveal>
      </div>
    </Section>
  );
}
