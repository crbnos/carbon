// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import type { Activity, TrackedEntity } from "~/modules/inventory/types";
import { type LineagePayload, payloadToFlow } from "./utils";

const SERIALS = ["S1", "S2", "S3"];

const serial = (id: string): TrackedEntity =>
  ({
    id,
    readableId: id,
    quantity: 1,
    status: "Available",
    itemId: "PART-1",
    sourceDocumentReadableId: "PART-1",
    attributes: {}
  }) as TrackedEntity;

const activity = (id: string, type: string, createdAt: string): Activity => ({
  id,
  type,
  attributes: {},
  createdAt
});

// Three serials received, then inspected together; S1 is the traced root, so
// the other two stay below the cluster threshold and keep their own nodes.
function inspectedLot(
  inspectRows: Pick<LineagePayload, "inputs" | "outputs">
): LineagePayload {
  return {
    entities: SERIALS.map(serial),
    activities: [
      activity("RECEIVE", "Receive", "2026-08-01T10:00:00.000Z"),
      activity("INSPECT", "Inspect", "2026-08-01T11:00:00.000Z")
    ],
    inputs: inspectRows.inputs,
    outputs: [
      ...SERIALS.map((id) => ({
        trackedActivityId: "RECEIVE",
        trackedEntityId: id,
        quantity: 1
      })),
      ...inspectRows.outputs
    ]
  };
}

function inspectEdges(payload: LineagePayload) {
  const { nodes, edges } = payloadToFlow(payload, undefined, {
    rootIds: ["S1"]
  });
  return {
    entityNodes: nodes.filter((n) => n.type === "entity").map((n) => n.id),
    edges: edges
      .filter((e) => e.source === "INSPECT" || e.target === "INSPECT")
      .map((e) => ({
        source: e.source,
        target: e.target,
        kind: e.data?.kind,
        quantity: e.data?.quantity
      }))
      .sort((a, b) => a.source.localeCompare(b.source))
  };
}

const ONE_EDGE_PER_UNIT = {
  // An inspection leaves each unit as it was: no second state node.
  entityNodes: SERIALS,
  edges: SERIALS.map((id) => ({
    source: id,
    target: "INSPECT",
    kind: "movement",
    quantity: 1
  }))
};

describe("payloadToFlow inspections", () => {
  it("draws one edge per inspected unit, at the unit's quantity", () => {
    const payload = inspectedLot({
      inputs: SERIALS.map((id) => ({
        trackedActivityId: "INSPECT",
        trackedEntityId: id,
        quantity: 1
      })),
      outputs: []
    });
    expect(inspectEdges(payload)).toEqual(ONE_EDGE_PER_UNIT);
  });

  it("draws the same for inspections stored as zero-quantity self-loops", () => {
    const zero = SERIALS.map((id) => ({
      trackedActivityId: "INSPECT",
      trackedEntityId: id,
      quantity: 0
    }));
    const payload = inspectedLot({ inputs: zero, outputs: zero });
    expect(inspectEdges(payload)).toEqual(ONE_EDGE_PER_UNIT);
  });
});

describe("payloadToFlow production operations named like inspections", () => {
  // The MES names a production event after its operation, so an operation
  // called "Final Inspection" is an ordinary production activity.
  it("keeps the output of a 'Final Inspection (Labor)' activity", () => {
    const payload: LineagePayload = {
      entities: [serial("S1"), serial("S2")],
      activities: [
        activity("RECEIVE", "Receive", "2026-08-01T10:00:00.000Z"),
        activity("OP", "Final Inspection (Labor)", "2026-08-01T11:00:00.000Z")
      ],
      inputs: [{ trackedActivityId: "OP", trackedEntityId: "S1", quantity: 1 }],
      outputs: [
        { trackedActivityId: "RECEIVE", trackedEntityId: "S1", quantity: 1 },
        { trackedActivityId: "OP", trackedEntityId: "S2", quantity: 1 }
      ]
    };
    const { edges } = payloadToFlow(payload, undefined, { rootIds: ["S1"] });
    const opEdges = edges
      .filter((e) => e.source === "OP" || e.target === "OP")
      .map((e) => ({
        source: e.source,
        target: e.target,
        kind: e.data?.kind
      }))
      .sort((a, b) => a.source.localeCompare(b.source));
    expect(opEdges).toEqual([
      { source: "OP", target: "S2", kind: "output" },
      { source: "S1", target: "OP", kind: "input" }
    ]);
  });
});
