// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { compareActivityDates } from "./utils";

const dates = [
  "2026-11-09T10:00:00+00:00",
  undefined,
  "2026-11-01T08:30:00+00:00",
  "2026-11-05T12:00:00+00:00"
];

describe("compareActivityDates", () => {
  it("lists newest first, with an undated activity last", () => {
    expect(
      [...dates].sort((a, b) => compareActivityDates(a, b, "newest"))
    ).toEqual([
      "2026-11-09T10:00:00+00:00",
      "2026-11-05T12:00:00+00:00",
      "2026-11-01T08:30:00+00:00",
      undefined
    ]);
  });

  it("lists oldest first, with an undated activity still last", () => {
    expect(
      [...dates].sort((a, b) => compareActivityDates(a, b, "oldest"))
    ).toEqual([
      "2026-11-01T08:30:00+00:00",
      "2026-11-05T12:00:00+00:00",
      "2026-11-09T10:00:00+00:00",
      undefined
    ]);
  });
});
