// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  correctionDependencyEdges,
  correctionOperationGroups
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
