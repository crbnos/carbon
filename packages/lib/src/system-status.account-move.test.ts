// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { accountMoveDate } from "./system-status";

describe("accountMoveDate", () => {
  it("reads the date set on the company", () => {
    expect(accountMoveDate({ migrationDate: "2026-11-01" })).toBe("2026-11-01");
    expect(accountMoveDate({ migrationDate: "2026-11-01", other: true })).toBe(
      "2026-11-01"
    );
  });

  it("is null when there is no date to show", () => {
    expect(accountMoveDate({})).toBeNull();
    expect(accountMoveDate(null)).toBeNull();
    expect(accountMoveDate({ migrationDate: null })).toBeNull();
    expect(accountMoveDate({ migrationDate: "" })).toBeNull();
    expect(accountMoveDate({ migrationDate: "next week" })).toBeNull();
    expect(accountMoveDate({ migrationDate: "2026-13-40" })).toBeNull();
  });
});
