// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { applyChange } from "./liveList";

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name);
const rows = [
  { id: "1", name: "Acme" },
  { id: "2", name: "Zenith" }
];

describe("applyChange", () => {
  it("adds an inserted row in sort order", () => {
    expect(
      applyChange(
        rows,
        { op: "INSERT", ids: ["3"] },
        [{ id: "3", name: "Mid" }],
        byName
      )
    ).toEqual([rows[0], { id: "3", name: "Mid" }, rows[1]]);
  });

  it("does not double-add a row that is already in the list", () => {
    expect(
      applyChange(rows, { op: "INSERT", ids: ["1"] }, [rows[0]!], byName)
    ).toEqual(rows);
  });

  it("replaces an updated row and re-sorts", () => {
    expect(
      applyChange(
        rows,
        { op: "UPDATE", ids: ["1"] },
        [{ id: "1", name: "Zulu" }],
        byName
      )
    ).toEqual([rows[1], { id: "1", name: "Zulu" }]);
  });

  it("removes a deleted row", () => {
    expect(applyChange(rows, { op: "DELETE", ids: ["2"] }, [], byName)).toEqual(
      [rows[0]]
    );
  });

  it("drops an updated row the re-read no longer returns", () => {
    expect(applyChange(rows, { op: "UPDATE", ids: ["2"] }, [], byName)).toEqual(
      [rows[0]]
    );
  });
});
