// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const lerp = (min: number, max: number, t: number) => {
  return min + (max - min) * clamp(t, 0, 1);
};

export const inverseLerp = (min: number, max: number, value: number) => {
  return (value - min) / (max - min);
};
