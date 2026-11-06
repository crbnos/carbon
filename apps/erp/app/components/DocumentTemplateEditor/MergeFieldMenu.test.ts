// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { filterMergeFields } from "./MergeFieldMenu";

const fields = [
  { token: "rmaNumber", label: "RMA Number", group: "Return" },
  { token: "orderDate", label: "Order Date", group: "Return" },
  { token: "total", label: "Total", group: "Totals" },
  { token: "customerName", label: "Customer Name", group: "Customer" }
];
const tokens = (search: string, nameOf?: (name: string) => string) =>
  filterMergeFields(fields, search, nameOf).map((f) => f.token);

describe("filterMergeFields", () => {
  it("keeps every field for an empty search", () => {
    expect(tokens("  ")).toHaveLength(fields.length);
  });

  it("ignores case and word order, across the name and the group", () => {
    expect(tokens("date RETURN")).toEqual(["orderDate"]);
  });

  it("finds a whole group by its name", () => {
    expect(tokens("return")).toEqual(["rmaNumber", "orderDate"]);
  });

  it("does not match scattered letters", () => {
    expect(tokens("rnr")).toEqual([]);
  });

  it("searches the names the reader sees", () => {
    const german = (name: string) => (name === "Total" ? "Gesamt" : name);
    expect(tokens("gesamt", german)).toEqual(["total"]);
  });
});
