import type { Database } from "@carbon/database";
// @ts-ignore -- type declarations only visible within this package, not cross-package consumers
import type { Unit } from "humanize-duration";
// @ts-ignore -- type declarations only visible within this package, not cross-package consumers
import humanizeDuration from "humanize-duration";

type Factor = Database["public"]["Enums"]["factor"];

const factorAbbreviations: Record<Factor, string> = {
  "Total Hours": "hr",
  "Total Minutes": "min",
  "Hours/Piece": "hr/pc",
  "Hours/100 Pieces": "hr/100 pcs",
  "Hours/1000 Pieces": "hr/1000 pcs",
  "Minutes/Piece": "min/pc",
  "Minutes/100 Pieces": "min/100 pcs",
  "Minutes/1000 Pieces": "min/1000 pcs",
  "Pieces/Hour": "pcs/hr",
  "Pieces/Minute": "pcs/min",
  "Seconds/Piece": "sec/pc"
};

export function formatFactor(value: number, unit: Factor): string {
  if (value === 0) return "";
  return `${value} ${factorAbbreviations[unit]}`;
}

function dateDifference(date1: Date, date2: Date) {
  return Math.abs(date1.getTime() - date2.getTime());
}

type DurationOptions = {
  style?: "long" | "short";
  maxDecimalPoints?: number;
  units?: Unit[];
};

export function formatDuration(
  start?: Date | null,
  end?: Date | null,
  options?: DurationOptions
): string {
  if (!start || !end) {
    return "–";
  }

  return formatDurationMilliseconds(dateDifference(start, end), options);
}

const aboveOneSecondUnits = ["d", "h", "m", "s"] as Unit[];
const belowOneSecondUnits = ["ms"] as Unit[];

// Single regex pass replaces the 14-step `.replace` chain in the "short"
// style branch — each prior `.replace` allocated a new intermediate
// string. Unit ordering: longer suffix first so plurals don't get
// truncated to the singular form.
const SHORT_UNIT_PATTERN =
  / (milliseconds?|seconds?|minutes?|hours?|days?|weeks?|months?|years?)/g;
const SHORT_UNIT_MAP: Record<string, string> = {
  millisecond: "ms",
  milliseconds: "ms",
  second: "s",
  seconds: "s",
  minute: "m",
  minutes: "m",
  hour: "h",
  hours: "h",
  day: "d",
  days: "d",
  week: "w",
  weeks: "w",
  month: "mo",
  months: "mo",
  year: "y",
  years: "y"
};

export function formatDurationHours(
  hours: number,
  options?: DurationOptions
): string {
  if (hours === 0) return "-";
  return formatDurationMilliseconds(hours * 1000 * 60 * 60, options);
}

export function formatDurationMinutes(
  minutes: number,
  options?: DurationOptions
): string {
  if (minutes === 0) return "";
  return formatDurationMilliseconds(minutes * 1000 * 60, options);
}

export function formatDurationMilliseconds(
  milliseconds: number,
  options?: DurationOptions
): string {
  let duration = humanizeDuration(milliseconds, {
    units: options?.units
      ? options.units
      : milliseconds < 1000
        ? belowOneSecondUnits
        : aboveOneSecondUnits,
    maxDecimalPoints: options?.maxDecimalPoints ?? 0,
    largest: 2
  });

  if (!options) {
    return duration;
  }

  if (options.style === "short") {
    duration = duration.replace(
      SHORT_UNIT_PATTERN,
      (match: string, unit: string) => SHORT_UNIT_MAP[unit] ?? match
    );
  }

  return duration;
}

export function formatDurationInDays(milliseconds: number): string {
  let duration = humanizeDuration(milliseconds, {
    maxDecimalPoints: 0,
    largest: 2,
    units: ["d"]
  });

  return duration;
}
