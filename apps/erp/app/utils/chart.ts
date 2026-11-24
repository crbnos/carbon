// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export function groupDataByDay<T extends object>(
  data: T[],
  args: {
    start: string;
    end: string;
    groupBy: keyof T;
  }
): Record<string, T[]> {
  const { start, end, groupBy } = args;

  const result: Record<string, T[]> = {};

  let d = new Date(start);
  let e = new Date(end);

  if (d > e) return {};

  while (d <= e) {
    const date = d.toISOString().split("T")[0];
    result[date] = [];
    d.setDate(d.getDate() + 1);
  }

  data.forEach((d) => {
    const date = new Date(d[groupBy]!.toString()).toISOString().split("T")[0];
    result[date]?.push(d);
  });

  return result;
}

export function groupDataByMonth<T extends object>(
  data: T[],
  args: {
    start: string;
    end: string;
    groupBy: keyof T;
  }
): Record<string, T[]> {
  const { start, end, groupBy } = args;

  const result: Record<string, T[]> = {};

  let d = new Date(start);
  let e = new Date(end);

  if (d > e) return {};

  while (d <= e) {
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}`;
    result[monthKey] = [];
    d.setMonth(d.getMonth() + 1);
  }

  data.forEach((item) => {
    const date = new Date(item[groupBy]!.toString());
    const monthKey = `${date.getFullYear()}-${String(
      date.getMonth() + 1
    ).padStart(2, "0")}`;
    if (result[monthKey]) {
      result[monthKey].push(item);
    }
  });

  return result;
}

// Round a value to a "nice" number (1/2/5 × 10^n) so axis steps land on
// human-friendly intervals instead of arbitrary fractions of the data range.
function niceNum(value: number, round: boolean) {
  const exponent = Math.floor(Math.log10(value));
  const fraction = value / 10 ** exponent;
  let niceFraction: number;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }
  return niceFraction * 10 ** exponent;
}

// Build evenly-spaced, round Y-axis ticks (and matching domain bounds) that
// cover [min,max] and always include 0. Steps are >=1 since quantities are whole.
export function niceAxis(min: number, max: number, tickCount = 6) {
  let lo = min;
  let hi = max;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) {
    lo = Math.min(0, lo || 0);
    hi = Math.max(1, hi || 1);
  }
  const step = Math.max(
    1,
    niceNum((hi - lo) / Math.max(1, tickCount - 1), true)
  );
  const niceMin = Math.floor(lo / step) * step;
  const niceMax = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + step / 2; v += step) {
    ticks.push(Math.round(v));
  }
  return { niceMin, niceMax, ticks };
}
