import { describe, expect, it } from "vitest";
import { betaMean, betaPdf, betaSd, lgamma } from "../src/stats";

describe("lgamma", () => {
  it("matches known values", () => {
    expect(lgamma(1)).toBeCloseTo(0, 8);
    expect(lgamma(5)).toBeCloseTo(Math.log(24), 8);
    expect(lgamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 8);
  });
});

describe("betaPdf", () => {
  it("Beta(1,1) is uniform", () => {
    expect(betaPdf(0.3, 1, 1)).toBeCloseTo(1, 8);
    expect(betaPdf(0.9, 1, 1)).toBeCloseTo(1, 8);
  });
  it("integrates to ~1", () => {
    let sum = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) sum += betaPdf((i + 0.5) / n, 8, 30) / n;
    expect(sum).toBeCloseTo(1, 3);
  });
  it("is zero outside (0,1)", () => {
    expect(betaPdf(0, 2, 2)).toBe(0);
    expect(betaPdf(1, 2, 2)).toBe(0);
  });
  it("mean and sd formulas", () => {
    expect(betaMean(2, 6)).toBeCloseTo(0.25, 10);
    expect(betaSd(2, 6)).toBeCloseTo(Math.sqrt((2 * 6) / (64 * 9)), 10);
  });
});
