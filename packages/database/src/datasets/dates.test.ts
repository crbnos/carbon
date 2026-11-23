// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { parseDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import { resolveLocalTimestamp, workdayBefore } from "./dates.ts";

describe("workdayBefore", () => {
  // 2026-10-12 is a Monday.
  const monday = parseDate("2026-10-12");

  it("skips the weekend", () => {
    expect(workdayBefore(monday, 1)).toBe("2026-10-09");
    expect([1, 2, 3, 4, 5].map((back) => workdayBefore(monday, back))).toEqual([
      "2026-10-09",
      "2026-10-08",
      "2026-10-07",
      "2026-10-06",
      "2026-10-05"
    ]);
  });

  it("counts back from a Saturday", () => {
    expect(workdayBefore(parseDate("2026-10-10"), 1)).toBe("2026-10-09");
  });
});

describe("resolveLocalTimestamp", () => {
  it("reads the time on the company's clock", () => {
    expect(
      resolveLocalTimestamp("2026-10-09", "07:00:00", "America/Chicago")
    ).toBe("2026-10-09T12:00:00.000Z");
    expect(resolveLocalTimestamp("2026-10-09", "07:00:00", "UTC")).toBe(
      "2026-10-09T07:00:00.000Z"
    );
  });
});
