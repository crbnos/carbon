// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { withSavedValuesKept } from "./saved-values";

describe("withSavedValuesKept", () => {
  const update = {
    name: "Bracket",
    replenishmentSystem: "Buy and Make",
    active: true,
    laborRate: 0,
    updatedAt: "2026-10-16T00:00:00Z",
    updatedBy: "user_1"
  };

  it("writes only the fields the row holds, and the audit columns", () => {
    expect(withSavedValuesKept(update, new Set(["name"]))).toEqual({
      name: "Bracket",
      updatedAt: "2026-10-16T00:00:00Z",
      updatedBy: "user_1"
    });
  });

  it("keeps a held field whatever its value", () => {
    expect(
      withSavedValuesKept(update, new Set(["name", "active", "laborRate"]))
    ).toMatchObject({ active: true, laborRate: 0 });
  });

  it("reads a derived column's field from sources", () => {
    expect(
      withSavedValuesKept(
        { storageTypeIds: ["st_1"], updatedBy: "user_1" },
        new Set(["storageTypeNames"]),
        { storageTypeIds: "storageTypeNames" }
      )
    ).toEqual({ storageTypeIds: ["st_1"], updatedBy: "user_1" });
  });
});
