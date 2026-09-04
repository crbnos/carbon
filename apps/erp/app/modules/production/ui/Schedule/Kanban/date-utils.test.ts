import { describe, expect, it, vi } from "vitest";

vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn(),
  glossaryEntries: () => []
}));

import {
  getDueDateForColumn,
  schedulePriorityValidator
} from "../../../production.models";
import {
  getDateOnly,
  getEmptyDueDateColumnId,
  getInlineDueDateUpdateFields,
  getOptimisticColumnId,
  getPendingDueDate,
  isDateColumnId,
  isDateColumnSentinel
} from "./date-utils";

describe("Dates board date helpers", () => {
  it("extracts the exact persisted date", () => {
    expect(getDateOnly("2026-08-09T15:30:00.000Z")).toBe("2026-08-09");
    expect(getDateOnly(null)).toBeNull();
  });

  it("recognizes only valid ISO dates and canonical sentinels", () => {
    expect(isDateColumnId("2026-02-28")).toBe(true);
    expect(isDateColumnId("2026-02-29")).toBe(false);
    expect(isDateColumnId("2026-2-9")).toBe(false);
    expect(isDateColumnSentinel("unscheduled")).toBe(true);
    expect(isDateColumnSentinel("unknown")).toBe(false);
  });

  it("centralizes sentinel persistence as null and preserves exact dates", () => {
    expect(getDueDateForColumn("2026-08-09")).toBe("2026-08-09");
    expect(getDueDateForColumn("unscheduled")).toBeNull();
    expect(getDueDateForColumn("next-week")).toBeNull();
    expect(getDueDateForColumn("next-month")).toBeNull();
    expect(getDueDateForColumn("not-a-column")).toBeUndefined();
  });

  it.each([
    ["2026-08-09", "2026-08-09"],
    ["unscheduled", null],
    ["next-week", null],
    ["next-month", null]
  ])("maps pending persistence column %s to %s", (columnId, dueDate) => {
    expect(getPendingDueDate(columnId)).toBe(dueDate);
  });

  it("does not invent a pending date for missing or invalid persistence input", () => {
    expect(getPendingDueDate(undefined)).toBeUndefined();
    expect(getPendingDueDate("2026-02-29")).toBeUndefined();
  });

  it("maps an exact date into a visible month bucket", () => {
    expect(
      getOptimisticColumnId("2026-08-09", [
        "unscheduled",
        "2026-08-01",
        "2026-08-08",
        "next-month"
      ])
    ).toBe("2026-08-08");
  });

  it("keeps sentinel fallbacks canonical", () => {
    expect(
      getEmptyDueDateColumnId(["2026-08-01", "next-week"], "2026-08-01")
    ).toBe("next-week");
    expect(
      getEmptyDueDateColumnId(["2026-08-01", "next-month"], "2026-08-01")
    ).toBe("next-month");
    expect(getEmptyDueDateColumnId(["2026-08-01"], "2026-08-01")).toBe(
      "2026-08-01"
    );
  });

  it("builds location-scoped inline exact-date and clear submissions", () => {
    const item = {
      id: "job-1",
      columnId: "2026-08-08",
      priority: 4
    };
    const columnIds = ["2026-08-01", "2026-08-08", "next-month"];

    expect(
      getInlineDueDateUpdateFields(item, "location-1", "2026-08-09", columnIds)
    ).toEqual({
      id: "job-1",
      locationId: "location-1",
      columnId: "2026-08-09",
      optimisticColumnId: "2026-08-08",
      priority: 4
    });
    expect(
      getInlineDueDateUpdateFields(item, "location-1", null, columnIds)
    ).toEqual({
      id: "job-1",
      locationId: "location-1",
      columnId: "next-month",
      optimisticColumnId: "next-month",
      priority: 4
    });
  });
});

describe("shared schedule priority validation", () => {
  it.each([
    undefined,
    "",
    " ",
    "\t",
    "\n",
    " \t\n"
  ])("rejects blank priority %j", (value) => {
    expect(schedulePriorityValidator.safeParse(value).success).toBe(false);
  });

  it.each([
    [" 4.25 ", 4.25],
    ["-3.5", -3.5]
  ])("accepts finite numeric priority %s", (value, expected) => {
    expect(schedulePriorityValidator.safeParse(value)).toMatchObject({
      success: true,
      data: expected
    });
  });

  it.each([
    "NaN",
    "Infinity",
    "-Infinity"
  ])("rejects non-finite priority %s", (value) => {
    expect(schedulePriorityValidator.safeParse(value).success).toBe(false);
  });
});
