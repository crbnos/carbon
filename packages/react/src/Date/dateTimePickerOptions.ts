// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * What `DateTimePicker` passes to `useDatePickerState` and `useDatePicker`.
 * `granularity` is pinned, `hourCycle` is the caller's choice.
 *
 * react-stately DERIVES granularity from the value, so an EMPTY picker falls back
 * to "day" and its `hasTime` is false — picking a date then commits a bare
 * CalendarDate, silently discarding a time already entered. Pinning "minute" is a
 * bug fix and applies to every caller.
 *
 * The clock is NOT a bug fix: a timecard or a maintenance start time is an ordinary
 * local-habit field where an en-US user expects AM/PM. Only callers that need an
 * unambiguous wall clock ask for `hourCycle={24}`.
 */
export function dateTimePickerOptions(hourCycle?: 12 | 24) {
  return {
    granularity: "minute",
    ...(hourCycle ? { hourCycle } : {})
  } as const;
}
