export const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const twoDecimals = (n: number) => {
  var log10 = n ? Math.floor(Math.log10(n)) : 0,
    div = log10 < 0 ? Math.pow(10, 1 - log10) : 100;

  return Math.round(n * div) / div;
};

export const lerp = (min: number, max: number, t: number) => {
  return min + (max - min) * clamp(t, 0, 1);
};

export const inverseLerp = (min: number, max: number, value: number) => {
  return (value - min) / (max - min);
};

// Node-side re-export of the edge-runtime precision module (same pattern as
// packages/database/src/sampling.ts). The source lives under supabase/functions/
// because the edge runtime only mounts that tree; it is dependency-free pure TS.
export * from "../../database/supabase/functions/shared/precision.ts";
