// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/** A row's color: its card's dot and its bars. Literal classes for Tailwind. */
export type WeekHoursTone = { dot: string; bar: string };

const TONES: WeekHoursTone[] = [
  { dot: "bg-blue-500", bar: "border-blue-500/60 bg-blue-500/15" },
  { dot: "bg-violet-500", bar: "border-violet-500/60 bg-violet-500/15" },
  { dot: "bg-amber-500", bar: "border-amber-500/60 bg-amber-500/15" },
  { dot: "bg-rose-500", bar: "border-rose-500/60 bg-rose-500/15" },
  { dot: "bg-cyan-500", bar: "border-cyan-500/60 bg-cyan-500/15" },
  { dot: "bg-lime-500", bar: "border-lime-500/60 bg-lime-500/15" },
  { dot: "bg-orange-500", bar: "border-orange-500/60 bg-orange-500/15" },
  { dot: "bg-fuchsia-500", bar: "border-fuchsia-500/60 bg-fuchsia-500/15" }
];
/** Time off: one color, whatever its place in the list. */
const LEAVE_TONE: WeekHoursTone = {
  dot: "bg-emerald-500",
  bar: "border-emerald-500/60 bg-emerald-500/15"
};
/** Read-only time (a service order's): grey. */
const READ_ONLY_TONE: WeekHoursTone = {
  dot: "bg-muted-foreground",
  bar: "border-border bg-muted"
};

/**
 * Each row's tone, in list order: leave and read-only rows get their own,
 * the others take the palette in turn.
 */
export function weekHoursTones(
  rows: { key: string; isLeave?: boolean; isReadOnly?: boolean }[]
): Map<string, WeekHoursTone> {
  const tones = new Map<string, WeekHoursTone>();
  let index = 0;
  for (const row of rows) {
    if (row.isReadOnly) tones.set(row.key, READ_ONLY_TONE);
    else if (row.isLeave) tones.set(row.key, LEAVE_TONE);
    else {
      tones.set(row.key, TONES[index % TONES.length]!);
      index += 1;
    }
  }
  return tones;
}
