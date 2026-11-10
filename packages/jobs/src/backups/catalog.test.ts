// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { type TableInfo, topologicalSort } from "./catalog";

const table = (name: string, refs: string[]) =>
  ({
    name,
    foreignKeys: refs.map((refTable) => ({
      column: `${refTable}Id`,
      refTable,
      refColumn: "id"
    }))
  }) as unknown as TableInfo;

describe("topologicalSort", () => {
  it("keeps a table that hangs off a cycle after the cycle", () => {
    // `order` and `line` reference each other; `fav` only references `order`
    // and sorts first alphabetically, so a tie-break outside the cycle put it
    // ahead of its parent — and the reversed wipe then missed its rows.
    const names = topologicalSort([
      table("fav", ["order"]),
      table("line", ["order"]),
      table("order", ["line"])
    ]).map((t) => t.name);
    expect(names.indexOf("fav")).toBeGreaterThan(names.indexOf("order"));
  });
});
