import type { Rng } from "./rng";

/** Standard normal via Box-Muller. */
export function sampleNormal(rng: Rng): number {
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Gamma(shape, 1) via Marsaglia-Tsang. Handles shape < 1 with the boost trick. */
export function sampleGamma(shape: number, rng: Rng): number {
  if (shape <= 0) throw new RangeError("shape must be > 0");
  if (shape < 1) {
    const u = rng() || Number.MIN_VALUE;
    return sampleGamma(shape + 1, rng) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = sampleNormal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Beta(alpha, beta) from two gammas. */
export function sampleBeta(alpha: number, beta: number, rng: Rng): number {
  const x = sampleGamma(alpha, rng);
  const y = sampleGamma(beta, rng);
  return x / (x + y);
}
