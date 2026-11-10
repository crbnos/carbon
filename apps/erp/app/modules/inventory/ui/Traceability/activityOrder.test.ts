// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { type ActivityOrder, compareActivityDates } from "./utils";

// Objects, not bare dates: Array.prototype.sort puts an `undefined` element
// last without calling the comparator, so sorting objects is what exercises
// the comparator's undated branch.
const activities: { id: string; createdAt: string | null | undefined }[] = [
  { id: "undated", createdAt: null },
  { id: "nov-09", createdAt: "2026-11-09T10:00:00+00:00" },
  { id: "no-date", createdAt: undefined },
  { id: "nov-01", createdAt: "2026-11-01T08:30:00+00:00" },
  { id: "nov-05", createdAt: "2026-11-05T12:00:00+00:00" }
];

const sortedIds = (order: ActivityOrder) =>
  [...activities]
    .sort((a, b) => compareActivityDates(a.createdAt, b.createdAt, order))
    .map((a) => a.id);

describe("compareActivityDates", () => {
  it("lists newest first, with undated activities last", () => {
    expect(sortedIds("newest")).toEqual([
      "nov-09",
      "nov-05",
      "nov-01",
      "undated",
      "no-date"
    ]);
  });

  it("lists oldest first, with undated activities still last", () => {
    expect(sortedIds("oldest")).toEqual([
      "nov-01",
      "nov-05",
      "nov-09",
      "undated",
      "no-date"
    ]);
  });
});
