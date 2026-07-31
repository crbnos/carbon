import { describe, expect, it } from "vitest";
import { deriveNextTrace, filterByOrigin, planRuns } from "./matcher";
import type { Subscriber } from "./types";

function sub(overrides: Partial<Subscriber> = {}): Subscriber {
  return {
    workflowId: "wf_1",
    workflowVersionId: "wfv_1",
    eventId: "purchaseOrder.status.changed",
    origin: "Both",
    ownerId: "usr_1",
    ...overrides
  };
}

describe("filterByOrigin", () => {
  const subscribers = [
    sub({ workflowId: "wf_person", origin: "Person" }),
    sub({ workflowId: "wf_automation", origin: "Automation" }),
    sub({ workflowId: "wf_both", origin: "Both" })
  ];

  it("keeps Person and Both for a person-made write", () => {
    expect(filterByOrigin(subscribers, null).map((s) => s.workflowId)).toEqual([
      "wf_person",
      "wf_both"
    ]);
  });

  it("keeps Automation and Both for a workflow-made write", () => {
    expect(
      filterByOrigin(subscribers, "wfr_x").map((s) => s.workflowId)
    ).toEqual(["wf_automation", "wf_both"]);
  });
});

describe("deriveNextTrace", () => {
  it("roots the chain at the causing run and adds one hop", () => {
    expect(
      deriveNextTrace({
        id: "wfr_a",
        workflowId: "wf_1",
        rootRunId: null,
        depth: 0,
        path: []
      })
    ).toEqual({
      rootRunId: "wfr_a",
      causedByRunId: "wfr_a",
      depth: 1,
      path: ["wf_1"]
    });
  });

  it("adds no hop for a purged causing run", () => {
    expect(
      deriveNextTrace({
        id: "wfr_gone",
        workflowId: null,
        rootRunId: null,
        depth: 0,
        path: []
      })
    ).toEqual({
      rootRunId: "wfr_gone",
      causedByRunId: "wfr_gone",
      depth: 1,
      path: []
    });
  });

  it("keeps an existing root", () => {
    expect(
      deriveNextTrace({
        id: "wfr_b",
        workflowId: "wf_2",
        rootRunId: "wfr_a",
        depth: 3,
        path: ["wf_1"]
      })
    ).toEqual({
      rootRunId: "wfr_a",
      causedByRunId: "wfr_b",
      depth: 4,
      path: ["wf_1", "wf_2"]
    });
  });
});

describe("planRuns", () => {
  it("plans a fresh run when nothing caused it", () => {
    const plans = planRuns({
      subscribers: [sub()],
      eventIds: ["purchaseOrder.status.changed"],
      workflowRunId: null,
      causingRun: null
    });

    expect(plans).toHaveLength(1);
    expect(plans[0]!.status).toBe("Queued");
    expect(plans[0]!.statusReason).toBeNull();
    expect(plans[0]!.rootRunId).toBeNull();
    expect(plans[0]!.causedByRunId).toBeNull();
    expect(plans[0]!.depth).toBe(0);
    expect(plans[0]!.path).toEqual([]);
  });

  it("blocks a workflow that already ran in this chain", () => {
    const plans = planRuns({
      subscribers: [sub({ workflowId: "wf_7" })],
      eventIds: ["purchaseOrder.status.changed"],
      workflowRunId: "wfr_a",
      causingRun: {
        id: "wfr_a",
        workflowId: "wf_9",
        rootRunId: "wfr_root",
        depth: 2,
        path: ["wf_1", "wf_7"]
      }
    });

    expect(plans).toHaveLength(1);
    expect(plans[0]!.status).toBe("Blocked");
    expect(plans[0]!.statusReason).toContain("Cycle");
  });

  it("blocks at the chain depth limit", () => {
    const plans = planRuns({
      subscribers: [sub({ workflowId: "wf_new" })],
      eventIds: ["purchaseOrder.status.changed"],
      workflowRunId: "wfr_a",
      causingRun: {
        id: "wfr_a",
        workflowId: "wf_9",
        rootRunId: "wfr_root",
        depth: 9,
        path: []
      }
    });

    expect(plans[0]!.status).toBe("Blocked");
    expect(plans[0]!.statusReason).toBe("Chain depth limit reached (10 hops)");
    expect(plans[0]!.depth).toBe(10);
  });

  it("still queues one hop below the limit", () => {
    const plans = planRuns({
      subscribers: [sub({ workflowId: "wf_new" })],
      eventIds: ["purchaseOrder.status.changed"],
      workflowRunId: "wfr_a",
      causingRun: {
        id: "wfr_a",
        workflowId: "wf_9",
        rootRunId: "wfr_root",
        depth: 8,
        path: []
      }
    });

    expect(plans[0]!.status).toBe("Queued");
    expect(plans[0]!.depth).toBe(9);
  });

  it("plans one run per workflow, keeping the first matching event id", () => {
    const plans = planRuns({
      subscribers: [
        sub({ eventId: "purchaseOrder.supplierId.changed" }),
        sub({ eventId: "purchaseOrder.status.changed" })
      ],
      eventIds: [
        "purchaseOrder.status.changed",
        "purchaseOrder.supplierId.changed"
      ],
      workflowRunId: null,
      causingRun: null
    });

    expect(plans).toHaveLength(1);
    expect(plans[0]!.eventId).toBe("purchaseOrder.status.changed");
  });
});
