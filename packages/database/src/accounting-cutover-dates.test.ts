// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { isBeforeCutover } from "./accounting-cutover-dates.ts";

describe("isBeforeCutover", () => {
  it("is false for every date when the company has no cutover", () => {
    expect(isBeforeCutover("2020-01-01", null)).toBe(false);
  });

  it("is true only for a date before the cutover day", () => {
    expect(isBeforeCutover("2026-09-30", "2026-10-01")).toBe(true);
    expect(isBeforeCutover("2025-12-31", "2026-10-01")).toBe(true);
    expect(isBeforeCutover("2026-10-01", "2026-10-01")).toBe(false);
    expect(isBeforeCutover("2026-10-02", "2026-10-01")).toBe(false);
  });
});
