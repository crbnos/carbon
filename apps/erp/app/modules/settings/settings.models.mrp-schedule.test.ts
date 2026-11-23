// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// Isolation mock — see settings.models.sso.test.ts.
vi.mock("@carbon/content/glossary", () => ({
  getDefinitionText: vi.fn(),
  getEntry: vi.fn(),
  getTermText: vi.fn(),
  glossaryEntries: [],
  hasEntry: vi.fn(() => false),
  listEntries: vi.fn(() => []),
  lookupEntry: vi.fn(),
  termSlug: vi.fn(),
  terms: {}
}));

const { mrpScheduleValidator } = await import("./settings.models");

// The form used to carry only the hour, so a time set through the API (14:30)
// was saved back as 14:00 by a Save with no change.
describe("mrpScheduleValidator", () => {
  it("keeps a time that is not on the hour", () => {
    const result = mrpScheduleValidator.safeParse({
      mrpSchedule: "Daily",
      mrpRunTime: "14:30:00"
    });
    expect(result.success && result.data.mrpRunTime).toBe("14:30:00");
  });

  it("accepts a time without seconds", () => {
    expect(
      mrpScheduleValidator.safeParse({
        mrpSchedule: "Daily",
        mrpRunTime: "06:15"
      }).success
    ).toBe(true);
  });

  it("refuses a time that does not exist", () => {
    for (const mrpRunTime of ["24:00", "14:60", "7:00", "14"]) {
      expect(
        mrpScheduleValidator.safeParse({ mrpSchedule: "Daily", mrpRunTime })
          .success
      ).toBe(false);
    }
  });

  it("requires a time only for a daily run", () => {
    expect(
      mrpScheduleValidator.safeParse({ mrpSchedule: "Daily", mrpRunTime: "" })
        .success
    ).toBe(false);
    expect(
      mrpScheduleValidator.safeParse({
        mrpSchedule: "Every 3 Hours",
        mrpRunTime: ""
      }).success
    ).toBe(true);
  });
});
