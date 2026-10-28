// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  parseEstimateDays,
  readCustomization,
  summarizeCustomizations
} from "./customization";

describe("readCustomization", () => {
  it("reads a complete row as stored", () => {
    expect(
      readCustomization({
        title: "Packing slip with lot numbers",
        kind: "documentTemplate",
        status: "agreed",
        detail: "Lot and expiry on every line",
        requirementRowId: "INV.LT.01",
        targetDate: "2026-12-04",
        estimateDays: 1.5
      })
    ).toEqual({
      title: "Packing slip with lot numbers",
      kind: "documentTemplate",
      status: "agreed",
      detail: "Lot and expiry on every line",
      requirementRowId: "INV.LT.01",
      targetDate: "2026-12-04",
      estimateDays: 1.5
    });
  });

  it("falls back to a new row's kind and status and drops bad cells", () => {
    expect(
      readCustomization({
        title: 7,
        kind: "magic",
        status: "shipped",
        detail: "",
        targetDate: "04/12/2026",
        estimateDays: -2
      })
    ).toEqual({ title: "", kind: "configuration", status: "proposed" });
  });
});

describe("parseEstimateDays", () => {
  it("reads a non-negative number of days", () => {
    expect(parseEstimateDays(" 3 ")).toBe(3);
    expect(parseEstimateDays("0.5")).toBe(0.5);
    expect(parseEstimateDays("0")).toBe(0);
  });

  it("reads blank, negative or non-numeric input as no estimate", () => {
    expect(parseEstimateDays("")).toBeUndefined();
    expect(parseEstimateDays("-1")).toBeUndefined();
    expect(parseEstimateDays("two")).toBeUndefined();
  });
});

describe("summarizeCustomizations", () => {
  it("counts each status and totals the committed estimates", () => {
    const summary = summarizeCustomizations([
      { title: "A", kind: "report", status: "proposed", estimateDays: 5 },
      { title: "B", kind: "integration", status: "agreed", estimateDays: 3 },
      { title: "C", kind: "code", status: "inProgress", estimateDays: 2.5 },
      { title: "D", kind: "automation", status: "inProgress" },
      { title: "E", kind: "customField", status: "done", estimateDays: 1 },
      { title: "F", kind: "report", status: "dropped", estimateDays: 8 }
    ]);
    expect(summary.byStatus).toEqual({
      proposed: 1,
      agreed: 1,
      inProgress: 2,
      done: 1,
      dropped: 1
    });
    expect(summary.committedDays).toBe(5.5);
  });

  it("starts every status at zero", () => {
    expect(summarizeCustomizations([])).toEqual({
      byStatus: { proposed: 0, agreed: 0, inProgress: 0, done: 0, dropped: 0 },
      committedDays: 0
    });
  });
});
