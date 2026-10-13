// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { assetCostIncrements, buildProjectCipRow } from "./project-cip";

const base = {
  companyId: "co-1",
  userId: "user-1",
  projectId: "prj-1",
  projectElementId: "el-1",
  sourceType: "Timesheet" as const,
  sourceDocumentId: "tse-1",
  amount: 850,
  costDate: "2026-10-05",
  journalId: "jr-1"
};

describe("buildProjectCipRow", () => {
  it("returns null for a cost that builds no asset", () => {
    expect(
      buildProjectCipRow({
        ...base,
        resolved: { fixedAssetId: null, postCapitalization: false }
      })
    ).toBeNull();
  });

  it("builds a row for an asset under construction", () => {
    expect(
      buildProjectCipRow({
        ...base,
        resolved: { fixedAssetId: "fa-1", postCapitalization: false }
      })
    ).toMatchObject({
      fixedAssetId: "fa-1",
      sourceType: "Timesheet",
      sourceDocumentId: "tse-1",
      projectId: "prj-1",
      projectElementId: "el-1",
      amount: 850,
      journalId: "jr-1",
      postCapitalization: false
    });
  });

  it("flags a late cost on an Active asset", () => {
    expect(
      buildProjectCipRow({
        ...base,
        resolved: { fixedAssetId: "fa-1", postCapitalization: true }
      })?.postCapitalization
    ).toBe(true);
  });
});

describe("assetCostIncrements", () => {
  it("sums the rows of one asset", () => {
    expect(
      assetCostIncrements([
        { fixedAssetId: "fa-1", amount: 850 },
        { fixedAssetId: "fa-1", amount: 30.25 },
        { fixedAssetId: "fa-2", amount: -10 }
      ])
    ).toEqual(
      new Map([
        ["fa-1", 880.25],
        ["fa-2", -10]
      ])
    );
  });
});
