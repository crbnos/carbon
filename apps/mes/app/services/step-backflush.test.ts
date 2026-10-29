// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  ownsLooseMaterial,
  planStepBackflush,
  type StepBackflushMaterial
} from "./step-backflush";

const material = (
  overrides: Partial<StepBackflushMaterial> & { id: string }
): StepBackflushMaterial => ({
  itemId: `item-${overrides.id}`,
  quantity: 1,
  quantityIssued: 0,
  jobOperationId: "op-1",
  ...overrides
});

describe("planStepBackflush", () => {
  it("issues a loose part when the operation's first step is recorded", () => {
    const issues = planStepBackflush({
      operationId: "op-1",
      stepIds: ["s1", "s2"],
      materials: [material({ id: "glue", quantity: 2 })],
      stepLinks: [],
      records: [{ jobOperationStepId: "s1", index: 0 }]
    });
    expect(issues).toEqual([
      { materialId: "glue", itemId: "item-glue", quantity: 2 }
    ]);
  });

  it("does not issue a loose part that belongs to another operation", () => {
    const issues = planStepBackflush({
      operationId: "op-1",
      stepIds: ["s1"],
      materials: [
        material({ id: "tape", jobOperationId: "op-1" }),
        material({ id: "resin", jobOperationId: "op-2" })
      ],
      stepLinks: [],
      records: [{ jobOperationStepId: "s1", index: 0 }]
    });
    expect(issues.map((i) => i.materialId)).toEqual(["tape"]);
  });

  it("issues the other operation's loose part when that operation records its first step", () => {
    const issues = planStepBackflush({
      operationId: "op-2",
      stepIds: ["s3", "s4"],
      materials: [
        material({ id: "tape", jobOperationId: "op-1" }),
        material({ id: "resin", jobOperationId: "op-2", quantity: 0.5 })
      ],
      stepLinks: [],
      records: [{ jobOperationStepId: "s3", index: 0 }]
    });
    expect(issues).toEqual([
      { materialId: "resin", itemId: "item-resin", quantity: 0.5 }
    ]);
  });

  it("keeps issuing a loose part with no operation on any operation's first step", () => {
    const issues = planStepBackflush({
      operationId: "op-2",
      stepIds: ["s3"],
      materials: [material({ id: "wipe", jobOperationId: null })],
      stepLinks: [],
      records: [{ jobOperationStepId: "s3", index: 0 }]
    });
    expect(issues.map((i) => i.materialId)).toEqual(["wipe"]);
  });

  it("issues a step-assigned part only when its own step is recorded", () => {
    const base = {
      operationId: "op-1",
      stepIds: ["s1", "s2"],
      materials: [material({ id: "screw", quantity: 4 })],
      stepLinks: [
        { jobMaterialId: "screw", jobOperationStepId: "s2", quantity: null }
      ]
    };
    expect(
      planStepBackflush({
        ...base,
        records: [{ jobOperationStepId: "s1", index: 0 }]
      })
    ).toEqual([]);
    expect(
      planStepBackflush({
        ...base,
        records: [
          { jobOperationStepId: "s1", index: 0 },
          { jobOperationStepId: "s2", index: 0 }
        ]
      })
    ).toEqual([{ materialId: "screw", itemId: "item-screw", quantity: 4 }]);
  });

  it("ignores a part assigned only to another operation's steps", () => {
    const issues = planStepBackflush({
      operationId: "op-1",
      stepIds: ["s1"],
      materials: [material({ id: "bolt", jobOperationId: "op-1" })],
      stepLinks: [
        { jobMaterialId: "bolt", jobOperationStepId: "s9", quantity: null }
      ],
      records: [{ jobOperationStepId: "s1", index: 0 }]
    });
    expect(issues).toEqual([]);
  });

  it("issues only the shortfall against what is already issued", () => {
    const issues = planStepBackflush({
      operationId: "op-1",
      stepIds: ["s1"],
      materials: [material({ id: "glue", quantity: 2, quantityIssued: 3 })],
      stepLinks: [],
      records: [
        { jobOperationStepId: "s1", index: 0 },
        { jobOperationStepId: "s1", index: 1 }
      ]
    });
    expect(issues).toEqual([
      { materialId: "glue", itemId: "item-glue", quantity: 1 }
    ]);
  });

  it("issues each step's share of a split line, capped at the line", () => {
    const issues = planStepBackflush({
      operationId: "op-1",
      stepIds: ["s1", "s2"],
      materials: [material({ id: "screw", quantity: 5 })],
      stepLinks: [
        { jobMaterialId: "screw", jobOperationStepId: "s1", quantity: 2 },
        { jobMaterialId: "screw", jobOperationStepId: "s2", quantity: 10 }
      ],
      records: [
        { jobOperationStepId: "s1", index: 0 },
        { jobOperationStepId: "s2", index: 0 }
      ]
    });
    expect(issues).toEqual([
      { materialId: "screw", itemId: "item-screw", quantity: 5 }
    ]);
  });
});

describe("ownsLooseMaterial", () => {
  it("owns its own and unassigned parts, never another operation's", () => {
    expect(ownsLooseMaterial({ jobOperationId: "op-1" }, "op-1")).toBe(true);
    expect(ownsLooseMaterial({ jobOperationId: null }, "op-1")).toBe(true);
    expect(ownsLooseMaterial({ jobOperationId: "op-2" }, "op-1")).toBe(false);
  });
});
