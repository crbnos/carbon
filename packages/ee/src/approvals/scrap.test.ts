// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import {
  failedScrapPostingSettlement,
  materialUnitCost,
  operationScrapUnitValue,
  type ScrapValuationMaterial,
  scrapApproverRefusal,
  scrapWriteFailure,
  sumBatchScrap
} from "./scrap";

describe("materialUnitCost", () => {
  it("uses the unit cost", () => {
    expect(materialUnitCost({ unitCost: 12.5, standardCost: 10 })).toBe(12.5);
  });

  it("falls back to the standard cost when the unit cost is 0 or missing", () => {
    // A new item reads 0 until something is received; scrap of it must still
    // meet the tiers.
    expect(materialUnitCost({ unitCost: 0, standardCost: 10 })).toBe(10);
    expect(materialUnitCost({ unitCost: null, standardCost: 10 })).toBe(10);
  });

  it("is 0 with no cost at all", () => {
    expect(materialUnitCost({ unitCost: null, standardCost: null })).toBe(0);
  });

  it("values a Standard item at its standard cost, as the posting does", () => {
    expect(
      materialUnitCost({
        costingMethod: "Standard",
        unitCost: 12.5,
        standardCost: 10
      })
    ).toBe(10);
  });
});

describe("operationScrapUnitValue", () => {
  const material = (
    overrides: Partial<ScrapValuationMaterial>
  ): ScrapValuationMaterial => ({
    itemId: "steel",
    quantity: 1,
    jobOperationId: "op-20",
    itemType: "Material",
    estimatedQuantity: 1,
    requiresBatchTracking: false,
    requiresSerialTracking: false,
    ...overrides
  });
  const routing = [
    { id: "op-10", jobMakeMethodId: "mm", order: 1 },
    { id: "op-20", jobMakeMethodId: "mm", order: 2 },
    { id: "op-20b", jobMakeMethodId: "mm", order: 2 },
    { id: "op-30", jobMakeMethodId: "mm", order: 3 }
  ];
  const costs = new Map([
    ["steel", 10],
    ["bolt", 1],
    ["board", 100],
    ["kit-part", 50]
  ]);
  const value = (
    materials: ScrapValuationMaterial[],
    kitMaterials: ScrapValuationMaterial[] = []
  ) =>
    operationScrapUnitValue({
      operation: { id: "op-20", jobMakeMethodId: "mm", order: 2 },
      routing,
      materials,
      kitMaterials,
      costs
    });

  it("counts this operation's backflush and every earlier operation", () => {
    expect(
      value([
        material({ itemId: "steel", quantity: 2, jobOperationId: "op-20" }),
        material({ itemId: "bolt", quantity: 4, jobOperationId: "op-10" })
      ])
    ).toBe(24);
  });

  it("leaves out later operations and siblings at the same step", () => {
    expect(
      value([
        material({ itemId: "board", jobOperationId: "op-30" }),
        material({ itemId: "board", jobOperationId: "op-20b" })
      ])
    ).toBe(0);
  });

  it("leaves out what this operation's backflush skips", () => {
    // Tracked parts are issued by hand, and a line planned at 0 is not drawn.
    expect(
      value([
        material({ itemId: "board", requiresSerialTracking: true }),
        material({ itemId: "board", estimatedQuantity: 0 }),
        material({ itemId: "board", itemType: "Tool" })
      ])
    ).toBe(0);
  });

  it("counts a kitted child's materials", () => {
    expect(
      value([], [material({ itemId: "kit-part", jobOperationId: null })])
    ).toBe(50);
  });
});

describe("sumBatchScrap", () => {
  const values = new Map([
    ["op-1", { jobId: "job-1", itemId: "item-a", unitValue: 4 }],
    ["op-2", { jobId: "job-1", itemId: "item-a", unitValue: 6 }],
    ["op-3", { jobId: "job-2", itemId: "item-b", unitValue: 10 }]
  ]);

  it("sums quantity and value over the members that scrapped", () => {
    const total = sumBatchScrap(
      [
        { jobOperationId: "op-1", scrapQuantity: 2 },
        { jobOperationId: "op-2", scrapQuantity: 1 },
        { jobOperationId: "op-3", scrapQuantity: 0 }
      ],
      values
    );
    expect(total).toEqual({
      jobId: "job-1",
      itemId: "item-a",
      quantity: 3,
      value: 14
    });
  });

  it("names no job or item when the members differ", () => {
    const total = sumBatchScrap(
      [
        { jobOperationId: "op-1", scrapQuantity: 1 },
        { jobOperationId: "op-3", scrapQuantity: 1 }
      ],
      values
    );
    expect(total.jobId).toBeNull();
    expect(total.itemId).toBeNull();
    expect(total.value).toBe(14);
  });
});

describe("scrapApproverRefusal", () => {
  it("refuses the person who recorded the scrap at the tablet", () => {
    const verdict = scrapApproverRefusal({
      approverId: "operator",
      recordedBy: "operator",
      canApprove: true,
      allowSelf: false
    });
    expect(verdict.error?.code).toBe("self");
  });

  it("lets an approver record their own scrap where allowed", () => {
    // The ERP: an approver typing scrap in at a desk signs on their own
    // authority.
    const verdict = scrapApproverRefusal({
      approverId: "supervisor",
      recordedBy: "supervisor",
      canApprove: true,
      allowSelf: true
    });
    expect(verdict.error).toBeNull();
  });

  it("refuses a person without authority at this tier", () => {
    const verdict = scrapApproverRefusal({
      approverId: "lead",
      recordedBy: "operator",
      canApprove: false,
      allowSelf: false
    });
    expect(verdict.error?.code).toBe("forbidden");
  });

  it("accepts another approver with authority", () => {
    const verdict = scrapApproverRefusal({
      approverId: "supervisor",
      recordedBy: "operator",
      canApprove: true,
      allowSelf: false
    });
    expect(verdict.error).toBeNull();
  });
});

describe("failedScrapPostingSettlement", () => {
  it.each([
    [{ refused: true, committed: false }, "discard"],
    [{ refused: false, committed: false }, "keep"],
    [{ refused: true, committed: true }, "mark posted"],
    [{ refused: false, committed: true }, "mark posted"]
  ] as const)("settles %o as %s", (args, expected) => {
    expect(failedScrapPostingSettlement(args)).toBe(expected);
  });

  it("keeps the record of a refusal when whether it posted is unknown", () => {
    expect(
      failedScrapPostingSettlement({ refused: true, committed: "unknown" })
    ).toBe("keep");
  });
});

describe("scrapWriteFailure", () => {
  it.each([
    [{ status: 409, code: "23505" }, "refused"],
    [{ status: 422 }, "refused"],
    [{ code: "P0001" }, "refused"]
  ] as const)("knows %o did not write", (error, expected) => {
    expect(scrapWriteFailure(error)).toBe(expected);
  });

  it.each([
    [{ status: 0, code: "" }, "unknown"],
    [{ status: 500 }, "unknown"],
    [{ status: 504 }, "unknown"],
    [{ code: "08006" }, "unknown"],
    [{ code: "57P01" }, "unknown"],
    [{ code: "ECONNRESET" }, "unknown"],
    [new Error("Connection terminated unexpectedly"), "unknown"],
    [null, "unknown"]
  ] as const)("cannot tell whether %o wrote", (error, expected) => {
    expect(scrapWriteFailure(error)).toBe(expected);
  });
});
