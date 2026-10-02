// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { formatDate, formatDateTimeInZone } from "@carbon/utils/date";
import { parseAbsolute, toCalendarDate } from "@internationalized/date";

/**
 * Every decision and every piece of formatting the time card does, with no
 * React Native anywhere in the file.
 *
 * Two reasons it is separate from the components. A test that imports a `.tsx`
 * pulls in `react-native`, whose Flow-typed source vitest cannot parse — so
 * logic inside a component is logic that cannot be tested. And this screen is
 * almost entirely dates: an operator's paid hours are the output, and every
 * way of getting them wrong is silent.
 *
 * The rules this file exists to hold (`.claude/rules/date-handling.md`):
 *
 *   - **No JavaScript `Date` for parsing, formatting or calendar arithmetic.**
 *     A stored `YYYY-MM-DD` run through `new Date(...)` renders the day BEFORE
 *     for every operator west of UTC, which on a time card moves Monday's
 *     hours onto Sunday. `formatDate` parses with `parseDate`, so it cannot.
 *   - **Durations are summed per entry, never as 24-hour days or 168-hour
 *     weeks.** A week with a daylight-saving transition is 167 or 169 hours,
 *     and a shift that spans the transition is an hour shorter or longer than
 *     its wall-clock times suggest. Subtracting two absolute instants is right
 *     in every zone and on every transition day; nothing here multiplies by 24.
 *   - **The week's bounds come from the server** (`weekStart` / `weekEnd` are
 *     Monday and Sunday on the COMPANY calendar, which is the payroll one).
 *     This file never computes a week, so the app and the books cannot disagree
 *     about which days are in it.
 */

/** The shape every duration helper here needs — a full `TimeCardEntry` fits. */
export type ClockedEntry = {
  clockIn: string;
  /** Null or absent while the entry is open. That IS the "clocked in" signal. */
  clockOut?: string | null;
};

/**
 * Epoch milliseconds of an ISO instant, or null when it cannot be read.
 *
 * `parseAbsolute` rather than `new Date(...)`, and the number it returns is
 * only ever used to subtract one absolute instant from another — the narrow
 * exception the date rule allows. No calendar decision on this screen is made
 * from an epoch number; those all go through `@internationalized/date` below.
 *
 * The zone argument is irrelevant to the instant (PostgREST sends an offset,
 * and `toDate()` is absolute), so it is fixed at UTC rather than taken from
 * the caller, where a wrong value would look like it mattered.
 */
export function instantMs(iso?: string | null): number | null {
  if (!iso) return null;
  try {
    return parseAbsolute(iso, "UTC").toDate().getTime();
  } catch {
    return null;
  }
}

/**
 * How long one entry has been worked, in milliseconds. An open entry runs to
 * `nowMs`; a closed one to its own `clockOut`.
 *
 * Floored at zero. A tablet whose clock is behind the server's produces a
 * negative elapsed, and "-0h -14m" on a time card reads as a payroll error
 * rather than as the clock skew it is.
 */
export function entryDurationMs(entry: ClockedEntry, nowMs: number): number {
  const start = instantMs(entry.clockIn);
  if (start === null) return 0;
  const end = instantMs(entry.clockOut) ?? nowMs;
  return end > start ? end - start : 0;
}

/** The week's worked time: the sum of its entries, open one included. */
export function weekTotalMs(
  entries: readonly ClockedEntry[],
  nowMs: number
): number {
  let total = 0;
  for (const entry of entries) total += entryDurationMs(entry, nowMs);
  return total;
}

/**
 * A duration split into whole hours and whole minutes.
 *
 * `Math.floor` here splits an integer count of milliseconds into clock
 * components, which is the case `no-raw-rounding` baselines (calendar buckets
 * and relative-time math) rather than rounding a value — nothing below is a
 * quantity, a price or a stored number. It truncates rather than rounding, so
 * a minute that has not finished is never shown as worked.
 */
export function durationParts(milliseconds: number): {
  hours: number;
  minutes: number;
} {
  const totalMinutes = Math.floor(Math.max(milliseconds, 0) / 60_000);
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

export type ClockAction = "clock_in" | "clock_out";

/**
 * The ONE action the current state calls for — never both buttons at once.
 *
 * An entry that carries a `clockOut` is settled, whatever field it arrived in:
 * treating one as open would offer Clock out to somebody a supervisor already
 * clocked out, and the operator would be told their own tap failed.
 */
export function clockAction(
  openEntry: ClockedEntry | null | undefined
): ClockAction {
  return openEntry && !openEntry.clockOut ? "clock_out" : "clock_in";
}

/**
 * Week navigation. `0` is this week and `-1` is last week, so there is nothing
 * above zero: a week that has not begun has no hours in it, and letting an
 * operator page into it only offers them empty screens to scroll through.
 */
export function canViewNextWeek(weekOffset: number): boolean {
  return weekOffset < 0;
}

export function previousWeek(weekOffset: number): number {
  return weekOffset - 1;
}

export function nextWeek(weekOffset: number): number {
  return weekOffset < 0 ? weekOffset + 1 : weekOffset;
}

/**
 * Which calendar day an instant fell on, as `YYYY-MM-DD`, in a named zone.
 *
 * This is the grouping key for the day rows, and it is the one place the day
 * is decided. A 11pm clock-in belongs to the day the operator was standing in,
 * not to whatever day UTC had reached.
 *
 * `timeZone` is the device's own zone, which is the right answer for display
 * (`date-handling.md`: on a client the local zone IS the user's) and on a
 * tablet clamped to a machine is the plant's. The WEEK is still the server's
 * company-calendar window — the two cannot drift, because this only ever
 * labels entries the server already decided were in the week.
 */
export function entryCalendarDay(iso: string, timeZone: string): string | null {
  try {
    return toCalendarDate(parseAbsolute(iso, timeZone)).toString();
  } catch {
    return null;
  }
}

export type DayGroup<T> = {
  /** `YYYY-MM-DD`, or `""` when the instant could not be read. */
  day: string;
  totalMs: number;
  entries: T[];
};

/**
 * The week's entries bucketed by the day they started, in the order the server
 * sent them (newest first), each with its own total.
 *
 * An entry whose `clockIn` cannot be parsed keeps its row under an empty day
 * key rather than being dropped. Hours that silently disappear from a time
 * card are the worst failure this screen has; a row the operator can see and
 * query is recoverable.
 */
export function dayGroups<T extends ClockedEntry>(
  entries: readonly T[],
  timeZone: string,
  nowMs: number
): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  const byDay = new Map<string, DayGroup<T>>();

  for (const entry of entries) {
    const day = entryCalendarDay(entry.clockIn, timeZone) ?? "";
    let group = byDay.get(day);
    if (!group) {
      group = { day, totalMs: 0, entries: [] };
      byDay.set(day, group);
      groups.push(group);
    }
    group.entries.push(entry);
    group.totalMs += entryDurationMs(entry, nowMs);
  }

  return groups;
}

const DAY_LABEL: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric"
};

const RANGE_LABEL: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric"
};

/**
 * A `YYYY-MM-DD` day as "Mon, Oct 5".
 *
 * Through `formatDate`, which parses with `parseDate` and so has no instant and
 * no zone to shift. `new Date("2026-10-05").toLocaleDateString(...)` — which is
 * what web MES's own `formatDay` still does — reads midnight UTC and prints
 * "Sun, Oct 4" for anyone in the Americas.
 */
export function formatDayLabel(day: string, locale: string): string {
  return formatDate(day, DAY_LABEL, locale);
}

/** The week's header: "Sep 28 – Oct 4", from the server's own two days. */
export function formatWeekRange(
  weekStart: string,
  weekEnd: string,
  locale: string
): string {
  return `${formatDate(weekStart, RANGE_LABEL, locale)} – ${formatDate(
    weekEnd,
    RANGE_LABEL,
    locale
  )}`;
}

/**
 * The time of day an entry was clocked in or out, as "8:03 AM".
 *
 * `formatDateTimeInZone` resolves the offset AT the instant, so a shift that
 * spans a daylight-saving transition shows both of its real wall-clock times
 * rather than one of them shifted by an hour.
 */
export function formatClockTime(
  iso: string,
  timeZone: string,
  locale: string
): string {
  return formatDateTimeInZone(iso, timeZone, locale, {
    dateStyle: undefined,
    timeStyle: "short"
  });
}

/**
 * Did this entry start before today? `todayDay` is `YYYY-MM-DD` on the same
 * calendar the caller is grouping by.
 *
 * It is the "forgot to clock out" test — web MES puts a whole prompt behind it
 * (`TimeCardWarning.tsx`, "Forgot to Clock Out?"). An entry opened yesterday
 * and never closed is the single most common wrong number on a time card, and
 * it is invisible if the screen only ever shows a time of day.
 *
 * An unreadable instant is NOT treated as old: a false "check this entry" on
 * every row would teach the operator to ignore the one that matters.
 */
export function startedBeforeToday(
  iso: string,
  timeZone: string,
  todayDay: string
): boolean {
  const day = entryCalendarDay(iso, timeZone);
  return day !== null && day < todayDay;
}

/**
 * A moment an operator reads: "8:03 AM" today, "Sat, Oct 3, 8:03 AM" if it was
 * not today.
 *
 * The day is added rather than always shown, because "Clocked in since 8:03 AM"
 * is the honest reading of an entry opened this morning and an outright lie
 * about one opened the day before yesterday. Comparing `YYYY-MM-DD` strings is
 * safe — all three date columns are DATE and lexicographic order on that
 * format is chronological.
 */
export function formatClockMoment(
  iso: string,
  timeZone: string,
  locale: string,
  todayDay: string
): string {
  const day = entryCalendarDay(iso, timeZone);
  const time = formatClockTime(iso, timeZone, locale);
  if (!day || day === todayDay) return time;
  return `${formatDayLabel(day, locale)}, ${time}`;
}
