// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * A planned or accumulated duration, as an operator reads one: "8h 30m".
 *
 * Web MES writes these two ways — "8 hours, 30 minutes" on a board card and
 * "15h, 15m" inside an operation — both through `humanize-duration`, which is
 * not a dependency of this app. This is the compact form for both places: it
 * needs no plural rules, so it needs no translation table, and it is half the
 * width of the long one on a card that is already narrow.
 *
 * It is NOT a clock. The app used `hh:mm:ss` for these, and "15:15:36 per
 * Each" beside an operation reads as a running timer or a time of day. A
 * clock face is kept for the one thing that is a clock: a timer that is
 * actually ticking (`formatElapsed`).
 *
 * The two largest units only, the smaller one dropped when it is zero —
 * "2d 4h", "8h", "28m", "45s". Nothing is rounded up: 59m 59s is "59m", not
 * "1h", because a plan that says an hour when the routing says under one is a
 * plan that is wrong.
 */

const UNITS = [
  { suffix: "d", ms: 86_400_000 },
  { suffix: "h", ms: 3_600_000 },
  { suffix: "m", ms: 60_000 },
  { suffix: "s", ms: 1_000 }
] as const;

export function formatDuration(milliseconds: number | null | undefined) {
  if (milliseconds == null || !Number.isFinite(milliseconds)) return null;
  if (milliseconds < 1_000) return null;

  let rest = milliseconds;
  const parts: string[] = [];
  for (const unit of UNITS) {
    // Whole units only; the remainder carries to the next one down.
    const count = (rest - (rest % unit.ms)) / unit.ms;
    rest -= count * unit.ms;
    if (count > 0) parts.push(`${count}${unit.suffix}`);
    else if (parts.length > 0) parts.push("");
    if (parts.length === 2) break;
  }
  return parts.filter(Boolean).join(" ") || null;
}
