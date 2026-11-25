/**
 * Shared geometry for the hero plate. The WebGL scene and the DOM labels both
 * read from here, so lane labels always sit exactly on their lanes.
 * All values are fractions of the plate canvas (y measured from the top).
 */
export const STRIPS = [
  { top: 0, bottom: 0.5 },
  { top: 0.5, bottom: 1 },
] as const;

export const LANE_F = [0.2, 0.5, 0.8] as const;
export const SRC_X = 0.055;
export const LANE_START_X = 0.3;
export const LANE_END_X = 0.86;

export const laneYFrac = (strip: number, lane: number) => {
  const s = STRIPS[strip]!;
  return s.top + (s.bottom - s.top) * LANE_F[lane]!;
};

export const srcYFrac = (strip: number) => {
  const s = STRIPS[strip]!;
  return (s.top + s.bottom) / 2;
};

export const LANE_NAMES = ["A", "B", "C"] as const;
