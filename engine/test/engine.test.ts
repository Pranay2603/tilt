import { describe, expect, it } from "vitest";
import { createRng, sampleBeta, sampleGamma, run, Simulation, probabilityBest, freshArm } from "../src";

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const variance = (xs: number[]) => {
  const m = mean(xs);
  return mean(xs.map((x) => (x - m) ** 2));
};

describe("rng", () => {
  it("is reproducible from a seed", () => {
    const a = createRng(7);
    const b = createRng(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it("stays in [0,1)", () => {
    const r = createRng(1);
    for (let i = 0; i < 10_000; i++) {
      const x = r();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe("samplers", () => {
  it("gamma matches mean and variance (shape 3 and 0.5)", () => {
    for (const k of [3, 0.5]) {
      const r = createRng(11);
      const xs = Array.from({ length: 40_000 }, () => sampleGamma(k, r));
      expect(mean(xs)).toBeCloseTo(k, 1);
      expect(variance(xs)).toBeGreaterThan(k * 0.9);
      expect(variance(xs)).toBeLessThan(k * 1.1);
    }
  });
  it("beta(2,5) matches analytic mean 2/7", () => {
    const r = createRng(3);
    const xs = Array.from({ length: 40_000 }, () => sampleBeta(2, 5, r));
    expect(mean(xs)).toBeCloseTo(2 / 7, 2);
  });
  it("rejects non-positive shape", () => {
    expect(() => sampleGamma(0, createRng(1))).toThrow(RangeError);
  });
});

describe("simulation", () => {
  const rates = [0.04, 0.05, 0.08];

  it("thompson concentrates traffic on the best variant", () => {
    const res = run({ trueRates: rates, policy: "thompson", visitors: 20_000, seed: 5 });
    expect(res.share[2]!).toBeGreaterThan(0.8);
  });

  it("uniform keeps traffic split evenly", () => {
    const res = run({ trueRates: rates, policy: "uniform", visitors: 20_000, seed: 5 });
    for (const s of res.share) expect(s).toBeGreaterThan(0.31);
  });

  it("thompson has lower regret than uniform across 30 seeds", () => {
    let wins = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const t = run({ trueRates: rates, policy: "thompson", visitors: 5_000, seed });
      const u = run({ trueRates: rates, policy: "uniform", visitors: 5_000, seed });
      if (t.regret < u.regret) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(29);
  });

  it("is deterministic for a given seed", () => {
    const a = run({ trueRates: rates, policy: "thompson", visitors: 1_000, seed: 9 });
    const b = run({ trueRates: rates, policy: "thompson", visitors: 1_000, seed: 9 });
    expect(a).toEqual(b);
  });

  it("counts add up", () => {
    const sim = new Simulation({ trueRates: rates, policy: "thompson", seed: 2 });
    for (let i = 0; i < 500; i++) sim.step();
    expect(sim.counts.reduce((a, b) => a + b, 0)).toBe(500);
    expect(sim.conversions.reduce((a, b) => a + b, 0)).toBe(sim.reward);
  });
});

describe("probabilityBest", () => {
  it("sums to 1 and favours the arm with more evidence of being better", () => {
    const arms = [freshArm(), freshArm(), freshArm()];
    arms[0]!.alpha = 5; arms[0]!.beta = 95;
    arms[1]!.alpha = 8; arms[1]!.beta = 92;
    arms[2]!.alpha = 40; arms[2]!.beta = 260;
    const p = probabilityBest(arms, createRng(1), 4000);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    expect(p[2]!).toBeGreaterThan(0.9);
  });
});
