import { describe, expect, it } from "vitest";
import {
  formatDateTimeInZone,
  formatPreciseDuration,
  formatRelativeCalendarDays,
  formatTimeOfDay,
  getTimeZoneOffsetLabel
} from "./date";

describe("formatRelativeCalendarDays", () => {
  it("gives exact day distances, not vague week phrasing", () => {
    expect(
      formatRelativeCalendarDays("2026-08-14", "2026-08-06", "en-US")
    ).toBe("in 8 days");
    expect(
      formatRelativeCalendarDays("2026-08-03", "2026-08-06", "en-US")
    ).toBe("3 days ago");
  });

  it("uses natural words for the near cases", () => {
    expect(
      formatRelativeCalendarDays("2026-08-06", "2026-08-06", "en-US")
    ).toBe("today");
    expect(
      formatRelativeCalendarDays("2026-08-07", "2026-08-06", "en-US")
    ).toBe("tomorrow");
    expect(
      formatRelativeCalendarDays("2026-08-05", "2026-08-06", "en-US")
    ).toBe("yesterday");
  });

  it("switches to months and years for distant dates", () => {
    expect(
      formatRelativeCalendarDays("2026-11-10", "2026-08-06", "en-US")
    ).toBe("in 3 months");
    // 589 days back — never "589 days ago"
    expect(
      formatRelativeCalendarDays("2024-12-25", "2026-08-06", "en-US")
    ).toBe("2 years ago");
    expect(
      formatRelativeCalendarDays("2025-09-06", "2026-08-06", "en-US")
    ).toBe("11 months ago");
  });

  it("echoes garbage input", () => {
    expect(formatRelativeCalendarDays("nope", "2026-08-06", "en-US")).toBe(
      "nope"
    );
  });
});

describe("formatTimeOfDay", () => {
  it("formats a bare HH:MM:SS wall-clock time with no zone shift", () => {
    expect(formatTimeOfDay("08:00:00", "en-US")).toBe("8:00 AM");
    expect(formatTimeOfDay("17:00:00", "en-US")).toBe("5:00 PM");
    expect(formatTimeOfDay("00:00", "en-US")).toBe("12:00 AM");
  });

  it("returns empty for empty input and echoes garbage", () => {
    expect(formatTimeOfDay("")).toBe("");
    expect(formatTimeOfDay(null)).toBe("");
    expect(formatTimeOfDay("not-a-time", "en-US")).toBe("not-a-time");
  });
});

describe("formatDateTimeInZone", () => {
  it("renders the same instant differently per zone", () => {
    const iso = "2026-08-05T15:09:16Z";
    const utc = formatDateTimeInZone(iso, "UTC", "en-US");
    const kolkata = formatDateTimeInZone(iso, "Asia/Kolkata", "en-US");
    expect(utc).toContain("3:09:16");
    expect(kolkata).toContain("8:39:16");
    expect(utc).toContain("Aug 5, 2026");
    expect(kolkata).toContain("Aug 5, 2026");
  });

  it("crosses the date line when the zone demands it", () => {
    expect(
      formatDateTimeInZone("2026-08-05T20:00:00Z", "Pacific/Auckland", "en-US")
    ).toContain("Aug 6, 2026");
  });

  it("accepts option overrides", () => {
    expect(
      formatDateTimeInZone("2026-08-05T15:09:16Z", "UTC", "en-US", {
        dateStyle: undefined,
        timeStyle: "short"
      })
    ).toBe("3:09 PM");
  });

  it("returns empty string for empty input and the raw string on garbage", () => {
    expect(formatDateTimeInZone("", "UTC")).toBe("");
    expect(formatDateTimeInZone("not-a-date", "UTC")).toBe("not-a-date");
  });
});

describe("getTimeZoneOffsetLabel", () => {
  it("labels half-hour and full-hour offsets", () => {
    const iso = "2026-08-05T15:09:16Z";
    expect(getTimeZoneOffsetLabel(iso, "Asia/Kolkata")).toBe("GMT+5:30");
    expect(getTimeZoneOffsetLabel(iso, "UTC")).toMatch(/^GMT/);
  });

  it("is DST-correct at the instant, not today", () => {
    // Chicago is CDT (-5) in July, CST (-6) in January
    expect(
      getTimeZoneOffsetLabel("2026-07-01T12:00:00Z", "America/Chicago")
    ).toBe("GMT-5");
    expect(
      getTimeZoneOffsetLabel("2026-01-01T12:00:00Z", "America/Chicago")
    ).toBe("GMT-6");
  });

  it("falls back to the zone name on garbage input", () => {
    expect(getTimeZoneOffsetLabel("garbage", "Asia/Kolkata")).toBe(
      "Asia/Kolkata"
    );
  });
});

describe("formatPreciseDuration", () => {
  const now = Date.parse("2026-08-05T20:39:16Z");

  it("drops seconds once the span exceeds a minute", () => {
    const { text, direction } = formatPreciseDuration(
      "2026-08-05T17:21:39Z",
      "en-US",
      now
    );
    expect(direction).toBe("past");
    expect(text).toBe("3 hours, 17 minutes");
  });

  it("skips zero-valued middle units", () => {
    const { text } = formatPreciseDuration(
      "2026-08-04T20:34:16Z", // 1 day, 0 hours, 5 minutes ago
      "en-US",
      now
    );
    expect(text).toBe("1 day, 5 minutes");
  });

  it("caps at three units for long spans", () => {
    const { text } = formatPreciseDuration(
      "2024-06-01T10:00:00Z",
      "en-US",
      now
    );
    expect(text.split(", ").length).toBeLessThanOrEqual(3);
    expect(text).toContain("year");
  });

  it("reports future direction", () => {
    const { text, direction } = formatPreciseDuration(
      "2026-08-05T20:39:26Z",
      "en-US",
      now
    );
    expect(direction).toBe("future");
    expect(text).toBe("10 seconds");
  });

  it("renders zero seconds at the exact instant", () => {
    const { text } = formatPreciseDuration(
      "2026-08-05T20:39:16Z",
      "en-US",
      now
    );
    expect(text).toBe("0 seconds");
  });
});
