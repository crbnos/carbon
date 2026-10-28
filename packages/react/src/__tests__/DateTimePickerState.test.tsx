// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Pins the two `useDatePickerState` settings `DateTimePicker` passes, because
 * both fix real bugs that are invisible in a type check and easy to "clean up".
 *
 * react-stately DERIVES granularity from the value, so an EMPTY picker defaults
 * to "day" and its `hasTime` is false. In that state picking a date commits a
 * bare CalendarDate, which is how "set the time, then pick the date, and the
 * time is gone" happened.
 *
 * The vitest env is `node` (no jsdom), so the hook is exercised by rendering a
 * probe component with `renderToStaticMarkup` and driving its setters after.
 */
import type { DateValue } from "@internationalized/date";
import { CalendarDate, Time } from "@internationalized/date";
import { useDatePickerState } from "@react-stately/datepicker";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { dateTimePickerOptions } from "../Date/dateTimePickerOptions";
import { TimeCombobox } from "../Date/TimeCombobox";

// The Lingui macro is compiled by the app build, not by vitest.
vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children
}));

/** The hook with the options DateTimePicker passes, or without them. */
function stateFor(
  pinned: boolean,
  onChange: (value: DateValue | null) => void = () => {}
) {
  let captured: ReturnType<typeof useDatePickerState> | undefined;
  const Probe = () => {
    captured = useDatePickerState({
      value: null,
      onChange,
      ...(pinned ? dateTimePickerOptions() : {}),
      shouldCloseOnSelect: false
    });
    return null;
  };
  renderToStaticMarkup(<Probe />);
  if (!captured) throw new Error("probe did not render");
  return captured;
}

describe("DateTimePicker state settings", () => {
  it("without a pinned granularity, an empty picker is date-only", () => {
    const state = stateFor(false);
    // The upstream default that caused the bug — asserted so the reason the pin
    // exists stays visible if someone ever removes it.
    expect(state.granularity).toBe("day");
    expect(state.hasTime).toBe(false);
  });

  it("pinning granularity keeps an EMPTY picker a date-and-time picker", () => {
    const state = stateFor(true);
    expect(state.granularity).toBe("minute");
    expect(state.hasTime).toBe(true);
  });

  // The clock is the CALLER's choice: only fields that need an unambiguous wall
  // clock ask for 24-hour. Timecards and maintenance keep their locale's.
  it("leaves the clock to the locale unless a caller asks for 24-hour", () => {
    expect(dateTimePickerOptions()).toEqual({ granularity: "minute" });
    expect(dateTimePickerOptions(24)).toEqual({
      granularity: "minute",
      hourCycle: 24
    });
  });

  it("does not commit a bare date once granularity is pinned", () => {
    let fromDateOnly: DateValue | null = null;
    stateFor(false, (value) => {
      fromDateOnly = value;
    }).setDateValue(new CalendarDate(2026, 9, 10));
    // A CalendarDate has no `hour`: this is the commit that dropped the time.
    expect(fromDateOnly).not.toBeNull();
    expect("hour" in (fromDateOnly as unknown as object)).toBe(false);

    let fromPinned: DateValue | null = null;
    stateFor(true, (value) => {
      fromPinned = value;
    }).setDateValue(new CalendarDate(2026, 9, 10));
    // Deferred rather than committed, precisely so the date can be paired with
    // the time on close instead of overwriting it. (`dateValue` itself holds the
    // pending date in React state, which a server render never flushes, so the
    // absence of a commit is what is assertable here.)
    expect(fromPinned).toBeNull();
  });
});

describe("TimeCombobox", () => {
  // The draft is only seeded on focus, so until someone edits, what the field
  // shows must be derived from the value itself.
  it("shows the given time before any edit", () => {
    const html = renderToStaticMarkup(
      <TimeCombobox value={new Time(15, 30)} onChange={vi.fn()} hour24 />
    );
    expect(html).toContain('value="15:30"');
  });
});
