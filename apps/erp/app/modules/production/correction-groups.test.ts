// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  correctionDependencyEdges,
  correctionInitialStatuses,
  correctionOperationGroups,
  matchStepsByName
} from "./correction-groups";

describe("correctionOperationGroups", () => {
  it("runs a sequence one operation after another", () => {
    expect(
      correctionOperationGroups([
        { id: "teardown", operationOrder: "After Previous" },
        { id: "clean", operationOrder: "After Previous" },
        { id: "retorque", operationOrder: "After Previous" }
      ])
    ).toEqual([["teardown"], ["clean"], ["retorque"]]);
  });

  it("puts a With Previous operation in the group before it", () => {
    expect(
      correctionOperationGroups([
        { id: "teardown", operationOrder: "After Previous" },
        { id: "clean", operationOrder: "After Previous" },
        { id: "inspect-parts", operationOrder: "With Previous" },
        { id: "retorque", operationOrder: "After Previous" }
      ])
    ).toEqual([["teardown"], ["clean", "inspect-parts"], ["retorque"]]);
  });

  it("starts a group with the first operation whatever its order", () => {
    expect(
      correctionOperationGroups([
        { id: "sand", operationOrder: "With Previous" }
      ])
    ).toEqual([["sand"]]);
  });
});

describe("correctionDependencyEdges", () => {
  const groups = [["teardown"], ["clean", "inspect-parts"], ["retorque"]];

  it("makes each group wait for the whole group before it", () => {
    const edges = correctionDependencyEdges({
      groups,
      reinspectOperationId: null,
      downstreamOperationIds: []
    });
    expect(edges).toEqual([
      { operationId: "clean", dependsOnId: "teardown" },
      { operationId: "inspect-parts", dependsOnId: "teardown" },
      { operationId: "retorque", dependsOnId: "clean" },
      { operationId: "retorque", dependsOnId: "inspect-parts" }
    ]);
  });

  it("re-inspects after the last group, and the routing waits for it", () => {
    const edges = correctionDependencyEdges({
      groups: [["sand"]],
      reinspectOperationId: "check-copy",
      downstreamOperationIds: ["next-op"]
    });
    expect(edges).toEqual([
      { operationId: "check-copy", dependsOnId: "sand" },
      { operationId: "next-op", dependsOnId: "check-copy" }
    ]);
  });

  it("with Continue, the routing waits for the whole last group", () => {
    const edges = correctionDependencyEdges({
      groups: [["a"], ["b", "c"]],
      reinspectOperationId: null,
      downstreamOperationIds: ["next-op"]
    });
    expect(edges).toContainEqual({ operationId: "next-op", dependsOnId: "b" });
    expect(edges).toContainEqual({ operationId: "next-op", dependsOnId: "c" });
  });
});

describe("correctionInitialStatuses", () => {
  it("makes every operation of the first group Ready", () => {
    // A With Previous operation joins the first group, which waits on
    // nothing, so it must not start Waiting with no dependency to clear it.
    expect(
      correctionInitialStatuses([
        { operationOrder: "After Previous" },
        { operationOrder: "With Previous" },
        { operationOrder: "After Previous" }
      ])
    ).toEqual(["Ready", "Ready", "Waiting"]);
  });

  it("makes only the first operation Ready in a plain sequence", () => {
    expect(
      correctionInitialStatuses([
        { operationOrder: "After Previous" },
        { operationOrder: "After Previous" }
      ])
    ).toEqual(["Ready", "Waiting"]);
  });
});

describe("matchStepsByName", () => {
  const step = (
    id: string,
    operationOrder: number,
    name: string,
    type = "List",
    sortOrder = 1
  ) => ({ id, operationOrder, name, type, sortOrder });

  it("pairs steps with the same operation, name and type", () => {
    expect(
      matchStepsByName(
        [
          step("m1", 3, "Nut torque check"),
          step("m2", 3, "Torque", "Measurement", 2)
        ],
        [
          step("j2", 3, "Torque", "Measurement", 2),
          step("j1", 3, "Nut torque check")
        ]
      )
    ).toEqual({ m1: "j1", m2: "j2" });
  });

  it("drops a step the copy renamed, retyped or moved", () => {
    expect(
      matchStepsByName(
        [step("m1", 3, "Check"), step("m2", 3, "Gap"), step("m3", 2, "Fit")],
        [
          step("j1", 3, "Check (rev)"),
          step("j2", 3, "Gap", "Value"),
          step("j3", 4, "Fit")
        ]
      )
    ).toEqual({});
  });

  it("pairs repeated names in sort order", () => {
    expect(
      matchStepsByName(
        [step("m1", 1, "Check", "List", 1), step("m2", 1, "Check", "List", 2)],
        [step("j2", 1, "Check", "List", 2), step("j1", 1, "Check", "List", 1)]
      )
    ).toEqual({ m1: "j1", m2: "j2" });
  });
});
