// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  batchRequiredScanMessage,
  firstOpenOperationIds,
  issuedByJobMaterial,
  netTrackedInputs,
  type RequiredScanMaterial,
  requiredScanMessage,
  requiredScanShortfall,
  unissuedTrackedMaterials
} from "./trackedMaterials";

const material = (
  overrides: Partial<RequiredScanMaterial> = {}
): RequiredScanMaterial => ({
  id: "jm_1",
  jobMakeMethodId: "jmm_1",
  jobOperationId: "op_2",
  requiresSerialTracking: true,
  requiresBatchTracking: false,
  quantity: 1,
  quantityIssued: 0,
  ...overrides
});

const args = (
  materials: RequiredScanMaterial[],
  overrides: Partial<Parameters<typeof unissuedTrackedMaterials>[0]> = {}
) => ({
  materials,
  operationId: "op_2",
  jobMakeMethodId: "jmm_1",
  isFirstOpenOperation: false,
  unitsAfterCompletion: 1,
  ...overrides
});

describe("unissuedTrackedMaterials", () => {
  it("requires a material with no operation at the first open operation", () => {
    const unassigned = material({ jobOperationId: null });
    expect(
      unissuedTrackedMaterials(
        args([unassigned], { isFirstOpenOperation: true })
      )
    ).toEqual([unassigned]);
  });

  it("does not require a material with no operation at a later operation", () => {
    const unassigned = material({ jobOperationId: null });
    const otherOperation = material({ id: "jm_2", jobOperationId: "op_1" });
    expect(
      unissuedTrackedMaterials(args([unassigned, otherOperation]))
    ).toEqual([]);
  });

  it("ignores a material of another make method", () => {
    expect(
      unissuedTrackedMaterials(
        args([material({ jobMakeMethodId: "jmm_sub" })], {
          isFirstOpenOperation: true
        })
      )
    ).toEqual([]);
  });

  it("does not require a material that is fully issued", () => {
    expect(
      unissuedTrackedMaterials(
        args([material({ quantity: 2, quantityIssued: 2 })])
      )
    ).toEqual([]);
  });

  it("requires the quantity for every unit completed so far", () => {
    // 2 per unit, 2 units after this completion: 4 needed, 3 issued.
    const batch = material({
      requiresSerialTracking: false,
      requiresBatchTracking: true,
      quantity: 2,
      quantityIssued: 3
    });
    expect(
      unissuedTrackedMaterials(args([batch], { unitsAfterCompletion: 2 }))
    ).toEqual([batch]);
    expect(
      unissuedTrackedMaterials(
        args([{ ...batch, quantityIssued: 4 }], { unitsAfterCompletion: 2 })
      )
    ).toEqual([]);
  });

  it("compares decimal quantities at the internal scale", () => {
    // 0.1 × 3 is 0.30000000000000004 in floating point; 0.3 issued is enough.
    const batch = material({
      requiresSerialTracking: false,
      requiresBatchTracking: true,
      quantity: 0.1,
      quantityIssued: 0.3
    });
    expect(
      unissuedTrackedMaterials(args([batch], { unitsAfterCompletion: 3 }))
    ).toEqual([]);
    expect(
      requiredScanShortfall({
        materials: [{ ...batch, quantityIssued: 0.2 }],
        operationId: "op_2",
        jobMakeMethodId: "jmm_1",
        isFirstOpenOperation: false,
        units: { kind: "operation", unitsAfterCompletion: 3 }
      }).map(({ issued, required }) => ({ issued, required }))
    ).toEqual([{ issued: 0.2, required: 0.3 }]);
  });
});

describe("requiredScanMessage", () => {
  it("returns null when nothing is missing", () => {
    expect(requiredScanMessage([])).toBeNull();
  });
});

describe("firstOpenOperationIds", () => {
  it("picks the lowest order of each make method", () => {
    // op_1 is Done, so the open operations start at op_2.
    const first = firstOpenOperationIds([
      { id: "op_3", jobMakeMethodId: "jmm_top", order: 3 },
      { id: "op_2", jobMakeMethodId: "jmm_top", order: 2 },
      { id: "op_9", jobMakeMethodId: "jmm_sub", order: 1 }
    ]);
    expect([...first].sort()).toEqual(["op_2", "op_9"]);
  });

  it("breaks a tie on order by id, as the line feed does", () => {
    const first = firstOpenOperationIds([
      { id: "op_b", jobMakeMethodId: "jmm_1", order: 1 },
      { id: "op_a", jobMakeMethodId: "jmm_1", order: 1 }
    ]);
    expect([...first]).toEqual(["op_a"]);
  });

  it("leaves out an operation with no make method", () => {
    expect([
      ...firstOpenOperationIds([
        { id: "op_1", jobMakeMethodId: null, order: 1 }
      ])
    ]).toEqual([]);
  });
});

describe("netTrackedInputs", () => {
  it("drops a scrapped input and one given back by an Unconsume", () => {
    const inputs = [
      { id: "chamber", status: "Consumed" },
      { id: "nozzle", status: "Consumed" },
      { id: "bolt", status: "Scrapped" }
    ];
    expect(
      netTrackedInputs(inputs, [{ id: "nozzle" }]).map((i) => i.id)
    ).toEqual(["chamber"]);
  });

  it("keeps an input consumed again after it was given back", () => {
    const inputs = [
      { id: "chamber", status: "Consumed" },
      { id: "chamber", status: "Consumed" }
    ];
    expect(
      netTrackedInputs(inputs, [{ id: "chamber" }]).map((i) => i.id)
    ).toEqual(["chamber"]);
  });
});

describe("issuedByJobMaterial", () => {
  it("sums the scanned quantity per job material", () => {
    const issued = issuedByJobMaterial([
      { quantity: 1, activityAttributes: { "Job Material": "jm_1" } },
      { quantity: 2, activityAttributes: { "Job Material": "jm_1" } },
      { quantity: 5, activityAttributes: null }
    ]);
    expect([...issued]).toEqual([["jm_1", 3]]);
  });
});

describe("requiredScanShortfall", () => {
  const base = {
    operationId: "op_2",
    jobMakeMethodId: "jmm_1",
    isFirstOpenOperation: false
  };

  it("refuses serial units when one of them is missing its part", () => {
    // 3 units, 1 chamber each: unit A has it, B has 2 (counts 1), C has none.
    const chamber = material();
    const rows = requiredScanShortfall({
      ...base,
      materials: [chamber],
      units: {
        kind: "serial",
        issuedByUnit: [
          new Map([["jm_1", 1]]),
          new Map([["jm_1", 2]]),
          new Map()
        ]
      }
    });
    expect(rows).toEqual([{ material: chamber, issued: 2, required: 3 }]);
  });

  it("lets serial units through when each holds its part", () => {
    expect(
      requiredScanShortfall({
        ...base,
        materials: [material()],
        units: {
          kind: "serial",
          issuedByUnit: [new Map([["jm_1", 1]]), new Map([["jm_1", 1]])]
        }
      })
    ).toEqual([]);
  });

  it("counts the operation's issued quantity for a non-serial parent", () => {
    const batch = material({ quantity: 2, quantityIssued: 3 });
    expect(
      requiredScanShortfall({
        ...base,
        materials: [batch],
        units: { kind: "operation", unitsAfterCompletion: 2 }
      })
    ).toEqual([{ material: batch, issued: 3, required: 4 }]);
  });
});

describe("batchRequiredScanMessage", () => {
  it("names only the members that are short", () => {
    expect(
      batchRequiredScanMessage([
        { label: "J000001", rows: [] },
        {
          label: "J000002",
          rows: [
            { itemReadableId: "CHAMBER", issued: 0, required: 2 },
            { itemReadableId: "NOZZLE", issued: 1, required: 2 }
          ]
        }
      ])
    ).toBe(
      "Scan in these parts first: J000002: CHAMBER (0 of 2), NOZZLE (1 of 2)"
    );
  });

  it("returns null when no member is short", () => {
    expect(
      batchRequiredScanMessage([{ label: "J000001", rows: [] }])
    ).toBeNull();
  });
});
