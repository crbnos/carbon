import { describe, expect, it } from "vitest";
import { getForecastNonWorkingIntervals } from "./forecast.server";

const iso = (s: string) => Date.parse(s);

// A shift row with no weekday runs on, overridden per test.
const shift = (over: Partial<Record<string, unknown>> = {}) => ({
  startTime: "06:00:00",
  endTime: "14:00:00",
  monday: false,
  tuesday: false,
  wednesday: false,
  thursday: false,
  friday: false,
  saturday: false,
  sunday: false,
  ...over
});

describe("getForecastNonWorkingIntervals", () => {
  it("shades outside the stock 08:00–16:00 day when there are no shifts", () => {
    // A full Monday in America/New_York (EDT, UTC-4): 00:00–24:00 local =
    // 04:00Z–04:00Z(+1). Stock working window is 08:00–16:00 local = 12:00Z–20:00Z.
    const result = getForecastNonWorkingIntervals({
      timeZone: "America/New_York",
      shifts: [],
      windowStartMs: iso("2026-08-17T04:00:00Z"),
      windowEndMs: iso("2026-08-18T04:00:00Z")
    });

    expect(result).toEqual([
      { start: iso("2026-08-17T04:00:00Z"), end: iso("2026-08-17T12:00:00Z") },
      { start: iso("2026-08-17T20:00:00Z"), end: iso("2026-08-18T04:00:00Z") }
    ]);
  });

  it("uses the location's own shift when one runs on that weekday", () => {
    // A 06:00–14:00 Monday shift in EDT = 10:00Z–18:00Z working.
    const result = getForecastNonWorkingIntervals({
      timeZone: "America/New_York",
      shifts: [shift({ monday: true })],
      windowStartMs: iso("2026-08-17T04:00:00Z"),
      windowEndMs: iso("2026-08-18T04:00:00Z")
    });

    expect(result).toEqual([
      { start: iso("2026-08-17T04:00:00Z"), end: iso("2026-08-17T10:00:00Z") },
      { start: iso("2026-08-17T18:00:00Z"), end: iso("2026-08-18T04:00:00Z") }
    ]);
  });

  it("unions two shifts so a second shift extends the working window", () => {
    // The reported scenario: a "Second Shift" 04:00–12:00 added alongside the
    // "First Shift" 08:00–16:00 (both Mon–Fri). They union to 04:00–16:00 local
    // = 08:00Z–20:00Z working, so ONLY before 04:00 and after 16:00 is masked.
    const result = getForecastNonWorkingIntervals({
      timeZone: "America/New_York",
      shifts: [
        shift({ startTime: "04:00:00", endTime: "12:00:00", monday: true }),
        shift({ startTime: "08:00:00", endTime: "16:00:00", monday: true })
      ],
      windowStartMs: iso("2026-08-17T04:00:00Z"),
      windowEndMs: iso("2026-08-18T04:00:00Z")
    });

    expect(result).toEqual([
      { start: iso("2026-08-17T04:00:00Z"), end: iso("2026-08-17T08:00:00Z") },
      { start: iso("2026-08-17T20:00:00Z"), end: iso("2026-08-18T04:00:00Z") }
    ]);
  });

  it("shades the whole window when it falls on a non-working day", () => {
    // Saturday 2026-08-22: the stock week is Mon–Fri only, so the entire day is
    // non-working — one interval spanning the window.
    const start = iso("2026-08-22T04:00:00Z");
    const end = iso("2026-08-23T04:00:00Z");
    const result = getForecastNonWorkingIntervals({
      timeZone: "America/New_York",
      shifts: [],
      windowStartMs: start,
      windowEndMs: end
    });

    expect(result).toEqual([{ start, end }]);
  });
});
