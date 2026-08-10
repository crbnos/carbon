import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { calculateOperationDates } from "./date-calculator.ts";
import { businessDay } from "./date-utils.ts";

/** Today's calendar day in UTC — the fixed reference the assertions compare against. */
const TODAY = businessDay(new Date().toISOString(), "UTC");
import type {
  BaseOperation,
  DependencyGraph,
  DependencyNode,
} from "./types.ts";

/** Minimal chain graph: each op depends on the previous one. */
function chainGraph(ids: string[]): DependencyGraph {
  const nodes = new Map<string, DependencyNode>();
  ids.forEach((id, i) => {
    nodes.set(id, {
      operationId: id,
      dependsOn: i > 0 ? [ids[i - 1]] : [],
      requiredBy: i < ids.length - 1 ? [ids[i + 1]] : [],
    });
  });
  return {
    nodes,
    getDependencies: (id) => nodes.get(id)?.dependsOn ?? [],
    getDependents: (id) => nodes.get(id)?.requiredBy ?? [],
    addDependency: () => {},
    topologicalSort: (direction) =>
      direction === "reverse" ? [...ids].reverse() : [...ids],
  };
}

function op(id: string, overrides: Partial<BaseOperation> = {}): BaseOperation {
  return {
    id,
    jobId: "job-1",
    processId: "process-1",
    // 8h/day ceil => each op is exactly one business day
    setupTime: 0,
    laborTime: 8,
    laborUnit: "Total Hours",
    machineTime: 0,
    ...overrides,
  };
}

Deno.test("backward scheduling with no job due date never flags lateness conflicts", () => {
  // Three chained 1-day ops anchored on today: op-1's computed start is
  // necessarily in the past, but with no real due date that is not a conflict
  const ids = ["op-1", "op-2", "op-3"];
  const scheduled = calculateOperationDates(
    ids.map((id) => op(id)),
    chainGraph(ids),
    null,
    TODAY,
    "backward"
  );

  for (const id of ids) {
    const s = scheduled.get(id);
    assert(s);
    assertEquals(s.hasConflict, false);
    assertEquals(s.conflictReason, null);
  }
  const first = scheduled.get("op-1")!;
  assert(first.startDate! < TODAY);
});

Deno.test("backward scheduling with a too-close due date flags the past start", () => {
  const ids = ["op-1", "op-2", "op-3"];
  const scheduled = calculateOperationDates(
    ids.map((id) => op(id)),
    chainGraph(ids),
    TODAY,
    TODAY,
    "backward"
  );

  const first = scheduled.get("op-1")!;
  assertEquals(first.hasConflict, true);
  assert(first.conflictReason?.startsWith("Operation must start on"));
});
