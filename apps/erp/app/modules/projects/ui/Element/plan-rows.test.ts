// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { orderPlanRows, type PlanLineType } from "./plan-rows";

const row = (
  key: string,
  type: PlanLineType,
  createdAt: string | null,
  draft = false
) => ({ key, type, id: draft ? null : key, createdAt, draft });

const keys = (rows: { key: string }[]) => rows.map((r) => r.key);

describe("orderPlanRows", () => {
  it("puts materials, then labor, then costs", () => {
    const rows = [
      row("c1", "cost", "2026-10-01T00:00:00+00:00"),
      row("l1", "labor", "2026-10-01T00:00:00+00:00"),
      row("m1", "material", "2026-10-02T00:00:00+00:00")
    ];
    expect(keys(orderPlanRows(rows))).toEqual(["m1", "l1", "c1"]);
  });

  it("orders a type by createdAt, then id", () => {
    const rows = [
      row("m-b", "material", "2026-10-02T00:00:00+00:00"),
      row("m-c", "material", "2026-10-01T00:00:00+00:00"),
      row("m-a", "material", "2026-10-02T00:00:00+00:00")
    ];
    expect(keys(orderPlanRows(rows))).toEqual(["m-c", "m-a", "m-b"]);
  });

  it("keeps a draft at the end of its own type, not after every row", () => {
    const rows = [
      row("m1", "material", "2026-10-01T00:00:00+00:00"),
      row("l1", "labor", "2026-10-01T00:00:00+00:00"),
      row("d1", "material", null, true)
    ];
    expect(keys(orderPlanRows(rows))).toEqual(["m1", "d1", "l1"]);
  });

  it("puts a saved draft where the draft was", () => {
    // The draft saves and comes back as the newest material line.
    const before = orderPlanRows([
      row("m1", "material", "2026-10-01T00:00:00+00:00"),
      row("l1", "labor", "2026-10-01T00:00:00+00:00"),
      row("d1", "material", null, true)
    ]);
    const after = orderPlanRows([
      row("m1", "material", "2026-10-01T00:00:00+00:00"),
      row("l1", "labor", "2026-10-01T00:00:00+00:00"),
      row("m2", "material", "2026-10-13T00:00:00+00:00")
    ]);
    expect(keys(before).indexOf("d1")).toBe(keys(after).indexOf("m2"));
  });

  it("keeps drafts in the order they were added", () => {
    const rows = [
      row("d2", "cost", null, true),
      row("d1", "cost", null, true),
      row("c1", "cost", "2026-10-01T00:00:00+00:00")
    ];
    expect(keys(orderPlanRows(rows))).toEqual(["c1", "d2", "d1"]);
  });

  it("does not move a line whose item changed", () => {
    const rows = [
      row("m1", "material", "2026-10-01T00:00:00+00:00"),
      row("m2", "material", "2026-10-02T00:00:00+00:00")
    ];
    const edited = [{ ...rows[0], line: "another item" }, rows[1]];
    expect(keys(orderPlanRows(edited))).toEqual(["m1", "m2"]);
  });
});
