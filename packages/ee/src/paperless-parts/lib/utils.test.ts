// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";
import { afterEach, describe, expect, it, vi } from "vitest";
import { calculatePromisedDate } from "./utils";

type Holiday = Database["public"]["Tables"]["holiday"]["Row"];

const holiday = (date: string): Holiday => ({
  id: date,
  companyId: "company",
  name: date,
  date,
  year: 2024,
  tags: [],
  customFields: {},
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: null,
  createdBy: "system",
  updatedBy: null
});

// The result is local midnight, so read it back in local time.
const localDay = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

afterEach(() => {
  vi.useRealTimers();
});

describe("calculatePromisedDate", () => {
  // 2024-08-19 is a Monday; Labor Day 2024-09-02 is a Monday.
  it.each<[string, string, number, string[], string]>([
    [
      "counts from today before the 10:00 cutoff",
      "2024-08-20T07:00:00",
      3,
      [],
      "2024-08-23"
    ],
    [
      "counts from tomorrow after the cutoff",
      "2024-08-22T11:00:00",
      3,
      [],
      "2024-08-28"
    ],
    [
      "treats exactly 10:00 as after the cutoff",
      "2024-08-20T10:00:00",
      2,
      [],
      "2024-08-23"
    ],
    ["skips the weekend", "2024-08-23T09:00:00", 2, [], "2024-08-27"],
    [
      "promises the next weekday for a one-day lead time",
      "2024-08-19T09:00:00",
      1,
      [],
      "2024-08-20"
    ],
    [
      "rolls a Friday-after-cutoff order past the weekend",
      "2024-08-23T11:00:00",
      1,
      [],
      "2024-08-26"
    ],
    ["skips a holiday", "2024-08-29T07:00:00", 3, ["2024-09-02"], "2024-09-04"],
    [
      "skips consecutive holidays",
      "2024-08-29T07:00:00",
      3,
      ["2024-09-02", "2024-09-03"],
      "2024-09-05"
    ]
  ])("%s", (_name, now, leadTime, holidays, expected) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    expect(
      localDay(calculatePromisedDate(leadTime, holidays.map(holiday)))
    ).toBe(expected);
  });
});
