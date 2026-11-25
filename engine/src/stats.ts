/** Lanczos approximation of ln(Gamma(x)) for x > 0. */
export function lgamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = c[0]!;
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i]! / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Beta(alpha, beta) probability density at x in (0, 1). */
export function betaPdf(x: number, alpha: number, beta: number): number {
  if (x <= 0 || x >= 1) return 0;
  const logB = lgamma(alpha) + lgamma(beta) - lgamma(alpha + beta);
  return Math.exp((alpha - 1) * Math.log(x) + (beta - 1) * Math.log1p(-x) - logB);
}

export const betaMean = (alpha: number, beta: number) => alpha / (alpha + beta);

export const betaSd = (alpha: number, beta: number) =>
  Math.sqrt((alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1)));
