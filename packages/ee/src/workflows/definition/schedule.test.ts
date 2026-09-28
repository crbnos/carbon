import { describe, expect, it } from "vitest";
import {
  nextOccurrenceAfter,
  nextRunAfter,
  scheduleOffsetSeconds
} from "./schedule";
import type { Schedule } from "./types";

const daily = (tz = "America/New_York"): Schedule => ({
  freq: "Daily",
  hour: 9,
  minute: 0,
  tz
});

describe("nextOccurrenceAfter", () => {
  it("Daily — returns today's occurrence when before the time", () => {
    // 2026-08-01T12:00:00Z = 08:00 New York (EDT = UTC-4)
    const result = nextOccurrenceAfter(
      daily(),
      new Date("2026-08-01T12:00:00Z")
    );
    expect(result.toISOString()).toBe("2026-08-01T13:00:00.000Z");
  });

  it("Daily — strictly after: at exactly the time returns next day", () => {
    const result = nextOccurrenceAfter(
      daily(),
      new Date("2026-08-01T13:00:00Z")
    );
    expect(result.toISOString()).toBe("2026-08-02T13:00:00.000Z");
  });

  it("Weekly — skips to Monday when evaluated on Friday after time", () => {
    // 2026-08-07T12:00:00Z = Friday 08:00 New York, after 07:00 trigger time
    const schedule: Schedule = {
      freq: "Weekly",
      hour: 7,
      minute: 0,
      weekdays: [1, 2, 3, 4, 5],
      tz: "America/New_York"
    };
    const result = nextOccurrenceAfter(
      schedule,
      new Date("2026-08-07T12:00:00Z")
    );
    // Monday 2026-08-10 at 07:00 New York (EDT = UTC-4) = 11:00Z
    expect(result.toISOString()).toBe("2026-08-10T11:00:00.000Z");
  });

  it("Monthly — skips February when day=31", () => {
    const schedule: Schedule = {
      freq: "Monthly",
      hour: 9,
      minute: 0,
      day: 31,
      tz: "America/New_York"
    };
    // After Jan 31 occurrence
    const result = nextOccurrenceAfter(
      schedule,
      new Date("2026-01-31T14:00:00Z")
    );
    // Should skip Feb, land in March
    expect(new Date(result).getUTCMonth()).toBe(2); // March = 2
  });

  it("Monthly — day='last' returns last day of month", () => {
    const schedule: Schedule = {
      freq: "Monthly",
      hour: 0,
      minute: 0,
      day: "last",
      tz: "UTC"
    };
    // Evaluate inside January 2026 — next last day is Jan 31
    const result = nextOccurrenceAfter(
      schedule,
      new Date("2026-01-01T00:00:00Z")
    );
    expect(result.toISOString().startsWith("2026-01-31")).toBe(true);
  });

  it("Monthly — day='last' handles February 28 in 2026", () => {
    const schedule: Schedule = {
      freq: "Monthly",
      hour: 0,
      minute: 0,
      day: "last",
      tz: "UTC"
    };
    // After Jan 31 — next last day is Feb 28, 2026
    const result = nextOccurrenceAfter(
      schedule,
      new Date("2026-01-31T01:00:00Z")
    );
    expect(result.toISOString().startsWith("2026-02-28")).toBe(true);
  });

  it("Monthly — day='last' handles February 29 in 2028", () => {
    const schedule: Schedule = {
      freq: "Monthly",
      hour: 0,
      minute: 0,
      day: "last",
      tz: "UTC"
    };
    // After Jan 31 2028 — next last day is Feb 29, 2028
    const result = nextOccurrenceAfter(
      schedule,
      new Date("2028-01-31T01:00:00Z")
    );
    expect(result.toISOString().startsWith("2028-02-29")).toBe(true);
  });

  it("DST spring forward — does not throw and is strictly after input", () => {
    // 2026-03-08 is spring forward day in America/New_York
    // 02:30 doesn't exist but "compatible" means it becomes 03:30
    const schedule: Schedule = {
      freq: "Daily",
      hour: 2,
      minute: 30,
      tz: "America/New_York"
    };
    const before = new Date("2026-03-07T07:00:00Z"); // 2:00 AM NY day before
    const result = nextOccurrenceAfter(schedule, before);
    expect(result.getTime()).toBeGreaterThan(before.getTime());
    // Round-trip through Intl.DateTimeFormat should not throw
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric"
    });
    expect(() => fmt.format(result)).not.toThrow();
  });

  it("DST fall back — keeps wall time (09:00 NY is 13:00Z before fall, 14:00Z after)", () => {
    // Before fall back day: EDT (UTC-4), so 09:00 NY on Oct 31 = 13:00Z.
    // DST ends on Nov 1 at 2:00 AM, so evaluating from 08:00 AM Oct 31 yields 09:00 AM Oct 31 EDT.
    const beforeFallBack = nextOccurrenceAfter(
      daily(),
      new Date("2026-10-31T12:00:00Z")
    );
    expect(beforeFallBack.toISOString()).toBe("2026-10-31T13:00:00.000Z");

    // After fall back on 2026-11-01: EST (UTC-5), so 09:00 NY = 14:00Z
    const afterFallBack = nextOccurrenceAfter(
      daily(),
      new Date("2026-11-01T14:01:00Z")
    );
    expect(afterFallBack.toISOString()).toBe("2026-11-02T14:00:00.000Z");
  });
});

describe("scheduleOffsetSeconds", () => {
  it("returns a value in [0, 300)", () => {
    const offset = scheduleOffsetSeconds("wf_abc");
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(offset).toBeLessThan(300);
  });

  it("is stable across calls", () => {
    expect(scheduleOffsetSeconds("wf_abc")).toBe(
      scheduleOffsetSeconds("wf_abc")
    );
  });

  it("spreads well across 100 workflow ids", () => {
    const offsets = Array.from({ length: 100 }, (_, i) =>
      scheduleOffsetSeconds(`wf_${i}`)
    );
    expect(new Set(offsets).size).toBeGreaterThanOrEqual(95);
  });
});

describe("nextRunAfter", () => {
  it("no compounding — two consecutive calls are exactly 24h apart", () => {
    const d = new Date("2026-08-01T12:00:00Z");
    const first = nextRunAfter(daily(), "wf_abc", d);
    const second = nextRunAfter(daily(), "wf_abc", first);
    expect(second.getTime() - first.getTime()).toBe(86_400_000);
  });
});
