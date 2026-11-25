import { sampleBeta } from "./dist";
import type { Rng } from "./rng";

/** Beta-Bernoulli posterior for one variant. Prior is Beta(1,1) = uniform. */
export interface Arm {
  alpha: number; // 1 + successes
  beta: number; //  1 + failures
}

export const freshArm = (): Arm => ({ alpha: 1, beta: 1 });

export const pulls = (a: Arm) => a.alpha + a.beta - 2;
export const meanOf = (a: Arm) => a.alpha / (a.alpha + a.beta);

export type PolicyName = "uniform" | "thompson";

/** Classic fixed split: every variant gets equal traffic forever. */
export function chooseUniform(arms: readonly Arm[], rng: Rng): number {
  return Math.min(arms.length - 1, Math.floor(rng() * arms.length));
}

/** Thompson sampling: draw once from each posterior, play the largest draw. */
export function chooseThompson(arms: readonly Arm[], rng: Rng): number {
  let best = 0;
  let bestDraw = -1;
  for (let i = 0; i < arms.length; i++) {
    const arm = arms[i]!;
    const draw = sampleBeta(arm.alpha, arm.beta, rng);
    if (draw > bestDraw) {
      bestDraw = draw;
      best = i;
    }
  }
  return best;
}

export function choose(policy: PolicyName, arms: readonly Arm[], rng: Rng): number {
  return policy === "thompson" ? chooseThompson(arms, rng) : chooseUniform(arms, rng);
}

export function update(arm: Arm, converted: boolean): void {
  if (converted) arm.alpha += 1;
  else arm.beta += 1;
}

/**
 * Monte-Carlo estimate of P(arm i has the highest true rate).
 * This is the number a dashboard shows as "probability to be best".
 */
export function probabilityBest(arms: readonly Arm[], rng: Rng, draws = 2000): number[] {
  const wins = new Array<number>(arms.length).fill(0);
  for (let d = 0; d < draws; d++) {
    let best = 0;
    let bestDraw = -1;
    for (let i = 0; i < arms.length; i++) {
      const x = sampleBeta(arms[i]!.alpha, arms[i]!.beta, rng);
      if (x > bestDraw) {
        bestDraw = x;
        best = i;
      }
    }
    wins[best]!++;
  }
  return wins.map((w) => w / draws);
}
