import { describe, expect, it } from "vitest";
import {
  deriveWorkflowSubscriptions,
  deriveWorkflowTriggerRows,
  findTriggerSchedule
} from "./sync";

function triggerNode(
  events: string[],
  origin: "Person" | "Automation" | "Both" = "Both",
  id = "t1"
) {
  return {
    id,
    name: id,
    position: { x: 0, y: 0 },
    type: "trigger",
    data: { events, origin }
  };
}

describe("deriveWorkflowTriggerRows", () => {
  it("returns one row per event id, carrying the node's origin", () => {
    const rows = deriveWorkflowTriggerRows([
      triggerNode(
        ["purchaseOrder.status.changed", "purchaseOrder.supplierId.changed"],
        "Person"
      )
    ]);

    expect(rows).toEqual([
      { eventId: "purchaseOrder.status.changed", origin: "Person" },
      { eventId: "purchaseOrder.supplierId.changed", origin: "Person" }
    ]);
  });

  it("keeps the first node's origin for a duplicated event id", () => {
    const rows = deriveWorkflowTriggerRows([
      triggerNode(["purchaseOrder.status.changed"], "Person", "t1"),
      triggerNode(["purchaseOrder.status.changed"], "Automation", "t2")
    ]);

    expect(rows).toEqual([
      { eventId: "purchaseOrder.status.changed", origin: "Person" }
    ]);
  });

  it("ignores non-trigger nodes", () => {
    const rows = deriveWorkflowTriggerRows([
      {
        id: "a1",
        name: "a1",
        position: { x: 0, y: 0 },
        type: "action",
        data: { action: "send-email", inputs: {} }
      },
      triggerNode(["purchaseOrder.created"])
    ]);

    expect(rows).toEqual([
      { eventId: "purchaseOrder.created", origin: "Both" }
    ]);
  });

  it("throws on malformed nodes", () => {
    expect(() => deriveWorkflowTriggerRows([{ type: "nope" }])).toThrow(
      /failed to parse/
    );
  });
});

describe("findTriggerSchedule", () => {
  it("returns the schedule from a scheduled trigger node", () => {
    const nodes = [
      {
        id: "t1",
        name: "t1",
        position: { x: 0, y: 0 },
        type: "trigger",
        data: {
          events: [],
          origin: "Person",
          schedule: {
            freq: "Daily",
            hour: 9,
            minute: 0,
            tz: "America/New_York"
          }
        }
      }
    ];
    expect(findTriggerSchedule(nodes)).toEqual({
      freq: "Daily",
      hour: 9,
      minute: 0,
      tz: "America/New_York"
    });
  });

  it("returns null for an event-only trigger node", () => {
    expect(
      findTriggerSchedule([triggerNode(["purchaseOrder.created"])])
    ).toBeNull();
  });

  it("returns null for an empty node list", () => {
    expect(findTriggerSchedule([])).toBeNull();
  });

  it("throws on unparseable nodes", () => {
    expect(() => findTriggerSchedule("not-an-array")).toThrow(
      /failed to parse/
    );
  });
});

describe("deriveWorkflowSubscriptions", () => {
  it("maps a record event to its table and operation", () => {
    expect(
      deriveWorkflowSubscriptions(["purchaseOrder.status.changed"])
    ).toEqual([{ table: "purchaseOrder", operations: ["UPDATE"] }]);
  });

  it("unions the operations one table needs", () => {
    expect(
      deriveWorkflowSubscriptions([
        "purchaseOrder.status.changed",
        "purchaseOrder.created"
      ])
    ).toEqual([{ table: "purchaseOrder", operations: ["INSERT", "UPDATE"] }]);
  });

  it("contributes nothing for a moment", () => {
    expect(deriveWorkflowSubscriptions(["production.jobReleased"])).toEqual([]);
  });

  it("ignores an unknown event id", () => {
    expect(deriveWorkflowSubscriptions(["not.a.real.event"])).toEqual([]);
  });
});
