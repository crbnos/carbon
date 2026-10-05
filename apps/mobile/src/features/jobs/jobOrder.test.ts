// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JobOperationSummary } from "@carbon/mes-core";
import { describe, expect, it } from "vitest";
import { orderOperations } from "./jobOrder";

const op = (id: string, order?: number) =>
  ({ id, order }) as unknown as JobOperationSummary;
const ids = (list: JobOperationSummary[]) => list.map((o) => o.id);

describe("orderOperations", () => {
  it("puts a dependency before the operation that needs it", () => {
    const operations = [op("b", 2), op("a", 1)];
    const deps = [{ operationId: "b", dependsOnId: "a" }];
    expect(ids(orderOperations(operations, deps))).toEqual(["a", "b"]);
  });

  it("follows the DEPENDENCIES, not the order column, when they disagree", () => {
    // A planner can number an operation 1 and still make it depend on 2.
    // Running order is what an operator needs.
    const operations = [op("first", 1), op("second", 2)];
    const deps = [{ operationId: "first", dependsOnId: "second" }];
    expect(ids(orderOperations(operations, deps))).toEqual(["second", "first"]);
  });

  it("falls back to `order` when nothing is constrained", () => {
    const operations = [op("c", 3), op("a", 1), op("b", 2)];
    expect(ids(orderOperations(operations, []))).toEqual(["a", "b", "c"]);
  });

  it("breaks a tie by id, so the list never reorders between renders", () => {
    const operations = [op("z"), op("a")];
    expect(ids(orderOperations(operations, []))).toEqual(["a", "z"]);
  });

  it("emits a fan-out's branches after their shared prerequisite", () => {
    const operations = [op("left", 2), op("right", 3), op("root", 1)];
    const deps = [
      { operationId: "left", dependsOnId: "root" },
      { operationId: "right", dependsOnId: "root" }
    ];
    expect(ids(orderOperations(operations, deps))).toEqual([
      "root",
      "left",
      "right"
    ]);
  });

  it("waits for BOTH prerequisites before a rejoin", () => {
    const operations = [op("join", 3), op("a", 1), op("b", 2)];
    const deps = [
      { operationId: "join", dependsOnId: "a" },
      { operationId: "join", dependsOnId: "b" }
    ];
    expect(ids(orderOperations(operations, deps))).toEqual(["a", "b", "join"]);
  });

  it("still renders every operation when the graph has a CYCLE", () => {
    // The failure this guards: a cycle leaves both operations permanently
    // blocked, and a walk that only emits unblocked ones drops them from the
    // screen — an operator sees a job missing half its work and has no way
    // to tell why.
    const operations = [op("a", 1), op("b", 2), op("fine", 3)];
    const deps = [
      { operationId: "a", dependsOnId: "b" },
      { operationId: "b", dependsOnId: "a" }
    ];
    const out = ids(orderOperations(operations, deps));
    expect(out).toHaveLength(3);
    expect(new Set(out)).toEqual(new Set(["a", "b", "fine"]));
  });

  it("ignores a dependency pointing outside this job", () => {
    // A dangling id would otherwise leave the operation blocked for ever.
    const operations = [op("a", 1)];
    const deps = [{ operationId: "a", dependsOnId: "not-in-this-job" }];
    expect(ids(orderOperations(operations, deps))).toEqual(["a"]);
  });

  it("is empty for no operations rather than throwing", () => {
    expect(orderOperations([], [])).toEqual([]);
  });

  it("never drops or duplicates an operation", () => {
    const operations = [op("a", 1), op("b", 2), op("c", 3), op("d", 4)];
    const deps = [
      { operationId: "b", dependsOnId: "a" },
      { operationId: "c", dependsOnId: "a" },
      { operationId: "d", dependsOnId: "b" },
      { operationId: "d", dependsOnId: "c" }
    ];
    const out = ids(orderOperations(operations, deps));
    expect(out).toHaveLength(4);
    expect(new Set(out).size).toBe(4);
    expect(out[0]).toBe("a");
    expect(out[3]).toBe("d");
  });
});
