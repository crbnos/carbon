// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  isUnitInOperationScope,
  parseTravelerCode,
  pickTravelerMaterial,
  pickTravelerOperation,
  travelerIssueCandidates,
  travelerScanAction
} from "./traveler";

describe("parseTravelerCode", () => {
  it("reads the id from a label printed on another origin", () => {
    expect(
      parseTravelerCode("https://mes.try.carbon.ms/x/traveler/te_9k2m1q")
    ).toBe("te_9k2m1q");
  });

  it("returns null for a raw id, the resolve route and other paths", () => {
    expect(parseTravelerCode("te_9k2m1q")).toBeNull();
    expect(
      parseTravelerCode("https://mes.carbon.ms/x/traveler/resolve")
    ).toBeNull();
    expect(
      parseTravelerCode("https://mes.carbon.ms/x/operation/op_1")
    ).toBeNull();
  });
});

describe("pickTravelerOperation", () => {
  const operations = [
    { id: "op_10", workCenterId: "wc_assy", operationOrder: 10 },
    { id: "op_20a", workCenterId: "wc_test", operationOrder: 20 },
    { id: "op_20b", workCenterId: "wc_test", operationOrder: 20 },
    { id: "op_30", workCenterId: "wc_pack", operationOrder: 30 }
  ];

  it("opens the one operation at the operator's work center", () => {
    expect(
      pickTravelerOperation({ operations, workCenterId: "wc_pack" })
    ).toEqual({ kind: "open", operationId: "op_30" });
  });

  it("asks the operator to choose between 2 operations at the station", () => {
    expect(
      pickTravelerOperation({ operations, workCenterId: "wc_test" })
    ).toEqual({ kind: "choose", operationIds: ["op_20a", "op_20b"] });
  });

  it("opens the next operation in routing order with no station match", () => {
    expect(
      pickTravelerOperation({ operations, workCenterId: "wc_paint" })
    ).toEqual({ kind: "open", operationId: "op_10" });
  });

  it("asks the operator to choose between parallel operations of equal order", () => {
    expect(
      pickTravelerOperation({
        operations: operations.slice(1),
        workCenterId: null
      })
    ).toEqual({ kind: "choose", operationIds: ["op_20a", "op_20b"] });
  });

  it("returns none when the unit has no open operation", () => {
    expect(
      pickTravelerOperation({ operations: [], workCenterId: null })
    ).toEqual({ kind: "none" });
  });
});

describe("travelerIssueCandidates", () => {
  const operations = [
    {
      id: "op_a10",
      jobMakeMethodId: "jmm_a",
      workCenterId: "wc_assy",
      operationOrder: 10,
      jobDueDate: "2026-11-20"
    },
    {
      id: "op_a20",
      jobMakeMethodId: "jmm_a",
      workCenterId: "wc_test",
      operationOrder: 20,
      jobDueDate: "2026-11-20"
    },
    {
      id: "op_b10",
      jobMakeMethodId: "jmm_b",
      workCenterId: "wc_assy",
      operationOrder: 10,
      jobDueDate: "2026-11-15"
    },
    {
      id: "op_c10",
      jobMakeMethodId: "jmm_c",
      workCenterId: "wc_assy",
      operationOrder: 10,
      jobDueDate: null
    }
  ];
  const material = (overrides: {
    jobMakeMethodId: string;
    jobOperationId: string | null;
    quantityIssued?: number | null;
  }) => ({
    quantity: 1,
    estimatedQuantity: 1,
    quantityIssued: 0,
    ...overrides
  });

  it("gives a material with no operation to the first open operation of its make method", () => {
    expect(
      travelerIssueCandidates({
        operations,
        materials: [
          material({ jobMakeMethodId: "jmm_a", jobOperationId: null })
        ],
        workCenterId: null
      })
    ).toEqual(["op_a10"]);
  });

  it("skips a fully issued material and one whose operation is not open", () => {
    expect(
      travelerIssueCandidates({
        operations,
        materials: [
          material({
            jobMakeMethodId: "jmm_a",
            jobOperationId: "op_a10",
            quantityIssued: 1
          }),
          material({ jobMakeMethodId: "jmm_a", jobOperationId: "op_closed" })
        ],
        workCenterId: null
      })
    ).toEqual([]);
  });

  it("leaves a serial make method's job-level shortfall to the per-unit check", () => {
    expect(
      travelerIssueCandidates({
        operations,
        materials: [
          material({
            jobMakeMethodId: "jmm_a",
            jobOperationId: "op_a10",
            quantityIssued: 1
          })
        ],
        workCenterId: null,
        perUnitMakeMethodIds: new Set(["jmm_a"])
      })
    ).toEqual(["op_a10"]);
  });

  it("orders the station first, then due date with none last, then routing order", () => {
    expect(
      travelerIssueCandidates({
        operations,
        materials: [
          material({ jobMakeMethodId: "jmm_c", jobOperationId: "op_c10" }),
          material({ jobMakeMethodId: "jmm_a", jobOperationId: "op_a10" }),
          material({ jobMakeMethodId: "jmm_a", jobOperationId: "op_a10" }),
          material({ jobMakeMethodId: "jmm_b", jobOperationId: "op_b10" }),
          material({ jobMakeMethodId: "jmm_a", jobOperationId: "op_a20" })
        ],
        workCenterId: "wc_test"
      })
    ).toEqual(["op_a20", "op_b10", "op_a10", "op_c10"]);
  });
});

describe("travelerScanAction", () => {
  const base = {
    scannedStatus: "Consumed",
    targetTrackedEntityId: "te_engine",
    targetStatus: "Reserved",
    targetJobMakeMethodId: "jmm_engine",
    targetInProduction: false,
    operationJobMakeMethodId: "jmm_engine"
  };

  it("issues an available unit", () => {
    expect(
      travelerScanAction({
        ...base,
        scannedStatus: "Available",
        targetTrackedEntityId: "te_chamber",
        targetStatus: "Available",
        targetJobMakeMethodId: null
      })
    ).toEqual({ kind: "issue" });
  });

  it("opens the unit a consumed unit is already inside in this job", () => {
    expect(travelerScanAction(base)).toEqual({
      kind: "open",
      trackedEntityId: "te_engine"
    });
  });

  it("navigates for a unit inside another job", () => {
    expect(
      travelerScanAction({ ...base, targetJobMakeMethodId: "jmm_other" })
    ).toEqual({ kind: "navigate" });
  });

  it("opens this job's own unit after a completed operation made it Available", () => {
    expect(
      travelerScanAction({
        ...base,
        scannedStatus: "Available",
        targetTrackedEntityId: "te_engine",
        targetStatus: "Available",
        targetInProduction: true
      })
    ).toEqual({ kind: "open", trackedEntityId: "te_engine" });
  });

  it("never issues a unit that is still in production in another job", () => {
    expect(
      travelerScanAction({
        ...base,
        scannedStatus: "Available",
        targetTrackedEntityId: "te_chamber",
        targetStatus: "Available",
        targetJobMakeMethodId: "jmm_chamber",
        targetInProduction: true
      })
    ).toEqual({ kind: "navigate" });
  });
});

describe("pickTravelerMaterial", () => {
  // The merge station of the AJ-3 engine: 1 combustion chamber per unit.
  const base = (overrides: {
    id: string;
    jobOperationId: string | null;
    quantity?: number;
    estimatedQuantity?: number | null;
    quantityIssued?: number | null;
  }) => ({
    quantity: 1,
    estimatedQuantity: 4,
    quantityIssued: 0,
    ...overrides
  });
  const atMerge = base({ id: "jm_cc", jobOperationId: "op_merge" });
  const unassigned = base({ id: "jm_spare", jobOperationId: null });
  const chamber = (materialId: string, quantity: number) => ({
    materialId,
    itemId: "item_chamber",
    quantity
  });

  it("refuses a second chamber for a unit that already has one", () => {
    expect(
      pickTravelerMaterial({
        materials: [atMerge],
        jobOperationId: "op_merge",
        itemId: "item_chamber",
        unitConsumed: [chamber("jm_cc", 1)]
      })
    ).toEqual({ kind: "full" });
  });

  it("issues into this operation's material while the unit still needs it", () => {
    expect(
      pickTravelerMaterial({
        materials: [unassigned, atMerge],
        jobOperationId: "op_merge",
        itemId: "item_chamber",
        unitConsumed: []
      })
    ).toEqual({ kind: "issue", material: atMerge });
  });

  it("takes the unassigned material once this operation's is in the unit", () => {
    expect(
      pickTravelerMaterial({
        materials: [atMerge, unassigned],
        jobOperationId: "op_merge",
        itemId: "item_chamber",
        unitConsumed: [chamber("jm_cc", 1)]
      })
    ).toEqual({ kind: "issue", material: unassigned });
  });

  it("counts a chamber booked to another material of the item", () => {
    // The Issue dialog's issue by item books to a new 0-quantity material.
    expect(
      pickTravelerMaterial({
        materials: [
          atMerge,
          base({ id: "jm_extra", jobOperationId: "op_merge", quantity: 0 })
        ],
        jobOperationId: "op_merge",
        itemId: "item_chamber",
        unitConsumed: [chamber("jm_extra", 1)]
      })
    ).toEqual({ kind: "full" });
  });

  it("does not count a fitted bolt against the chamber", () => {
    // The bolt was consumed into the unit through the bolt's own material,
    // which is not a chamber material.
    expect(
      pickTravelerMaterial({
        materials: [atMerge],
        jobOperationId: "op_merge",
        itemId: "item_chamber",
        unitConsumed: [
          { materialId: "jm_bolt", itemId: "item_bolt", quantity: 1 }
        ]
      })
    ).toEqual({ kind: "issue", material: atMerge });
  });

  it("gives an untracked parent what the job has not issued", () => {
    expect(
      pickTravelerMaterial({
        materials: [{ ...atMerge, quantityIssued: 3 }],
        jobOperationId: "op_merge",
        itemId: "item_chamber",
        unitConsumed: null
      })
    ).toEqual({ kind: "issue", material: { ...atMerge, quantityIssued: 3 } });
    expect(
      pickTravelerMaterial({
        materials: [{ ...atMerge, quantityIssued: 4 }],
        jobOperationId: "op_merge",
        itemId: "item_chamber",
        unitConsumed: null
      })
    ).toEqual({ kind: "full" });
  });

  it("refuses an item only another operation uses", () => {
    expect(
      pickTravelerMaterial({
        materials: [base({ id: "jm_other", jobOperationId: "op_test" })],
        jobOperationId: "op_merge",
        itemId: "item_chamber",
        unitConsumed: []
      })
    ).toEqual({ kind: "notUsed" });
  });
});

describe("isUnitInOperationScope", () => {
  const scopes = new Map([["op_rework", new Set(["te_b"])]]);

  it("applies a rework operation only to the units sent into it", () => {
    expect(isUnitInOperationScope(scopes, "op_rework", "te_b")).toBe(true);
    expect(isUnitInOperationScope(scopes, "op_rework", "te_a")).toBe(false);
  });

  it("applies an operation with no scope rows to every unit", () => {
    expect(isUnitInOperationScope(scopes, "op_paint", "te_a")).toBe(true);
  });
});
