import { createRng, type Rng } from "./rng";
import { choose, freshArm, update, type Arm, type PolicyName } from "./policy";

export interface Visitor {
  index: number;
  arm: number;
  converted: boolean;
}

/**
 * A step-able world with known true conversion rates.
 * The website drives this one visitor at a time; the tests run it in bulk.
 */
export class Simulation {
  readonly arms: Arm[];
  readonly counts: number[];
  readonly conversions: number[];
  readonly trueRates: readonly number[];
  readonly policy: PolicyName;
  private readonly rng: Rng;
  private readonly bestRate: number;
  n = 0;
  reward = 0;
  /** Expected conversions lost versus always showing the best variant. */
  regret = 0;

  constructor(opts: { trueRates: readonly number[]; policy: PolicyName; seed: number }) {
    this.trueRates = opts.trueRates;
    this.policy = opts.policy;
    this.rng = createRng(opts.seed);
    this.arms = opts.trueRates.map(freshArm);
    this.counts = opts.trueRates.map(() => 0);
    this.conversions = opts.trueRates.map(() => 0);
    this.bestRate = Math.max(...opts.trueRates);
  }

  step(): Visitor {
    const arm = choose(this.policy, this.arms, this.rng);
    const converted = this.rng() < this.trueRates[arm]!;
    update(this.arms[arm]!, converted);
    this.counts[arm]!++;
    if (converted) {
      this.conversions[arm]!++;
      this.reward++;
    }
    this.regret += this.bestRate - this.trueRates[arm]!;
    return { index: this.n++, arm, converted };
  }

  /** Share of traffic each variant has received so far. */
  share(): number[] {
    const total = Math.max(1, this.n);
    return this.counts.map((c) => c / total);
  }
}

export interface RunResult {
  policy: PolicyName;
  visitors: number;
  conversions: number;
  regret: number;
  /** Cumulative regret sampled every `every` visitors, for charting. */
  regretCurve: number[];
  share: number[];
}

export function run(opts: {
  trueRates: readonly number[];
  policy: PolicyName;
  visitors: number;
  seed: number;
  every?: number;
}): RunResult {
  const sim = new Simulation(opts);
  const every = opts.every ?? Math.max(1, Math.floor(opts.visitors / 100));
  const regretCurve: number[] = [];
  for (let i = 0; i < opts.visitors; i++) {
    sim.step();
    if ((i + 1) % every === 0) regretCurve.push(sim.regret);
  }
  return {
    policy: opts.policy,
    visitors: opts.visitors,
    conversions: sim.reward,
    regret: sim.regret,
    regretCurve,
    share: sim.share(),
  };
}
