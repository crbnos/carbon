// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { buildHubPlan } from "./hub-plan";
import { EMPTY_EXCLUSIONS } from "./visibility";

const base = {
  exclusions: EMPTY_EXCLUSIONS,
  checkStates: [],
  fieldValues: [],
  rows: [],
  assignments: [],
  counts: {}
};

describe("buildHubPlan", () => {
  it("lists the tier's gates in order, with their tasks and item keys", () => {
    const plan = buildHubPlan({ ...base, tier: "self_serve" });
    expect(plan.gates.map((gate) => gate.itemKey)).toEqual([
      "gate:configure",
      "gate:train",
      "gate:golive"
    ]);
    const configure = plan.gates[0]!;
    // A Setup-Map-derived task is ticked through its rows, so it has no
    // item key of its own; it can still be assigned.
    const resources = configure.tasks.find(
      (task) => task.assignKey === "task:setup-resources"
    );
    expect(resources?.itemKey).toBeNull();
    expect(resources?.label).toBe("Resources");
  });

  it("shows an operational task only once its records exist", () => {
    const hidden = buildHubPlan({ ...base, tier: "guided" });
    const shown = buildHubPlan({
      ...base,
      tier: "guided",
      counts: { suppliers: 2, items: 5, purchaseOrdersFinalized: 0 }
    });
    const keys = (plan: typeof hidden) =>
      plan.gates.flatMap((gate) => gate.tasks.map((task) => task.assignKey));
    expect(keys(hidden)).not.toContain("task:first-purchase-order");
    const task = shown.gates
      .flatMap((gate) => gate.tasks)
      .find((t) => t.assignKey === "task:first-purchase-order");
    expect(task?.itemKey).toBe("task:first-purchase-order");
    expect(task?.evidence).toEqual({
      count: "purchaseOrdersFinalized",
      value: 0
    });
  });

  it("reports Setup Map rows with their tick, verification, assignee and evidence", () => {
    const plan = buildHubPlan({
      ...base,
      tier: "guided",
      checkStates: [
        {
          itemKey: "flag:setup.work-centers",
          kind: "scopeFlag",
          value: "1",
          verifiedAt: "2026-10-06T10:00:00+00:00"
        }
      ],
      assignments: [{ itemKey: "flag:setup.work-centers", assigneeId: "u1" }],
      counts: { workCenters: 4 }
    });
    const row = plan.setupRows.find(
      (r) => r.itemKey === "flag:setup.work-centers"
    );
    expect(row).toMatchObject({
      configured: true,
      assigneeId: "u1",
      verifiedAt: "2026-10-06T10:00:00+00:00",
      evidence: { count: "workCenters", value: 4 }
    });
  });

  it("drops rows of an excluded module", () => {
    const plan = buildHubPlan({
      ...base,
      tier: "guided",
      exclusions: { modules: ["acc"], pages: [], sections: [] }
    });
    expect(
      plan.setupRows.some((r) => r.itemKey === "flag:setup.chart-of-accounts")
    ).toBe(false);
  });

  it("reads objectives with their done tick, owner and event evidence", () => {
    const plan = buildHubPlan({
      ...base,
      tier: "self_serve",
      rows: [
        {
          id: "o1",
          collection: "objective",
          payload: { title: "First job on the floor", event: "jobCompleted" },
          sortOrder: 0,
          source: "customer"
        },
        {
          id: "q1",
          collection: "question",
          payload: { question: "Who approves purchases?" },
          sortOrder: 0,
          source: "handover",
          sourceRef: "handover:risks.openPoints:0"
        }
      ],
      checkStates: [
        { itemKey: "check:objective.o1", kind: "check", value: "1" }
      ],
      assignments: [{ itemKey: "row:o1", assigneeId: "u2" }],
      counts: { completedJobs: 1 }
    });
    expect(plan.objectives).toEqual([
      expect.objectContaining({
        rowId: "o1",
        itemKey: "check:objective.o1",
        assignKey: "row:o1",
        title: "First job on the floor",
        done: true,
        assigneeId: "u2",
        evidence: { count: "completedJobs", value: 1 }
      })
    ]);
    expect(plan.customRows).toEqual([
      expect.objectContaining({
        rowId: "q1",
        collection: "question",
        source: "handover",
        sourceRef: "handover:risks.openPoints:0"
      })
    ]);
  });

  it("uses the given label function for template text", () => {
    const plan = buildHubPlan({
      ...base,
      tier: "self_serve",
      label: (descriptor) => `[${descriptor.message}]`
    });
    expect(plan.gates[0]?.title).toBe("[Configure]");
  });
});
