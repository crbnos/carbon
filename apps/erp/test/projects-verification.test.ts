// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import type {
  ElementVerification,
  ItemValues,
  ParameterVerification,
  RequirementVerification,
  VerificationElement,
  VerificationLink
} from "~/modules/projects/projects.models";
import {
  computeVerification,
  formatAllocation,
  rollUpRequirementStatus
} from "~/modules/projects/projects.models";

function element(
  id: string,
  type: VerificationElement["type"],
  fields: Partial<VerificationElement> = {}
): VerificationElement {
  return {
    id,
    readableId: id,
    type,
    parentId: null,
    itemId: null,
    parameterValue: null,
    parameterUnit: null,
    parameterSource: null,
    parameterFormula: null,
    parameterItemField: null,
    parameterContingencyPercent: null,
    allocationPercent: null,
    targetOperator: null,
    targetValue: null,
    targetUpperValue: null,
    targetUnit: null,
    actualParameterId: null,
    verdict: null,
    ...fields
  };
}

const manual = (id: string, value: number, unit: string, parentId: string) =>
  element(id, "Parameter", {
    parentId,
    parameterSource: "Manual",
    parameterValue: value,
    parameterUnit: unit
  });

const parameter = (map: Map<string, ElementVerification>, id: string) =>
  map.get(id) as ParameterVerification;
const requirement = (map: Map<string, ElementVerification>, id: string) =>
  map.get(id) as RequirementVerification;

function massBudget(secondChild: number, extra: Partial<VerificationElement> = {}) {
  return [
    element("SYS-1", "Parameter", {
      parameterSource: "Sum",
      parameterUnit: "g",
      ...extra
    }),
    manual("SYS-2", 50, "g", "SYS-1"),
    manual("SYS-3", secondChild, "g", "SYS-1"),
    manual("SYS-4", 3, "lb", "SYS-1")
  ];
}

const noItems = new Map<string, ItemValues>();

describe("computeVerification", () => {
  it("sums child Parameters in the same unit and flags a mixed unit", () => {
    const result = computeVerification(massBudget(65), [], noItems);
    expect(parameter(result, "SYS-1")).toMatchObject({
      computedValue: 115,
      mixedUnits: true
    });
  });

  it("passes and fails a ≤ target on the summed Parameter", () => {
    const target = element("SYS-5", "Requirement", {
      targetOperator: "≤",
      targetValue: 120,
      targetUnit: "g",
      actualParameterId: "SYS-1"
    });
    const pass = computeVerification([...massBudget(65), target], [], noItems);
    expect(requirement(pass, "SYS-5").status).toBe("Pass");
    const fail = computeVerification([...massBudget(75), target], [], noItems);
    expect(requirement(fail, "SYS-5").status).toBe("Fail");
  });

  it("fails a Requirement that a failed Test Case verifies", () => {
    const links: VerificationLink[] = [
      { fromElementId: "SYS-7", toElementId: "SYS-6", linkType: "verifies" }
    ];
    const result = computeVerification(
      [
        element("SYS-6", "Requirement"),
        element("SYS-7", "Test Case", { verdict: "Fail" })
      ],
      links,
      noItems
    );
    expect(requirement(result, "SYS-6")).toMatchObject({
      anyTestFail: true,
      status: "Fail"
    });
  });

  it("computes the spec's power margin constraint", () => {
    const elements = (consumed: number) => [
      element("SNS-20", "Parameter", {
        parameterSource: "Manual",
        parameterValue: 50,
        parameterUnit: "W"
      }),
      element("SNS-21", "Parameter", {
        parameterSource: "Manual",
        parameterValue: consumed,
        parameterUnit: "W"
      }),
      element("SNS-22", "Parameter", {
        parameterSource: "Formula",
        parameterFormula: "= SNS-20 - SNS-21",
        parameterUnit: "W"
      }),
      element("SNS-23", "Requirement", {
        targetOperator: "≥",
        targetValue: 0,
        targetUnit: "W",
        actualParameterId: "SNS-22"
      })
    ];
    const pass = computeVerification(elements(42), [], noItems);
    expect(parameter(pass, "SNS-22").computedValue).toBe(8);
    expect(requirement(pass, "SNS-23").status).toBe("Pass");
    const fail = computeVerification(elements(55), [], noItems);
    expect(parameter(fail, "SNS-22").computedValue).toBe(-5);
    expect(requirement(fail, "SNS-23").status).toBe("Fail");
  });

  it("gives two formulas that refer to each other a circular reason", () => {
    const result = computeVerification(
      [
        element("SNS-1", "Parameter", {
          parameterSource: "Formula",
          parameterFormula: "= SNS-2 + 1"
        }),
        element("SNS-2", "Parameter", {
          parameterSource: "Formula",
          parameterFormula: "= SNS-1 + 1"
        })
      ],
      [],
      noItems
    );
    for (const id of ["SNS-1", "SNS-2"]) {
      expect(parameter(result, id)).toMatchObject({
        computedValue: null,
        reason: "Circular formula"
      });
    }
  });

  it("applies a contingency in the direction of each target", () => {
    const withContingency = massBudget(65, { parameterContingencyPercent: 0.1 });
    const below = element("SYS-8", "Requirement", {
      targetOperator: "≤",
      targetValue: 120,
      actualParameterId: "SYS-1"
    });
    const above = element("SYS-9", "Requirement", {
      targetOperator: "≥",
      targetValue: 100,
      actualParameterId: "SYS-1"
    });
    const result = computeVerification(
      [...withContingency, below, above],
      [],
      noItems
    );
    expect(parameter(result, "SYS-1").checkedHigh).toBeCloseTo(126.5);
    expect(parameter(result, "SYS-1").checkedLow).toBeCloseTo(103.5);
    expect(requirement(result, "SYS-8").status).toBe("Fail");
    expect(requirement(result, "SYS-9").status).toBe("Pass");
  });

  it("reads an Item Parameter from the part linked above it", () => {
    const result = computeVerification(
      [
        element("SYS-10", "System", { itemId: "item-1" }),
        element("SYS-11", "Parameter", {
          parentId: "SYS-10",
          parameterSource: "Item",
          parameterItemField: "massGrams"
        })
      ],
      [],
      new Map([["item-1", { unitCost: 4, customFields: { massGrams: "118" } }]])
    );
    expect(parameter(result, "SYS-11").computedValue).toBe(118);
  });
});

describe("rollUpRequirementStatus", () => {
  const tree = (childVerdict: "Pass" | "Fail" | null) => {
    const elements = [
      element("REQ-1", "Requirement"),
      element("REQ-2", "Requirement", { parentId: "REQ-1" }),
      element("REQ-3", "Requirement", { parentId: "REQ-1" }),
      element("TST-1", "Test Case", { verdict: "Pass" }),
      element("TST-2", "Test Case", { verdict: childVerdict })
    ];
    const links: VerificationLink[] = [
      { fromElementId: "TST-1", toElementId: "REQ-2", linkType: "verifies" },
      { fromElementId: "TST-2", toElementId: "REQ-3", linkType: "verifies" }
    ];
    return rollUpRequirementStatus(
      elements,
      computeVerification(elements, links, noItems)
    );
  };

  it("passes a parent whose children all pass", () => {
    expect(tree("Pass").get("REQ-1")).toBe("Pass");
  });

  it("fails a parent with one failed child", () => {
    expect(tree("Fail").get("REQ-1")).toBe("Fail");
  });

  it("leaves a parent Unverified when a child has no checks", () => {
    expect(tree(null).get("REQ-1")).toBe("Unverified");
  });
});

describe("formatAllocation", () => {
  it("shows the budget, the percent and the parent value", () => {
    expect(formatAllocation(600, 0.3, 2000, "kg")).toBe(
      "≤ 600 kg (30% of 2,000 kg)"
    );
  });
});
